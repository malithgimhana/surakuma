using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed partial class IntegrationTests
{
    private static readonly JsonSerializerOptions DemonstrationJson = new(JsonSerializerDefaults.Web)
    {
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() }
    };
    [Fact]
    public async Task SystemConfigurationIsAdministratorOnlyAndReportsActualQueueCounts()
    {
        using var anonymous = fixture.Client();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/v1/admin/system")).StatusCode);
        foreach (string account in new[] { "citizen", "coordinator", "logistics", "volunteer" })
        {
            using var denied = await fixture.Login(account);
            Assert.Equal(HttpStatusCode.Forbidden, (await denied.GetAsync("/api/v1/admin/system")).StatusCode);
        }
        using var admin = await fixture.Login("admin");
        using var response = await admin.GetAsync("/api/v1/admin/system");
        response.EnsureSuccessStatusCode();
        Assert.True(response.Headers.CacheControl?.NoStore);
        var status = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(3, status.GetProperty("integrations").GetArrayLength());
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        Assert.Equal(await db.Set<OutboxMessage>().CountAsync(), status.GetProperty("notificationQueue").EnumerateArray().Sum(x => x.GetProperty("count").GetInt32()));
        Assert.DoesNotContain(fixture.Password, status.ToString());
    }

    [Fact]
    public async Task FloodHouseholdJourneyPreservesHumanReviewStockShelterVolunteerNotificationsAndAudit()
    {
        using var citizen = await fixture.Login("citizen");
        using var manager = await fixture.Login("case");
        using var logistics = await fixture.Login("logistics");
        using var shelters = await fixture.Login("shelter");
        using var volunteers = await fixture.Login("volunteers");
        using var volunteer = await fixture.Login("volunteer");
        using var coordinator = await fixture.Login("coordinator");
        Guid orgId, crisisId, volunteerId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            orgId = await db.Set<Membership>().Where(x => x.Role == Roles.Logistics).Select(x => x.OrganisationId).SingleAsync();
            crisisId = await db.Set<Crisis>().Where(x => x.Name == "Kelani River flood response").Select(x => x.Id).SingleAsync();
            volunteerId = await db.Set<VolunteerProfile>().Select(x => x.Id).SingleAsync();
        }
        async Task<JsonElement> Post(HttpClient client, string path, object body)
        {
            using var response = await client.PostAsJsonAsync("/api/v1/" + path, body, DemonstrationJson);
            Assert.True(response.IsSuccessStatusCode, path + ": " + await response.Content.ReadAsStringAsync());
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
        async Task<Guid> Submit(AidCategory category, decimal quantity, string description)
        {
            var request = await Post(citizen, "requests", new CreateRequestInput(crisisId, orgId, category, Priority.Normal,
                description, "Synthetic Kelaniya collection point", 6.955, 79.92, 4, "Step-free access", quantity, Guid.NewGuid().ToString(), true));
            return request.GetProperty("id").GetGuid();
        }
        async Task Transition(Guid id, string status)
        {
            using var response = await manager.PatchAsJsonAsync($"/api/v1/requests/{id}/status", new
            {
                status,
                reason = "Synthetic acceptance scenario: staff verified."
            });
            response.EnsureSuccessStatusCode();
        }
        // A candidate with identical wording must remain accessible after being marked distinct.
        string description = "Synthetic flood household acceptance " + Guid.NewGuid() + " needs food packs and clean drinking water.";
        Guid candidateId = await Submit(AidCategory.FoodWater, 10, description);
        Guid foodId = await Submit(AidCategory.FoodWater, 10, description);
        await Transition(foodId, "UnderReview");
        await Transition(foodId, "Verified");
        var recommendation = await Post(manager, $"requests/{foodId}/recommendations/generate", new
        {
        });
        Assert.True(recommendation.GetProperty("fallback").GetBoolean());
        Assert.Equal(JsonValueKind.Null, recommendation.GetProperty("confidence").ValueKind);
        await Post(manager, $"requests/{foodId}/decisions", new DecisionInput(recommendation.GetProperty("id").GetGuid(), "Modify", Priority.High, AidCategory.FoodWater, "Staff verified an elderly household member needs priority support."));
        var ai = await manager.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{foodId}/recommendations");
        Guid duplicateId = ai.GetProperty("duplicates").EnumerateArray().Single(x => x.GetProperty("candidateId").GetGuid() == candidateId).GetProperty("id").GetGuid();
        (await manager.PostAsJsonAsync($"/api/v1/requests/{foodId}/duplicates/{duplicateId}", new
        {
            action = "Distinct"
        })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await manager.GetAsync($"/api/v1/requests/{candidateId}")).StatusCode);
        var beforeApproval = await manager.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{foodId}");
        Assert.Equal("Verified", beforeApproval.GetProperty("request").GetProperty("status").GetString());
        await Transition(foodId, "Approved");

        // Create isolated stock through the real API; attempts beyond it must not reserve anything.
        var resource = await Post(logistics, "resources", new ResourceInput(orgId, "Acceptance food packs", AidCategory.FoodWater, "packs", 6, "Synthetic depot", 6.92, 79.88, "Family packs", true));
        Guid resourceId = resource.GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync("/api/v1/allocations", new AllocateInput(foodId, resourceId, 10), DemonstrationJson)).StatusCode);
        async Task Deliver(int quantity)
        {
            var allocation = await Post(logistics, "allocations", new AllocateInput(foodId, resourceId, quantity));
            Guid id = allocation.GetProperty("id").GetGuid();
            (await logistics.PostAsync($"/api/v1/allocations/{id}/Dispatch", null)).EnsureSuccessStatusCode();
            (await logistics.PostAsync($"/api/v1/allocations/{id}/Deliver", null)).EnsureSuccessStatusCode();
        }
        await Deliver(6);
        var partial = await citizen.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{foodId}");
        Assert.Equal("PartiallyFulfilled", partial.GetProperty("request").GetProperty("status").GetString());
        Assert.Equal(6, partial.GetProperty("request").GetProperty("deliveredQuantity").GetDecimal());
        var metrics = await coordinator.GetFromJsonAsync<JsonElement>("/api/v1/reports/metrics");
        Assert.Contains(metrics.GetProperty("shortages").EnumerateArray(), x => x.GetProperty("id").GetGuid() == foodId && x.GetProperty("outstanding").GetDecimal() == 4);

        // Each request has one category; the same household submits a separate shelter need.
        Guid shelterCaseId = await Submit(AidCategory.Shelter, 1, "Synthetic flood household requires accessible shelter for four people.");
        await Transition(shelterCaseId, "UnderReview");
        await Transition(shelterCaseId, "Verified");
        await Transition(shelterCaseId, "Approved");
        var shelter = await Post(shelters, "shelters", new ShelterInput(orgId, "Acceptance accessible shelter", "Synthetic location", 6.95, 79.92, 4, true, true, "Step-free access"));
        Guid shelterId = shelter.GetProperty("id").GetGuid();
        var placement = await Post(shelters, "shelter-allocations", new ShelterPlaceInput(shelterCaseId, shelterId));
        Guid placementId = placement.GetProperty("id").GetGuid();
        (await shelters.PostAsync($"/api/v1/shelter-allocations/{placementId}/CheckIn", null)).EnsureSuccessStatusCode();

        var task = await Post(volunteers, "volunteer-tasks", new TaskInput(foodId, volunteerId, "Acceptance household distribution", "distribution", DateTimeOffset.UtcNow.AddDays(1)));
        Guid taskId = task.GetProperty("id").GetGuid();
        foreach (string action in new[] { "Accept", "Start", "Complete" })
            await Post(volunteer, $"volunteer-tasks/{taskId}", new TaskUpdateInput(action, "Synthetic volunteer progress"));
        Assert.Equal(HttpStatusCode.Forbidden, (await volunteer.PostAsJsonAsync($"/api/v1/volunteer-tasks/{taskId}", new TaskUpdateInput("Verify"))).StatusCode);
        var verified = await Post(volunteers, $"volunteer-tasks/{taskId}", new TaskUpdateInput("Verify", "Coordinator confirmed completion"));
        Assert.Equal("Completed", verified.GetProperty("status").GetString());
        (await logistics.PostAsJsonAsync($"/api/v1/resources/{resourceId}/replenish", new MovementInput(4, "Synthetic shortage resolved"))).EnsureSuccessStatusCode();
        await Deliver(4);
        await Transition(foodId, "Closed");
        await Transition(shelterCaseId, "Closed");
        (await citizen.PostAsJsonAsync($"/api/v1/requests/{foodId}/feedback", new FeedbackInput(5, true, false, "Synthetic receipt confirmed"))).EnsureSuccessStatusCode();

        var worker = new NotificationWorker(fixture.Factory.Services.GetRequiredService<IServiceScopeFactory>(), NullLogger<NotificationWorker>.Instance);
        int pending;
        using (var scope = fixture.Factory.Services.CreateScope())
            pending = await scope.ServiceProvider.GetRequiredService<CrisisDbContext>().Set<OutboxMessage>().CountAsync(x => x.State == "Pending");
        for (int i = 0; i < pending; i++)
            await worker.ProcessOne(default);
        var notifications = await citizen.GetFromJsonAsync<JsonElement>("/api/v1/notifications");
        Assert.Contains(notifications.EnumerateArray(), x => x.GetProperty("requestId").GetGuid() == foodId);
        using var check = fixture.Factory.Services.CreateScope();
        var database = check.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var final = await database.Set<AssistanceRequest>().FindAsync(foodId);
        Assert.Equal(RequestStatus.Closed, final!.Status);
        Assert.Equal(Priority.High, final.Priority);
        Assert.Equal(10, final.DeliveredQuantity);
        var finalResource = await database.Set<Resource>().FindAsync(resourceId);
        Assert.Equal(0, finalResource!.Stock);
        Assert.Equal(0, finalResource.Reserved);
        var finalShelter = await database.Set<Shelter>().FindAsync(shelterId);
        Assert.Equal(4, finalShelter!.Occupancy);
        Assert.Equal(0, finalShelter.Reserved);
        Assert.Equal(0, finalShelter.Available);
        Assert.True(await database.Set<AuditEvent>().AnyAsync(x => x.Action == "AiDecision" && x.EntityId == recommendation.GetProperty("id").GetGuid()));
        Assert.True(await database.Set<AuditEvent>().AnyAsync(x => x.Action == "VolunteerTaskVerify" && x.EntityId == taskId));
        Assert.All(await database.Set<OutboxMessage>().Where(x => x.RequestId == foodId).ToListAsync(), x => Assert.Equal("Captured", x.State));
        Assert.True(await database.Set<RequestHistory>().CountAsync(x => x.RequestId == foodId) >= 8);
    }
}
