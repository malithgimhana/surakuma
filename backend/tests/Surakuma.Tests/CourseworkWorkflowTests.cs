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

public sealed class CourseworkWorkflowTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task FundingLedgerReconcilesPledgesReceiptsStockAllocationsExpensesAndCapturedNotifications()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var need = await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(x => x.SubmissionKey == "seed-food");
        var resource = await db.Set<Resource>().AsNoTracking().SingleAsync(x => x.Name == "Family food packs");
        using var admin = await fixture.Login("admin");
        using var donor = await fixture.Login("citizen");
        using var volunteer = await fixture.Login("volunteer");
        using var logistics = await fixture.Login("logistics");
        using var anonymous = fixture.Client();
        const string funding = "/api/v1/funding/LK";
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(funding + "/workspace")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await donor.GetAsync(funding + "/workspace?manage=true")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await volunteer.GetAsync(funding + "/workspace?manage=true")).StatusCode);

        await Grant(admin, "funding-lk", need.OrganisationId!.Value, "LK", Roles.FundingOfficer, need.CrisisId);
        using var officer = await fixture.Login("funding-lk");
        Assert.Equal(HttpStatusCode.Forbidden, (await officer.GetAsync("/api/v1/funding/NP/workspace?manage=true")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await officer.GetAsync($"/api/v1/requests/{need.Id}")).StatusCode);
        var scopes = await officer.GetFromJsonAsync<JsonElement>(funding + "/options");
        Assert.Equal(need.CrisisId, Assert.Single(scopes.GetProperty("campaignScopes").EnumerateArray()).GetProperty("crisisId").GetGuid());
        var campaign = Id(await Post(officer, funding + "/campaigns", new { organisationId = need.OrganisationId, need.CrisisId,
            name = "Synthetic family relief fund", purpose = "Food and water for affected households", budget = 1000 }));
        (await donor.PutAsJsonAsync("/api/v1/funding/profile", new { displayName = "Synthetic donor", organisationName = "Community giving group" })).EnsureSuccessStatusCode();
        var money = new { operationId = Guid.NewGuid(), campaignId = campaign, kind = "Monetary", category = "FoodWater", amount = 1250 };
        var materials = new { operationId = Guid.NewGuid(), campaignId = campaign, kind = "Material", category = "FoodWater", amount = 4, unit = "packs" };
        var moneyId = Id(await Post(donor, funding + "/donations", money));
        Assert.Equal(moneyId, Id(await Post(donor, funding + "/donations", money)));
        var materialId = Id(await Post(donor, funding + "/donations", materials));
        var cancelledId = Id(await Post(donor, funding + "/donations", money with { operationId = Guid.NewGuid(), amount = 20 }));
        await Post(donor, funding + $"/donations/{cancelledId}/cancel");
        var before = await officer.GetFromJsonAsync<JsonElement>(funding + "/workspace?manage=true");
        var beforeTotals = Assert.Single(before.GetProperty("reports").EnumerateArray());
        Assert.Equal(1250, beforeTotals.GetProperty("pledged").GetDecimal());
        Assert.Equal(0, beforeTotals.GetProperty("received").GetDecimal());
        var reviewFlag = Id(Assert.Single(before.GetProperty("flags").EnumerateArray()));
        await Post(officer, funding + $"/investigations/{reviewFlag}/review", new { outcome = "Monitor", reason = "Verify supporting documents without restricting aid." });
        Assert.Empty((await volunteer.GetFromJsonAsync<JsonElement>(funding + "/workspace")).GetProperty("donations").EnumerateArray());
        Assert.Equal(HttpStatusCode.NotFound, (await volunteer.PostAsync(funding + $"/donations/{materialId}/cancel", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await donor.PostAsJsonAsync(funding + $"/donations/{moneyId}/confirm", new { reference = "unverified" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await officer.PostAsJsonAsync(funding + $"/donations/{moneyId}/allocations",
            new { operationId = Guid.NewGuid(), requestId = need.Id, amount = 100 })).StatusCode);
        await Post(officer, funding + $"/donations/{moneyId}/confirm", new { reference = "SYNTHETIC-TRANSFER-100" });
        Assert.Equal(HttpStatusCode.Forbidden, (await officer.PostAsJsonAsync(funding + $"/donations/{materialId}/confirm",
            new { reference = "DELIVERY-FOOD-01", resourceId = resource.Id })).StatusCode);
        var receipt = new { reference = "DELIVERY-FOOD-01", resourceId = resource.Id };
        await Post(admin, funding + $"/donations/{materialId}/confirm", receipt);
        await Post(admin, funding + $"/donations/{materialId}/confirm", receipt);
        Assert.Equal(resource.Stock + 4, await db.Set<Resource>().Where(x => x.Id == resource.Id).Select(r => r.Stock).SingleAsync());

        var allocationPath = funding + $"/donations/{materialId}/allocations";
        var contested = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => officer.PostAsJsonAsync(allocationPath,
            new { operationId = Guid.NewGuid(), requestId = need.Id, amount = 4 })));
        Assert.Single(contested, r => r.IsSuccessStatusCode);
        Assert.Single(contested, r => r.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.Conflict);
        var materialAllocation = Id(await contested.Single(r => r.IsSuccessStatusCode).Content.ReadFromJsonAsync<JsonElement>());
        var shipment = Id(await Post(logistics, "/api/v1/allocations", new { requestId = need.Id, resourceId = resource.Id, quantity = 4 }));
        (await logistics.PostAsync($"/api/v1/allocations/{shipment}/Dispatch", null)).EnsureSuccessStatusCode();
        await Post(logistics, $"/api/v1/allocations/{shipment}/Deliver", new { reference = "SYNTHETIC-CASE-RECEIPT",
            confirmedQuantity = 4, receivedAt = DateTimeOffset.UtcNow, method = "ReceivingStaff", receivedBy = "Synthetic receiver" });
        var logisticsReceipt = Id(await logistics.GetFromJsonAsync<JsonElement>($"/api/v1/allocations/{shipment}/receipt"));
        await Post(officer, funding + $"/allocations/{materialAllocation}/expenses", new { operationId = Guid.NewGuid(), amount = 4,
            reference = "MATERIAL-01", deliveryConfirmationId = logisticsReceipt });
        var financeAllocation = Id(await Post(officer, funding + $"/donations/{moneyId}/allocations", new {
            operationId = Guid.NewGuid(), requestId = need.Id, amount = 1100,
        }));
        var expense = new { operationId = Guid.NewGuid(), amount = 750, reference = "VERIFIED-INVOICE-01" };
        var expensePath = funding + $"/allocations/{financeAllocation}/expenses";
        var expenseId = Id(await Post(officer, expensePath, expense));
        Assert.Equal(expenseId, Id(await Post(officer, expensePath, expense)));
        Assert.Equal(HttpStatusCode.BadRequest, (await officer.PostAsJsonAsync(expensePath,
            expense with { operationId = Guid.NewGuid(), amount = 300, reference = "OVER-BUDGET" })).StatusCode);
        using var publicReport = await donor.GetAsync(funding + "/workspace");
        publicReport.EnsureSuccessStatusCode();
        var result = await publicReport.Content.ReadFromJsonAsync<JsonElement>();
        Assert.DoesNotContain("VERIFIED-INVOICE-01", result.GetRawText());
        Assert.DoesNotContain("SYNTHETIC-TRANSFER-100", result.GetRawText());
        var totals = Assert.Single(result.GetProperty("reports").EnumerateArray());
        Assert.Equal(1250, totals.GetProperty("received").GetDecimal());
        Assert.Equal(1100, totals.GetProperty("allocated").GetDecimal());
        Assert.Equal(750, totals.GetProperty("expended").GetDecimal());
        Assert.Contains(result.GetProperty("events").EnumerateArray(), e => e.GetProperty("state").GetString() == "Distributed");
        Assert.True(await db.Set<AuditEvent>().AnyAsync(a => a.EntityId == expenseId && a.CountryCode == "LK" && a.Action == "DonationExpenditureCreated"));

        var eventId = await db.Set<DonationEvent>().Where(e => e.DonationId == moneyId).OrderBy(e => e.CreatedAt).Select(e => e.Id).FirstAsync();
        var worker = new NotificationWorker(fixture.Factory.Services.GetRequiredService<IServiceScopeFactory>(), NullLogger<NotificationWorker>.Instance);
        for (int i = 0; i < 15 && !await db.Set<NotificationDelivery>().AnyAsync(d => d.EventId == eventId); i++)
            await worker.ProcessOne(CancellationToken.None);
        Assert.Equal("Captured", await db.Set<NotificationDelivery>().Where(d => d.EventId == eventId).Select(d => d.State).SingleAsync());
        await worker.ProcessOne(CancellationToken.None);
        Assert.Equal(1, await db.Set<NotificationDelivery>().CountAsync(d => d.EventId == eventId));
    }

    [Fact]
    public async Task CaseIndicatorsForecastsBriefingReviewConsolidationAndVolunteerConflictsRemainHumanControlled()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var seeded = await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(x => x.SubmissionKey == "seed-food");
        var volunteer = await db.Set<VolunteerProfile>().AsNoTracking().SingleAsync();
        using var coordinator = await fixture.Login("coordinator");
        using var admin = await fixture.Login("admin");
        using var citizen = await fixture.Login("citizen");
        using var manager = await fixture.Login("case");
        using var volunteers = await fixture.Login("volunteers");
        using var volunteerAccount = await fixture.Login("volunteer");
        const string requests = "/api/v1/requests";
        var path = $"/api/v1/crises/{seeded.CrisisId}/decision-support";
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.GetAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.GetAsync(path + "?countryCode=NP")).StatusCode);

        var sparse = await Post(coordinator, path + "/forecasts", new { category = "Transportation" });
        Assert.Equal(JsonValueKind.Null, sparse.GetProperty("record").GetProperty("estimate").ValueKind);
        var equivalent = new
        {
            seeded.CrisisId, seeded.OrganisationId, category = "FoodWater", priority = "Normal", description = "Synthetic coursework comparison needs the same family food packs.",
            locationText = "Synthetic Kelaniya collection point", latitude = 6.955, longitude = 79.92, householdSize = 4, accessibilityNeeds = "",
            quantity = 9, submissionKey = Guid.NewGuid().ToString(), synthetic = true,
        };
        var original = Id(await Post(citizen, requests, equivalent));
        var primary = Id(await Post(citizen, requests, equivalent with { submissionKey = Guid.NewGuid().ToString() }));
        Assert.True((await Post(manager, $"{requests}/{original}/recommendations/generate")).GetProperty("fallback").GetBoolean());
        await Post(coordinator, path + "/investigations/scan");
        var decision = await coordinator.GetFromJsonAsync<JsonElement>(path);
        var flags = decision.GetProperty("flags").EnumerateArray().ToArray();
        Assert.Contains(flags, f => f.GetProperty("requestId").GetGuid() == original && f.GetProperty("category").GetString() == "Potential duplicate");
        var flagId = Id(flags.First(f => f.GetProperty("requestId").GetGuid() == original));
        await Post(coordinator, path + $"/investigations/{flagId}/review", new { outcome = "Monitor", reason = "Reviewed both original references." });
        var consolidate = new { primaryRequestId = primary, reason = "Confirmed both submissions describe the same household need." };
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.PostAsJsonAsync($"{requests}/{original}/consolidate", consolidate)).StatusCode);
        await Post(manager, $"{requests}/{original}/consolidate", consolidate);
        var history = await citizen.GetFromJsonAsync<JsonElement>($"{requests}/{original}");
        Assert.Equal("Cancelled", history.GetProperty("request").GetProperty("status").GetString());
        Assert.Equal(primary, Assert.Single(history.GetProperty("consolidations").EnumerateArray()).GetProperty("primaryId").GetGuid());

        // Earlier synthetic rows supply stable history for an aggregate calculation.
        var now = DateTimeOffset.UtcNow;
        for (int week = 1; week <= 8; week++)
            db.Add(new AssistanceRequest { CitizenId = seeded.CitizenId, CrisisId = seeded.CrisisId, OrganisationId = seeded.OrganisationId,
                Category = AidCategory.Transportation, CreatedAt = now.AddDays(-7 * week), Quantity = 2, SubmissionKey = Guid.NewGuid().ToString(), Synthetic = true });
        await db.SaveChangesAsync();
        var forecast = await Post(coordinator, path + "/forecasts", new { category = "Transportation" });
        Assert.Equal(1m, forecast.GetProperty("record").GetProperty("estimate").GetDecimal());
        Assert.Equal(8, forecast.GetProperty("evidence").GetProperty("weeks").GetArrayLength());
        var draft = await Post(coordinator, path + "/briefings", new { days = 14 });
        var briefingId = Id(draft.GetProperty("record"));
        Assert.Contains("fallback", draft.GetProperty("record").GetProperty("source").GetString()!);
        Assert.True(draft.GetProperty("facts").GetProperty("activeCases").GetInt32() > 0);
        var reviewPath = path + $"/briefings/{briefingId}/review";
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.PostAsJsonAsync(reviewPath, new { reason = "Self-review denied." })).StatusCode);
        await Post(admin, reviewPath, new { reason = "Independently compared the internal draft to recorded facts." });
        var translation = await Post(coordinator, "/api/v1/alerts/translation-draft?countryCode=LK", new { seeded.CrisisId,
            language = "si", title = "Synthetic weather notice", message = "Synthetic test wording for the public notice.",
            publicWordingConfirmed = true });
        Assert.Equal("ManualTranslationRequired", translation.GetProperty("state").GetString());

        var caseIds = new[] { primary, Id(await Post(citizen, requests, equivalent with { submissionKey = Guid.NewGuid().ToString() })) };
        foreach (var caseId in caseIds)
            foreach (var status in new[] { "UnderReview", "Verified", "Approved" })
                (await manager.PatchAsJsonAsync($"{requests}/{caseId}/status", new { status, reason = "Authorized synthetic review." })).EnsureSuccessStatusCode();
        var firstTask = new { requestId = caseIds[0], volunteerId = volunteer.Id, title = "Synthetic shift", requiredSkill = "distribution",
            startsAt = now.AddMinutes(5), dueAt = now.AddHours(2) };
        var assigned = Id(await Post(volunteers, "/api/v1/volunteer-tasks", firstTask));
        var encodedStart = Uri.EscapeDataString(firstTask.startsAt.ToString("O"));
        var encodedEnd = Uri.EscapeDataString(firstTask.dueAt.ToString("O"));
        var matchPath = $"/api/v1/volunteer-tasks/candidates?requestId={caseIds[1]}&startsAt={encodedStart}&dueAt={encodedEnd}&skill=distribution";
        Assert.Empty((await volunteers.GetFromJsonAsync<JsonElement>(matchPath)).EnumerateArray());
        Assert.Equal(HttpStatusCode.BadRequest, (await volunteers.PostAsJsonAsync("/api/v1/volunteer-tasks", firstTask with { requestId = caseIds[1] })).StatusCode);
        await Post(volunteerAccount, $"/api/v1/volunteer-tasks/{assigned}", new { action = "Decline", note = "Synthetic schedule conflict." });
        Assert.Single((await volunteers.GetFromJsonAsync<JsonElement>(matchPath)).EnumerateArray());
        await Post(volunteers, "/api/v1/volunteer-tasks", firstTask with { requestId = caseIds[1] });
    }

    [Fact]
    public async Task ShelterShortageIsSharedOnlyWithTargetAndStockRequiresAnApprovedHandoff()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var shelter = await db.Set<Shelter>().AsNoTracking().SingleAsync(s => s.Name == "Riverside Community Centre");
        var resource = await db.Set<Resource>().AsNoTracking().SingleAsync(x => x.Name == "Family food packs");
        var target = await db.Set<Organisation>().AsNoTracking().SingleAsync(x => x.Name == "Southern Relief Network (demo)");
        using var admin = await fixture.Login("admin");
        using var shelterAdmin = await fixture.Login("shelter");
        using var logistics = await fixture.Login("logistics");
        using var citizen = await fixture.Login("citizen");
        await Grant(admin, "supplier", target.Id, "LK", Roles.Partner);
        using var supplier = await fixture.Login("supplier");
        const string supply = "/api/v1/supply-support/LK";
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.GetAsync("/api/v1/countries/LK/coverage")).StatusCode);
        var coverage = await admin.GetFromJsonAsync<JsonElement>("/api/v1/countries/LK/coverage?countryCode=LK");
        Assert.Equal(await db.Set<Shelter>().CountAsync(s => s.CountryCode == "LK" && s.Open),
            coverage.EnumerateArray().Sum(row => row.GetProperty("openShelters").GetInt32()));
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync("/api/v1/countries/LK/coverage?countryCode=NP")).StatusCode);
        var request = Id(await Post(shelterAdmin, supply, new { operationId = Guid.NewGuid(),
            requestingOrganisationId = shelter.OrganisationId, targetOrganisationId = target.Id, shelterId = shelter.Id,
            category = "FoodWater", unit = "packs", quantity = 5, reason = "Synthetic shelter food pack shortage." }));
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.GetAsync(supply)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await supplier.GetAsync("/api/v1/supply-support/NP")).StatusCode);
        var supplyInbox = await supplier.GetFromJsonAsync<JsonElement>(supply);
        Assert.Equal(request, Id(Assert.Single(supplyInbox.GetProperty("requests").EnumerateArray())));
        Assert.DoesNotContain(shelter.Id.ToString(), supplyInbox.GetRawText());

        var offer = Id(await Post(supplier, "/api/v1/partner/contributions?countryCode=LK", new { operationId = Guid.NewGuid(),
            organisationId = target.Id, title = "Synthetic food pack handoff", kind = "Resource", unit = "packs",
            category = "FoodWater", quantity = 5, supportRequestId = request, description = "Stock is available for handoff after approval." }));
        var receivePath = supply + $"/contributions/{offer}/receipts";
        var receipt = new { operationId = Guid.NewGuid(), resourceId = resource.Id, quantity = 5, reference = "SYNTHETIC-HANDOFF-01" };
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync(receivePath, receipt)).StatusCode);
        Assert.Equal(resource.Stock, await db.Set<Resource>().Where(r => r.Id == resource.Id).Select(r => r.Stock).SingleAsync());
        await Post(admin, $"/api/v1/partner/contributions/{offer}/accept?countryCode=LK", new { note = "Reviewed the supply offer and approved the proposed handoff." });
        Assert.Equal(HttpStatusCode.Forbidden, (await supplier.PostAsJsonAsync(receivePath, receipt)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await shelterAdmin.PostAsJsonAsync(receivePath, receipt)).StatusCode);
        var options = await logistics.GetFromJsonAsync<JsonElement>(receivePath);
        Assert.Contains(options.GetProperty("resources").EnumerateArray(), r => Id(r) == resource.Id);
        var receiptId = Id(await Post(logistics, receivePath, receipt));
        Assert.Equal(receiptId, Id(await Post(logistics, receivePath, receipt)));
        Assert.Equal(resource.Stock + 5, await db.Set<Resource>().Where(r => r.Id == resource.Id).Select(r => r.Stock).SingleAsync());
        Assert.Equal(5, await db.Set<SupplyRequest>().Where(r => r.Id == request).Select(r => r.ReceivedQuantity).SingleAsync());
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync(receivePath,
            receipt with { operationId = Guid.NewGuid(), reference = "SECOND-RECEIPT" })).StatusCode);
    }


    [Theory]
    [InlineData("IN", "Delhi", "hi", 28.61, 77.2)]
    [InlineData("NP", "Bagmati", "ne", 27.7, 85.3)]
    public async Task RegionalResponseUsesLocalGeographyAlertPolicyInventorySheltersAndScopedStaff(
        string country, string regionName, string language, double latitude, double longitude)
    {
        using var admin = await fixture.Login("admin");
        using var citizen = await fixture.Login("citizen");
        using var foreign = await fixture.Login("coordinator");
        using var anonymous = fixture.Client();
        var organisation = Id((await anonymous.GetFromJsonAsync<JsonElement>("/api/v1/public/lookups"))
            .GetProperty("organisations").EnumerateArray().First(o => o.GetProperty("name").GetString()!.Contains("Community Response")));
        using var registration = await admin.PutAsync($"/api/v1/admin/organisations/{organisation}/countries/{country}", null);
        registration.EnsureSuccessStatusCode();
        await Post(admin, $"/api/v1/admin/organisations/{organisation}/countries/{country}/verification",
            new { evidence = "Synthetic national partner documentation.", decision = "Verified", reason = "Checked authorised operations." });
        var regions = await anonymous.GetFromJsonAsync<JsonElement>($"/api/v1/countries/{country}/divisions");
        var region = regions.EnumerateArray().First(d => d.GetProperty("parentId").ValueKind == JsonValueKind.Null &&
            d.GetProperty("name").GetString()!.Contains(regionName, StringComparison.OrdinalIgnoreCase));
        var division = Id(region);
        var localName = "coursework-admin-" + country.ToLowerInvariant();
        await Grant(admin, localName, Guid.Empty, country, Roles.CountryAdministrator);
        using var local = await fixture.Login(localName);
        var countryQuery = "?countryCode=" + country;
        var crisis = Id(await Post(local, "/api/v1/crises" + countryQuery, new
        {
            countryCode = country, name = "Synthetic " + country + " relief response", type = "Flood",
            administrativeDivisionId = division, latitude, longitude, active = true,
        }));
        (await local.PutAsJsonAsync($"/api/v1/crises/{crisis}/centre" + countryQuery, new { organisationId = organisation })).EnsureSuccessStatusCode();
        var coordinatorName = "coursework-coordinator-" + country.ToLowerInvariant();
        await Grant(local, coordinatorName, organisation, country, Roles.Coordinator, crisis);
        using var coordinator = await fixture.Login(coordinatorName);
        var translations = JsonSerializer.Serialize(new Dictionary<string, object> { [language] = new {
            title = "परीक्षण सूचना", message = country == "IN" ? "केवल परीक्षण।" : "परीक्षणका लागि मात्र।",
        } });
        var alert = Id(await Post(coordinator, "/api/v1/alerts" + countryQuery, new PublicAlert
        {
            CrisisId = crisis, Title = "Synthetic relief notice " + country, Message = "Synthetic exercise notice.",
            Area = regionName, Authority = "Synthetic local authority", ExpiresAt = DateTimeOffset.UtcNow.AddHours(2),
            Severity = "Advisory", TranslationsJson = translations,
        }));
        (await coordinator.PostAsync($"/api/v1/alerts/{alert}/submit" + countryQuery, null)).EnsureSuccessStatusCode();
        await Post(local, $"/api/v1/alerts/{alert}/approve" + countryQuery, new { reason = "Reviewed the applicable local wording and expiry." });
        (await coordinator.PostAsync($"/api/v1/alerts/{alert}/publish" + countryQuery, null)).EnsureSuccessStatusCode();
        Assert.Contains((await anonymous.GetFromJsonAsync<List<PublicAlert>>("/api/v1/alerts" + countryQuery))!, x => x.Id == alert);
        Assert.DoesNotContain((await anonymous.GetFromJsonAsync<List<PublicAlert>>("/api/v1/alerts?countryCode=LK"))!, x => x.Id == alert);
        var shelter = Id(await Post(local, "/api/v1/shelters" + countryQuery, new
        {
            organisationId = organisation, name = country + " synthetic accessible centre", address = "Synthetic arrival point",
            countryCode = country, latitude, longitude, administrativeDivisionId = division, capacity = 10,
            accessible = true, open = true, facilities = "Step-free entry and toilets",
        }));
        var inventory = Id(await Post(local, "/api/v1/resources" + countryQuery, new
        {
            organisationId = organisation, countryCode = country, name = "Synthetic regional water packs",
            category = "FoodWater", unit = "packs", stock = 12, locationText = "Synthetic regional depot", latitude,
            longitude, administrativeDivisionId = division, suitability = "Family packs", transportAvailable = true,
        }));
        async Task<Guid> Request(string category, int quantity)
        {
            var id = Id(await Post(citizen, "/api/v1/requests" + countryQuery, new
            {
                crisisId = crisis, organisationId = organisation, category, priority = "Normal",
                description = "Synthetic regional household needs approved assistance.", locationText = "Synthetic household checkpoint",
                latitude, longitude, householdSize = 3, accessibilityNeeds = "Step-free entry", quantity,
                submissionKey = Guid.NewGuid().ToString(), synthetic = true,
            }));
            foreach (var status in new[] { "UnderReview", "Verified", "Approved" })
                (await local.PatchAsJsonAsync($"/api/v1/requests/{id}/status" + countryQuery, new { status, reason = "Regional synthetic case review." })).EnsureSuccessStatusCode();
            return id;
        }

        var foodCase = await Request("FoodWater", 3);
        var shelterCase = await Request("Shelter", 1);
        var shipment = Id(await Post(local, "/api/v1/allocations" + countryQuery, new { requestId = foodCase, resourceId = inventory, quantity = 3 }));
        (await local.PostAsync($"/api/v1/allocations/{shipment}/Dispatch" + countryQuery, null)).EnsureSuccessStatusCode();
        await Post(local, $"/api/v1/allocations/{shipment}/Deliver" + countryQuery, new {
            reference = "SYNTHETIC-" + country, confirmedQuantity = 3, method = "ReceivingStaff", receivedBy = "Synthetic receiver",
        });
        var stay = Id(await Post(local, "/api/v1/shelter-allocations" + countryQuery, new { requestId = shelterCase, shelterId = shelter }));
        (await local.PostAsync($"/api/v1/shelter-allocations/{stay}/CheckIn" + countryQuery, null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound, (await foreign.GetAsync($"/api/v1/requests/{foodCase}" + countryQuery)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await foreign.GetAsync($"/api/v1/crises/{crisis}/decision-support" + countryQuery)).StatusCode);
        var records = await local.GetFromJsonAsync<JsonElement>($"/api/v1/countries/{country}/coverage" + countryQuery);
        Assert.Contains(records.EnumerateArray(), row => row.GetProperty("region").GetString() == region.GetProperty("name").GetString() &&
            row.GetProperty("openShelters").GetInt32() > 0 && row.GetProperty("transportReadyStockItems").GetInt32() > 0);
        Assert.Contains((await anonymous.GetFromJsonAsync<List<PublicShelter>>("/api/v1/shelters" + countryQuery))!, x => x.Id == shelter && x.Occupancy == 3);
    }

    private async Task Grant(HttpClient admin, string name, Guid organisationId, string countryCode, string role, Guid? crisisId = null) =>
        await Post(admin, "/api/v1/admin/users", new { email = name + "@surakuma.test", name, password = fixture.Password,
            organisationId, role, countryCode, crisisId });

    private static Guid Id(JsonElement element) => element.GetProperty("id").GetGuid();

    private static async Task<JsonElement> Post(HttpClient actor, string path, object? body = null)
    {
        using var response = await actor.PostAsJsonAsync(path, body ?? new { });
        var json = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"{path} returned {(int)response.StatusCode}: {json}");
        return response.StatusCode == HttpStatusCode.NoContent ? default : JsonSerializer.Deserialize<JsonElement>(json);
    }
}
