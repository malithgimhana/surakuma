using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed partial class IntegrationTests
{
    [Fact]
    public async Task EscalationHasDistinctHistoryWithoutChangingStatus()
    {
        using var coordinator = await fixture.Login("coordinator");
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var request = await db.Set<AssistanceRequest>().FirstAsync(x => x.SubmissionKey == "seed-food");
        string originalStatus = request.Status.ToString();
        var response = await coordinator.PostAsJsonAsync($"/api/v1/requests/{request.Id}/escalate", new { action = "Escalate", note = "Needs coordinator attention" });
        response.EnsureSuccessStatusCode();
        var detail = await coordinator.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{request.Id}");
        Assert.Equal(originalStatus, detail.GetProperty("request").GetProperty("status").GetString());
        Assert.Contains(detail.GetProperty("history").EnumerateArray(), h => h.GetProperty("status").GetString() == "Escalated");
    }
    [Fact]
    public async Task InvalidCoordinatesAreRejectedBeforeCreatingPublicShelter()
    {
        using var client = await fixture.Login("shelter");
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        Guid organisationId = await db.Set<Membership>().Where(x => x.Role == Roles.ShelterAdmin).Select(x => x.OrganisationId).FirstAsync();
        var result = await client.PostAsJsonAsync("/api/v1/shelters", new
        {
            organisationId,
            name = "Invalid coordinate test",
            address = "Demo location",
            latitude = 999,
            longitude = 79.8,
            capacity = 10,
            accessible = true,
            open = true,
            facilities = "Demo"
        });
        Assert.Equal(HttpStatusCode.BadRequest, result.StatusCode);
        Assert.False(await db.Set<Shelter>().AnyAsync(x => x.Name == "Invalid coordinate test"));
    }
    [Fact]
    public async Task OrganisationAccessRequiresAssignmentByCoordinator()
    {
        string account = "partner" + Guid.NewGuid().ToString("N")[..8];
        Guid requestId, partnerId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var seed = await db.Set<AssistanceRequest>().FirstAsync(x => x.SubmissionKey == "seed-food");
            var request = new AssistanceRequest { CitizenId = seed.CitizenId, CrisisId = seed.CrisisId, OrganisationId = seed.OrganisationId, Category = AidCategory.FoodWater, Description = "Synthetic organisation access test", LocationText = "Synthetic location", SubmissionKey = Guid.NewGuid().ToString() };
            db.Add(request);
            requestId = request.Id;
            partnerId = await db.Set<Organisation>().Where(o => o.Id != request.OrganisationId).Select(o => o.Id).FirstAsync();
            var user = new AppUser { UserName = account + "@surakuma.test", Email = account + "@surakuma.test", DisplayName = "Synthetic partner officer" };
            Assert.True((await users.CreateAsync(user, fixture.Password)).Succeeded);
            await users.AddToRoleAsync(user, Roles.CaseManager);
            db.Add(new Membership { UserId = user.Id, OrganisationId = partnerId, Role = Roles.CaseManager });
            await db.SaveChangesAsync();
        }
        using var partner = await fixture.Login(account);
        Assert.Equal(HttpStatusCode.NotFound, (await partner.GetAsync($"/api/v1/requests/{requestId}")).StatusCode);
        using var coordinator = await fixture.Login("coordinator");
        Assert.Equal(HttpStatusCode.BadRequest, (await coordinator.PostAsJsonAsync($"/api/v1/requests/{requestId}/shares", new
        {
            organisationId = partnerId
        })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await partner.GetAsync($"/api/v1/requests/{requestId}")).StatusCode);
        (await coordinator.PostAsJsonAsync($"/api/v1/requests/{requestId}/reassign", new { organisationId = partnerId })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await partner.GetAsync($"/api/v1/requests/{requestId}")).StatusCode);
    }
    [Fact]
    public async Task ConcurrentShelterReservationsCannotOverbookAndCheckInIsSeparate()
    {
        Guid firstId, secondId, shelterId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var seed = await db.Set<AssistanceRequest>().FirstAsync();
            var shelter = new Shelter { OrganisationId = seed.OrganisationId!.Value, Name = "Concurrency test shelter", Capacity = 5, Accessible = true };
            db.Add(shelter);
            shelterId = shelter.Id;
            var first = new AssistanceRequest { CitizenId = seed.CitizenId, CrisisId = seed.CrisisId, OrganisationId = seed.OrganisationId, Category = AidCategory.Shelter, HouseholdSize = 4, Quantity = 1, Status = RequestStatus.Approved, SubmissionKey = Guid.NewGuid().ToString() };
            var second = new AssistanceRequest { CitizenId = seed.CitizenId, CrisisId = seed.CrisisId, OrganisationId = seed.OrganisationId, Category = AidCategory.Shelter, HouseholdSize = 4, Quantity = 1, Status = RequestStatus.Approved, SubmissionKey = Guid.NewGuid().ToString() };
            db.AddRange(first, second);
            await db.SaveChangesAsync();
            firstId = first.Id;
            secondId = second.Id;
        }
        using var a = await fixture.Login("shelter");
        using var b = await fixture.Login("shelter");
        var results = await Task.WhenAll(a.PostAsJsonAsync("/api/v1/shelter-allocations", new
        {
            requestId = firstId,
            shelterId
        }), b.PostAsJsonAsync("/api/v1/shelter-allocations", new
        {
            requestId = secondId,
            shelterId
        }));
        var winner = Assert.Single(results, r => r.IsSuccessStatusCode);
        Assert.All(results.Where(r => !r.IsSuccessStatusCode), r => Assert.Contains(r.StatusCode, new[] { HttpStatusCode.BadRequest, HttpStatusCode.Conflict }));
        Guid placementId = (await winner.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var shelter = await scope.ServiceProvider.GetRequiredService<CrisisDbContext>().Set<Shelter>().FindAsync(shelterId);
            Assert.Equal(4, shelter!.Reserved);
            Assert.Equal(0, shelter.Occupancy);
        }
        (await a.PostAsync($"/api/v1/shelter-allocations/{placementId}/CheckIn", null)).EnsureSuccessStatusCode();
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var shelter = await scope.ServiceProvider.GetRequiredService<CrisisDbContext>().Set<Shelter>().FindAsync(shelterId);
            Assert.Equal(0, shelter!.Reserved);
            Assert.Equal(4, shelter.Occupancy);
        }
        (await a.PostAsync($"/api/v1/shelter-allocations/{placementId}/Depart", null)).EnsureSuccessStatusCode();
    }
    [Fact]
    public async Task AllocationRecommendationsRequireStaffAndAuditHumanChoices()
    {
        Guid requestId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var seed = await db.Set<AssistanceRequest>().FirstAsync();
            var request = new AssistanceRequest { CitizenId = seed.CitizenId, CrisisId = seed.CrisisId, OrganisationId = seed.OrganisationId, Category = AidCategory.FoodWater, Quantity = 10, Status = RequestStatus.Approved, SubmissionKey = Guid.NewGuid().ToString() };
            db.Add(request); db.Add(new Resource { OrganisationId = seed.OrganisationId!.Value, Name = "Recommendation stock", Category = AidCategory.FoodWater, Unit = "packs", Stock = 10 });
            await db.SaveChangesAsync(); requestId = request.Id;
        }
        using var citizen = await fixture.Login("citizen");
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.GetAsync($"/api/v1/requests/{requestId}/allocation-recommendations")).StatusCode);
        using var logistics = await fixture.Login("logistics");
        var suggestions = await logistics.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{requestId}/allocation-recommendations");
        var candidate = suggestions.GetProperty("candidates").EnumerateArray().First(x => x.GetProperty("transportAvailable").GetBoolean());
        Guid resourceId = candidate.GetProperty("resourceId").GetGuid();
        var stale = await logistics.PostAsJsonAsync("/api/v1/allocations", new { requestId, resourceId, quantity = 1, recommendedResourceId = Guid.NewGuid() });
        Assert.Equal(HttpStatusCode.BadRequest, stale.StatusCode);
        (await logistics.PostAsJsonAsync($"/api/v1/requests/{requestId}/allocation-recommendations/ignore", new { recommendedResourceId = resourceId })).EnsureSuccessStatusCode();
        (await logistics.PostAsJsonAsync("/api/v1/allocations", new { requestId, resourceId, quantity = 1, recommendedResourceId = resourceId })).EnsureSuccessStatusCode();
        using var check = fixture.Factory.Services.CreateScope();
        var audits = await check.ServiceProvider.GetRequiredService<CrisisDbContext>().Set<AuditEvent>().Where(x => x.EntityId == requestId).Select(x => x.Action).ToListAsync();
        Assert.Contains("AllocationRecommendationIgnored", audits); Assert.Contains("AllocationRecommendationAccepted", audits);
    }
    [Fact]
    public async Task MetricsCountApprovalModificationRejectionAndDeferral()
    {
        using var coordinator = await fixture.Login("coordinator");
        var before = await coordinator.GetFromJsonAsync<JsonElement>("/api/v1/reports/metrics");
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var request = await db.Set<AssistanceRequest>().FirstAsync(x => x.SubmissionKey == "seed-food");
            var recommendation = new Recommendation { RequestId = request.Id };
            db.Add(recommendation);
            foreach (var action in new[] { "Approve", "Modify", "Reject", "Defer" })
                db.Add(new HumanDecision { RequestId = request.Id, RecommendationId = recommendation.Id, Action = action });
            await db.SaveChangesAsync();
        }
        var after = await coordinator.GetFromJsonAsync<JsonElement>("/api/v1/reports/metrics");
        foreach (var field in new[] { "aiApprovedCount", "aiModifiedCount", "aiRejectedCount", "aiDeferredCount" })
            Assert.Equal(before.GetProperty(field).GetInt32() + 1, after.GetProperty(field).GetInt32());
        int modified = after.GetProperty("aiModifiedCount").GetInt32(), rejected = after.GetProperty("aiRejectedCount").GetInt32();
        int total = modified + rejected + after.GetProperty("aiApprovedCount").GetInt32() + after.GetProperty("aiDeferredCount").GetInt32();
        Assert.Equal((double)(modified + rejected) / total, after.GetProperty("aiOverrideFrequency").GetDouble(), 8);
    }
    [Fact]
    public async Task QuantityRulesAreEnforcedAcrossRequestAndResourceEndpoints()
    {
        Guid requestId, orgId, crisisId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var seed = await db.Set<AssistanceRequest>().FirstAsync();
            orgId = seed.OrganisationId!.Value; crisisId = seed.CrisisId;
            var request = new AssistanceRequest { CitizenId = seed.CitizenId, CrisisId = crisisId, OrganisationId = orgId, Category = AidCategory.FoodWater, Quantity = 10, Status = RequestStatus.Approved, SubmissionKey = Guid.NewGuid().ToString() };
            db.Add(request); await db.SaveChangesAsync(); requestId = request.Id;
        }
        using var citizen = await fixture.Login("citizen");
        var submission = new { crisisId, organisationId = orgId, category = "FoodWater", priority = "High", description = "Synthetic request for food supplies", locationText = "Test location", householdSize = 2, accessibilityNeeds = "", quantity = 2.5m, submissionKey = Guid.NewGuid().ToString(), synthetic = true };
        Assert.Equal(HttpStatusCode.BadRequest, (await citizen.PostAsJsonAsync("/api/v1/requests", submission)).StatusCode);
        using var logistics = await fixture.Login("logistics");
        object ResourceInput(string unit, decimal stock) => new { organisationId = orgId, name = "Quantity test " + unit, category = "FoodWater", unit, stock, locationText = "Depot", latitude = 6.9, longitude = 79.9, suitability = "", transportAvailable = true };
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync("/api/v1/resources", ResourceInput("kits", 2.5m))).StatusCode);
        var kitResponse = await logistics.PostAsJsonAsync("/api/v1/resources", ResourceInput("kits", 5));
        kitResponse.EnsureSuccessStatusCode();
        Guid kits = (await kitResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var kgResponse = await logistics.PostAsJsonAsync("/api/v1/resources", ResourceInput("kg", 5.5m));
        kgResponse.EnsureSuccessStatusCode();
        Guid kg = (await kgResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync($"/api/v1/resources/{kits}/replenish", new { quantity = 1.5m, note = "test" })).StatusCode);
        (await logistics.PostAsJsonAsync($"/api/v1/resources/{kg}/replenish", new { quantity = 1.5m, note = "test" })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync("/api/v1/allocations", new { requestId, resourceId = kits, quantity = 1.5m })).StatusCode);
        (await logistics.PostAsJsonAsync("/api/v1/allocations", new { requestId, resourceId = kg, quantity = 1.5m })).EnsureSuccessStatusCode();
    }
    [Fact]
    public async Task PartialDeliveryRemainderAndClosureWorkEndToEnd()
    {
        Guid requestId, resourceId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var seed = await db.Set<AssistanceRequest>().FirstAsync();
            string citizenId = await db.Users.Where(x => x.UserName == "citizen@surakuma.test").Select(x => x.Id).SingleAsync();
            var request = new AssistanceRequest { CitizenId = citizenId, CrisisId = seed.CrisisId, OrganisationId = seed.OrganisationId, Category = AidCategory.FoodWater, Quantity = 10, Status = RequestStatus.Approved, SubmissionKey = Guid.NewGuid().ToString() };
            var resource = new Resource { OrganisationId = seed.OrganisationId!.Value, Name = "Delivery test packs", Category = AidCategory.FoodWater, Stock = 6 };
            db.AddRange(request, resource);
            await db.SaveChangesAsync();
            requestId = request.Id;
            resourceId = resource.Id;
        }
        using var logistics = await fixture.Login("logistics");
        async Task Deliver(int quantity)
        {
            var response = await logistics.PostAsJsonAsync("/api/v1/allocations", new
            {
                requestId,
                resourceId,
                quantity
            });
            response.EnsureSuccessStatusCode();
            Guid id = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
            (await logistics.PostAsync($"/api/v1/allocations/{id}/Dispatch", null)).EnsureSuccessStatusCode();
            (await logistics.PostAsync($"/api/v1/allocations/{id}/Deliver", null)).EnsureSuccessStatusCode();
        }
        await Deliver(6);
        var partial = await logistics.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{requestId}");
        Assert.Equal("PartiallyFulfilled", partial.GetProperty("request").GetProperty("status").GetString());
        (await logistics.PostAsJsonAsync($"/api/v1/resources/{resourceId}/replenish", new
        {
            quantity = 4,
            note = "Synthetic replenishment"
        })).EnsureSuccessStatusCode();
        await Deliver(4);
        using var manager = await fixture.Login("case");
        (await manager.PatchAsJsonAsync($"/api/v1/requests/{requestId}/status", new
        {
            status = "Closed",
            reason = "Delivery verified by staff."
        })).EnsureSuccessStatusCode();
        var completed = await logistics.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{requestId}");
        Assert.Equal(10, completed.GetProperty("request").GetProperty("deliveredQuantity").GetDecimal());
        Assert.Equal("Closed", completed.GetProperty("request").GetProperty("status").GetString());
        using var citizen = await fixture.Login("citizen");
        (await citizen.PostAsJsonAsync($"/api/v1/requests/{requestId}/feedback", new
        {
            rating = 4,
            received = true,
            problem = true,
            comment = "Synthetic delivery issue for staff review."
        })).EnsureSuccessStatusCode();
        var reviewed = await manager.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{requestId}");
        Assert.True(reviewed.GetProperty("request").GetProperty("escalated").GetBoolean());
        Assert.Contains(reviewed.GetProperty("feedback").EnumerateArray(), x => x.GetProperty("comment").GetString() == "Synthetic delivery issue for staff review.");
    }
    [Fact]
    public async Task ReprocessingCapturedEventDoesNotCreateDuplicateNotificationOrDelivery()
    {
        Guid eventId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var r = await db.Set<AssistanceRequest>().FirstAsync();
            var message = new OutboxMessage { UserId = r.CitizenId, RequestId = r.Id, Message = "Synthetic test update", SinhalaMessage = "ආදර්ශ දැනුම්දීම", TamilMessage = "மாதிரி அறிவிப்பு" };
            db.Add(message);
            await db.SaveChangesAsync();
            eventId = message.Id;
        }
        var worker = new NotificationWorker(fixture.Factory.Services.GetRequiredService<IServiceScopeFactory>(), NullLogger<NotificationWorker>.Instance);
        for (int i = 0; i < 30; i++)
            await worker.ProcessOne(default);
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var message = await db.Set<OutboxMessage>().FindAsync(eventId);
            Assert.Equal("Captured", message!.State);
            message.State = "Pending";
            message.NextAttemptAt = DateTimeOffset.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        }
        await worker.ProcessOne(default);
        using var check = fixture.Factory.Services.CreateScope();
        var database = check.ServiceProvider.GetRequiredService<CrisisDbContext>();
        Assert.Equal(1, await database.Set<Notification>().CountAsync(x => x.EventId == eventId));
        Assert.Equal(1, await database.Set<NotificationDelivery>().CountAsync(x => x.EventId == eventId));
    }
    [Fact]
    public async Task RefreshTokenRotationRejectsReplayAndRevokesTokenFamily()
    {
        using var client = fixture.Factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), HandleCookies = false });
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new
        {
            email = "citizen@surakuma.test",
            password = fixture.Password
        });
        login.EnsureSuccessStatusCode();
        string originalCookie = login.Headers.GetValues("Set-Cookie").First().Split(';')[0];
        client.DefaultRequestHeaders.Add("Cookie", originalCookie);
        var first = await client.PostAsync("/api/v1/auth/refresh", null);
        first.EnsureSuccessStatusCode();
        string rotatedCookie = first.Headers.GetValues("Set-Cookie").First().Split(';')[0];
        Assert.NotEqual(originalCookie, rotatedCookie);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/v1/auth/refresh", null)).StatusCode);
        client.DefaultRequestHeaders.Remove("Cookie");
        client.DefaultRequestHeaders.Add("Cookie", rotatedCookie);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/v1/auth/refresh", null)).StatusCode);
    }
}
