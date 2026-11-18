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
        using var admin = await fixture.Login("admin");
        using var anonymous = fixture.Client();
        Guid orgId, crisisId, volunteerId, partnerId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            orgId = await db.Set<Membership>().Where(x => x.Role == Roles.Logistics).Select(x => x.OrganisationId!.Value).SingleAsync();
            crisisId = await db.Set<Crisis>().Where(x => x.Name == "Kelani River flood response").Select(x => x.Id).SingleAsync();
            volunteerId = await db.Set<VolunteerProfile>().Select(x => x.Id).SingleAsync();
            partnerId = await db.Set<Organisation>().Where(o => o.Name == "Southern Relief Network (demo)").Select(o => o.Id).SingleAsync();
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
                description, "Synthetic Kelaniya collection point", 6.955, 79.92, 4, "Step-free access", quantity, Guid.NewGuid().ToString(), true,
                Unit: category == AidCategory.Shelter ? "household" : "pieces"));
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
        await Post(admin, "admin/users", new { email = "coursework-lk-partner@surakuma.test", name = "Synthetic supplier",
            password = fixture.Password, organisationId = partnerId, role = "Partner", countryCode = "LK" });
        using var partner = await fixture.Login("coursework-lk-partner");
        var area = await Post(coordinator, $"crises/{crisisId}/areas?countryCode=LK", new { name = "Synthetic flood response zone",
            geoJson = """{"type":"Polygon","coordinates":[[[79.86,6.91],[79.95,6.91],[79.95,6.98],[79.86,6.91]]]}""" });
        var alert = await Post(coordinator, "alerts?countryCode=LK", new PublicAlert
        {
            CrisisId = crisisId, Title = "Synthetic flood response notice", Message = "Test coordination notice.",
            SinhalaTitle = "ආදර්ශ නිවේදනය", SinhalaMessage = "මෙය පරීක්ෂණයකි.",
            TamilTitle = "மாதிரி அறிவிப்பு", TamilMessage = "இது ஒரு சோதனை.",
            Severity = "Advisory", Area = area.GetProperty("name").GetString()!, Authority = "Synthetic test authority",
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(2)
        });
        var alertId = alert.GetProperty("id").GetGuid();
        const string lk = "?countryCode=LK";
        Assert.DoesNotContain((await anonymous.GetFromJsonAsync<List<PublicAlert>>("/api/v1/alerts" + lk))!, a => a.Id == alertId);
        (await coordinator.PostAsync($"/api/v1/alerts/{alertId}/submit" + lk, null)).EnsureSuccessStatusCode();
        await Post(admin, $"alerts/{alertId}/approve" + lk, new { reason = "Verified synthetic alert wording and reporting zone." });
        (await coordinator.PostAsync($"/api/v1/alerts/{alertId}/publish" + lk, null)).EnsureSuccessStatusCode();
        Assert.Contains((await anonymous.GetFromJsonAsync<List<PublicAlert>>("/api/v1/alerts" + lk))!, a => a.Id == alertId);
        // A candidate with identical wording must remain accessible after being marked distinct.
        string description = "Synthetic flood household acceptance " + Guid.NewGuid() + " needs ten individual bottles of clean drinking water.";
        Guid candidateId = await Submit(AidCategory.FoodWater, 10, description);
        Guid foodId = await Submit(AidCategory.FoodWater, 10, description);
        const string pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv1sAAAAASUVORK5CYII=";
        using var image = new MultipartFormDataContent();
        image.Add(new ByteArrayContent(Convert.FromBase64String(pixel)), "file", "synthetic-evidence.png");
        using var uploaded = await citizen.PostAsync($"/api/v1/requests/{foodId}/attachments", image);
        uploaded.EnsureSuccessStatusCode();
        var attachmentId = (await uploaded.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.NotFound, (await partner.GetAsync($"/api/v1/requests/{foodId}/attachments/{attachmentId}")).StatusCode);
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
        var decisionPath = $"crises/{crisisId}/decision-support";
        await Post(coordinator, decisionPath + "/investigations/scan", new { });
        var review = await coordinator.GetFromJsonAsync<JsonElement>("/api/v1/" + decisionPath);
        var flag = review.GetProperty("flags").EnumerateArray().Single(f => f.GetProperty("requestId").GetGuid() == foodId &&
            f.GetProperty("category").GetString() == "Potential duplicate");
        await Post(coordinator, decisionPath + $"/investigations/{flag.GetProperty("id").GetGuid()}/review",
            new { outcome = "Dismissed", reason = "Household confirmed the requests describe separate aid needs." });
        (await manager.PostAsJsonAsync($"/api/v1/requests/{foodId}/duplicates/{duplicateId}", new
        {
            action = "Distinct"
        })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await manager.GetAsync($"/api/v1/requests/{candidateId}")).StatusCode);
        var beforeApproval = await manager.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{foodId}");
        Assert.Equal("Verified", beforeApproval.GetProperty("request").GetProperty("status").GetString());
        var taskInput = new TaskInput(foodId, volunteerId, "Acceptance household distribution", "distribution", DateTimeOffset.UtcNow.AddDays(1));
        Assert.Equal(HttpStatusCode.BadRequest, (await volunteers.PostAsJsonAsync("/api/v1/volunteer-tasks", taskInput)).StatusCode);
        Assert.DoesNotContain((await volunteers.GetFromJsonAsync<List<VolunteerCase>>("/api/v1/volunteer-tasks/cases"))!, r => r.Id == foodId);
        await Transition(foodId, "Approved");
        Assert.Contains((await volunteers.GetFromJsonAsync<List<VolunteerCase>>("/api/v1/volunteer-tasks/cases"))!, r => r.Id == foodId);

        // Piece-counted water is separate from the shared fixture's pack stock.
        var resource = await Post(logistics, "resources", new ResourceInput(orgId, "Acceptance water bottles", AidCategory.FoodWater, "pieces", 6, "Synthetic depot", 6.92, 79.88, "Individual sealed bottles", true));
        Guid resourceId = resource.GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync("/api/v1/allocations", new AllocateInput(foodId, resourceId, 10), DemonstrationJson)).StatusCode);
        async Task Deliver(int quantity)
        {
            var allocation = await Post(logistics, "allocations", new AllocateInput(foodId, resourceId, quantity));
            Guid id = allocation.GetProperty("id").GetGuid();
            (await logistics.PostAsync($"/api/v1/allocations/{id}/Dispatch", null)).EnsureSuccessStatusCode();
            var receipt = new DeliveryInput($"DEMO-{id:N}", quantity, null, "Synthetic household representative", "RecipientAcknowledgment");
            (await logistics.PostAsJsonAsync($"/api/v1/allocations/{id}/Deliver", receipt)).EnsureSuccessStatusCode();
            (await logistics.PostAsJsonAsync($"/api/v1/allocations/{id}/Deliver", receipt)).EnsureSuccessStatusCode();
            var stored = await logistics.GetFromJsonAsync<DeliveryConfirmation>($"/api/v1/allocations/{id}/receipt");
            Assert.Equal(receipt.Reference, stored!.Reference);
            Assert.Equal(quantity, stored.ConfirmedQuantity);
        }
        await Deliver(6);
        var partial = await citizen.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{foodId}");
        Assert.Equal("PartiallyFulfilled", partial.GetProperty("request").GetProperty("status").GetString());
        Assert.Equal(6, partial.GetProperty("request").GetProperty("deliveredQuantity").GetDecimal());
        var metrics = await coordinator.GetFromJsonAsync<JsonElement>("/api/v1/reports/metrics");
        Assert.True(metrics.GetProperty("openCases").GetInt32() > 0);
        Assert.All(metrics.GetProperty("stockByUnit").EnumerateArray(), row => Assert.True(row.GetProperty("stock").GetDecimal() >= 0));
        Assert.True(metrics.GetProperty("aiApprovedCount").GetInt32() >= 0);
        Assert.Contains(metrics.GetProperty("shortages").EnumerateArray(), x => x.GetProperty("id").GetGuid() == foodId && x.GetProperty("outstanding").GetDecimal() == 4);
        var ranking = await logistics.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{foodId}/allocation-recommendations");
        Assert.True(ranking.GetProperty("shortage").GetBoolean());
        var support = await Post(logistics, "supply-support/LK", new { operationId = Guid.NewGuid(), requestingOrganisationId = orgId,
            targetOrganisationId = partnerId, caseId = foodId, category = "FoodWater", unit = "pieces", quantity = 4,
            reason = "Synthetic flood response requires four more individual bottles." });
        var commitment = await Post(partner, "partner/contributions" + lk, new { operationId = Guid.NewGuid(), organisationId = partnerId,
            supportRequestId = support.GetProperty("id").GetGuid(), title = "Synthetic water bottles", kind = "Resource",
            category = "FoodWater", unit = "pieces", quantity = 4, description = "Verified partner has four individual bottles ready." });
        var commitmentId = commitment.GetProperty("id").GetGuid();
        await Post(admin, $"partner/contributions/{commitmentId}/accept" + lk, new { note = "Approved partner stock handoff for the remaining demand." });
        var handoff = await Post(logistics, $"supply-support/LK/contributions/{commitmentId}/receipts", new { operationId = Guid.NewGuid(),
            resourceId, quantity = 4, reference = "SYNTHETIC-FLOOD-HANDOFF" });

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

        var task = await Post(volunteers, "volunteer-tasks", taskInput);
        Assert.Equal(HttpStatusCode.BadRequest, (await volunteers.PostAsJsonAsync("/api/v1/volunteer-tasks", taskInput)).StatusCode);
        Guid taskId = task.GetProperty("id").GetGuid();
        foreach (string action in new[] { "Accept", "Start" })
            await Post(volunteer, $"volunteer-tasks/{taskId}", new TaskUpdateInput(action));
        Assert.Equal(HttpStatusCode.BadRequest, (await volunteer.PostAsJsonAsync($"/api/v1/volunteer-tasks/{taskId}", new TaskUpdateInput("Complete"))).StatusCode);
        var report = new TaskUpdateInput("Complete", "Finished the shift", "Distributed family packs", "Four households received packs", 4, "One household needed follow-up");
        var submitted = await Post(volunteer, $"volunteer-tasks/{taskId}", report);
        Assert.Equal("AwaitingVerification", submitted.GetProperty("status").GetString());
        var returned = await Post(volunteers, $"volunteer-tasks/{taskId}", new TaskUpdateInput("Return", "Clarify the follow-up plan."));
        Assert.Equal("Returned", returned.GetProperty("status").GetString());
        await Post(volunteer, $"volunteer-tasks/{taskId}", report with { Note = "Referred follow-up to the case manager." });
        Assert.Equal(HttpStatusCode.Forbidden, (await volunteer.PostAsJsonAsync($"/api/v1/volunteer-tasks/{taskId}", new TaskUpdateInput("Verify"))).StatusCode);
        var verified = await Post(volunteers, $"volunteer-tasks/{taskId}", new TaskUpdateInput("Verify", "Coordinator confirmed completion"));
        Assert.Equal("Completed", verified.GetProperty("status").GetString());
        await Deliver(4);
        await Transition(foodId, "Closed");
        await Transition(shelterCaseId, "Closed");
        (await citizen.PostAsJsonAsync($"/api/v1/requests/{foodId}/feedback", new FeedbackInput(5, true, false, "Synthetic receipt confirmed"))).EnsureSuccessStatusCode();
        var briefing = await Post(coordinator, decisionPath + "/briefings", new { days = 7 });
        await Post(admin, decisionPath + $"/briefings/{briefing.GetProperty("record").GetProperty("id").GetGuid()}/review",
            new { reason = "Compared recorded facts to the completed synthetic response." });
        var forecast = await Post(coordinator, decisionPath + "/forecasts", new { category = "FoodWater" });
        Assert.Equal(JsonValueKind.Null, forecast.GetProperty("record").GetProperty("estimate").ValueKind);
        using var exported = await admin.GetAsync($"/api/v1/admin/reports/export?countryCode=LK&crisisId={crisisId}");
        Assert.Equal("text/csv", exported.Content.Headers.ContentType?.MediaType);

        var worker = new NotificationWorker(fixture.Factory.Services.GetRequiredService<IServiceScopeFactory>(), NullLogger<NotificationWorker>.Instance);
        int pending;
        using (var scope = fixture.Factory.Services.CreateScope())
            pending = await scope.ServiceProvider.GetRequiredService<CrisisDbContext>().Set<OutboxMessage>().CountAsync(x => x.State == "Pending");
        for (int i = 0; i < pending; i++)
            await worker.ProcessOne(default);
        var notifications = await citizen.GetFromJsonAsync<JsonElement>("/api/v1/notifications");
        Assert.Contains(notifications.EnumerateArray(), x => x.GetProperty("requestId").GetGuid() == foodId);
        Assert.All(notifications.EnumerateArray(), x => Assert.False(x.GetProperty("isInternal").GetBoolean()));
        var citizenNotification = notifications.EnumerateArray().First();
        var citizenNotificationId = citizenNotification.GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.NotFound, (await manager.PostAsync($"/api/v1/notifications/{citizenNotificationId}/read", null)).StatusCode);
        var beforeRead = await citizen.GetFromJsonAsync<JsonElement>("/api/v1/notifications/unread-count");
        (await citizen.PostAsync($"/api/v1/notifications/{citizenNotificationId}/read", null)).EnsureSuccessStatusCode();
        var afterRead = await citizen.GetFromJsonAsync<JsonElement>("/api/v1/notifications/unread-count");
        Assert.Equal(beforeRead.GetProperty("count").GetInt32() - 1, afterRead.GetProperty("count").GetInt32());
        var staffNotifications = await manager.GetFromJsonAsync<JsonElement>("/api/v1/notifications");
        Assert.Contains(staffNotifications.EnumerateArray(), x => x.GetProperty("requestId").GetGuid() == foodId);
        var taskNotifications = await volunteer.GetFromJsonAsync<JsonElement>("/api/v1/notifications");
        var related = taskNotifications.EnumerateArray().Where(x => x.GetProperty("taskId").GetGuid() == taskId).ToArray();
        Assert.Equal(3, related.Length);
        Assert.Contains(related, x => x.GetProperty("message").GetString()!.Contains("returned for correction"));
        Assert.Contains(related, x => x.GetProperty("message").GetString()!.Contains("was verified"));
        var assigned = Assert.Single(related, x => x.GetProperty("message").GetString()!.StartsWith("Task assigned:"));
        var notificationId = assigned.GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.NotFound, (await citizen.PostAsync($"/api/v1/notifications/{notificationId}/read", null)).StatusCode);
        (await volunteer.PostAsync($"/api/v1/notifications/{notificationId}/read", null)).EnsureSuccessStatusCode();
        (await volunteer.PostAsync("/api/v1/notifications/read-all", null)).EnsureSuccessStatusCode();
        var unread = await volunteer.GetFromJsonAsync<JsonElement>("/api/v1/notifications/unread-count");
        Assert.Equal(0, unread.GetProperty("count").GetInt32());
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
        Assert.True(await database.Set<AuditEvent>().AnyAsync(x => x.Action == "PartnerContributionStockReceived" &&
            x.EntityId == handoff.GetProperty("id").GetGuid()));
        Assert.True(await database.Set<AuditEvent>().AnyAsync(x => x.Action == "PublicAlertPublished" && x.EntityId == alertId));
        Assert.All(await database.Set<OutboxMessage>().Where(x => x.RequestId == foodId).ToListAsync(), x => Assert.Equal("Captured", x.State));
        Assert.True(await database.Set<RequestHistory>().CountAsync(x => x.RequestId == foodId) >= 8);
    }
}
