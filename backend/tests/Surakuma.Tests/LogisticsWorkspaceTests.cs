using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class LogisticsWorkspaceTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    private const string Scope = "?staffRole=Logistics&countryCode=LK";
    private const string Cases = "/api/v1/logistics/cases";

    [Fact]
    public async Task CrisisAssignedStaffCanRegisterDepotStockAndReserveItForTheirCase()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var seed = await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(r => r.SubmissionKey == "seed-food");
        var organisationId = seed.OrganisationId!.Value;
        var otherOrganisation = await db.Set<Organisation>().AsNoTracking().SingleAsync(o => o.Name == "Southern Relief Network (demo)");
        var otherCrisis = await db.Set<Crisis>().Where(c => c.CountryCode == "LK" && c.Id != seed.CrisisId).Select(c => c.Id).FirstAsync();
        AssistanceRequest TestCase(Guid crisisId) => new()
        {
            CrisisId = crisisId, OrganisationId = organisationId, CitizenId = seed.CitizenId,
            Category = AidCategory.FoodWater, Status = RequestStatus.Approved, Unit = "l", Quantity = 3,
            SubmissionKey = Guid.NewGuid().ToString(),
        };
        var assignedCase = TestCase(seed.CrisisId);
        var outsideCase = TestCase(otherCrisis);
        db.AddRange(assignedCase, outsideCase);
        await db.SaveChangesAsync();

        const string account = "crisis-logistics";
        using var admin = await fixture.Login("admin");
        (await admin.PostAsJsonAsync("/api/v1/admin/users?countryCode=LK", new
        {
            email = account + "@surakuma.test", name = "Crisis Logistics", password = fixture.Password,
            organisationId, countryCode = "LK", role = Roles.Logistics, crisisId = seed.CrisisId,
        })).EnsureSuccessStatusCode();
        using var logistics = await fixture.Login(account);
        const string dashboard = "/api/v1/logistics" + Scope + "&specialist=true";
        const string depots = "/api/v1/logistics/depots" + Scope;
        const string resources = "/api/v1/resources" + Scope;
        var before = await logistics.GetFromJsonAsync<JsonElement>(dashboard);
        Assert.Empty(before.GetProperty("partners").EnumerateArray());
        var registration = Assert.Single(before.GetProperty("resourceRegistration").GetProperty("partners").EnumerateArray());
        Assert.Equal(organisationId, Id(registration));
        Assert.True(registration.GetProperty("canRegisterDepot").GetBoolean());

        var depot = new { operationId = Guid.NewGuid(), countryCode = "LK", organisationId, name = "Crisis response depot", location = "Colombo" };
        Assert.Equal(HttpStatusCode.Forbidden, (await logistics.PostAsJsonAsync(depots, depot with { organisationId = otherOrganisation.Id })).StatusCode);
        (await logistics.PostAsJsonAsync(depots, depot)).EnsureSuccessStatusCode();
        var stock = new { operationId = Guid.NewGuid(), organisationId, depotId = depot.operationId, countryCode = "LK",
            name = "Crisis drinking water", category = "FoodWater", unit = "l", stock = 2,
            locationText = depot.location, latitude = 6.92, longitude = 79.88, transportAvailable = true, suitability = "" };
        Assert.Equal(HttpStatusCode.Forbidden, (await logistics.PostAsJsonAsync(resources, stock with { countryCode = "NP" })).StatusCode);
        (await logistics.PostAsJsonAsync(resources, stock)).EnsureSuccessStatusCode();
        (await logistics.PostAsJsonAsync(resources, stock)).EnsureSuccessStatusCode();
        var after = await logistics.GetFromJsonAsync<JsonElement>(dashboard);
        Assert.Empty(after.GetProperty("inventory").EnumerateArray());
        Assert.Contains(after.GetProperty("resourceRegistration").GetProperty("depots").EnumerateArray(), d => Id(d) == depot.operationId);
        Assert.Contains(after.GetProperty("caseInventory").EnumerateArray(), r => Id(r) == stock.operationId && r.GetProperty("available").GetDecimal() == 2);

        var reservation = new { operationId = Guid.NewGuid(), requestId = assignedCase.Id, resourceId = stock.operationId, quantity = 2 };
        Assert.Equal(HttpStatusCode.NotFound, (await logistics.PostAsJsonAsync("/api/v1/allocations" + Scope, reservation with { requestId = outsideCase.Id })).StatusCode);
        (await logistics.PostAsJsonAsync("/api/v1/allocations" + Scope, reservation)).EnsureSuccessStatusCode();
        Assert.Equal(2m, await db.Set<Resource>().Where(r => r.Id == stock.operationId).Select(r => r.Reserved).SingleAsync());

        var grant = await db.Set<Membership>().SingleAsync(m => m.Role == Roles.Logistics && m.CrisisId == seed.CrisisId);
        (await admin.PutAsJsonAsync($"/api/v1/fulfillment/assignments/{grant.Id}/depot?countryCode=LK", new { depotId = depot.operationId })).EnsureSuccessStatusCode();
        var otherDepot = new Depot { CountryCode = "LK", OrganisationId = organisationId, Name = "Other response depot", Location = "Colombo" };
        db.Add(otherDepot);
        await db.SaveChangesAsync();
        var restricted = await logistics.GetFromJsonAsync<JsonElement>(dashboard);
        Assert.False(Assert.Single(restricted.GetProperty("resourceRegistration").GetProperty("partners").EnumerateArray()).GetProperty("canRegisterDepot").GetBoolean());
        Assert.Equal(depot.operationId, Id(Assert.Single(restricted.GetProperty("resourceRegistration").GetProperty("depots").EnumerateArray())));
        Assert.Equal(HttpStatusCode.Forbidden, (await logistics.PostAsJsonAsync(depots, depot with { operationId = Guid.NewGuid() })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await logistics.PostAsJsonAsync(resources, stock with { operationId = Guid.NewGuid(), depotId = otherDepot.Id })).StatusCode);

        var generalStock = new Resource { OrganisationId = organisationId, DepotId = otherDepot.Id, Name = "General depot stock",
            CountryCode = "LK", Category = AidCategory.FoodWater, Unit = "l", Stock = 6 };
        db.AddRange(generalStock, new Membership { UserId = grant.UserId, OrganisationId = organisationId,
            CountryCode = "LK", Role = Roles.Logistics, DepotId = otherDepot.Id });
        await db.SaveChangesAsync();
        var mixed = await logistics.GetFromJsonAsync<JsonElement>(dashboard);
        Assert.Equal(generalStock.Id, Id(Assert.Single(mixed.GetProperty("inventory").EnumerateArray())));
        var caseStock = Assert.Single(mixed.GetProperty("caseInventory").EnumerateArray());
        Assert.Equal(stock.operationId, Id(caseStock));
        Assert.Equal(2m, caseStock.GetProperty("reserved").GetDecimal());
        Assert.Equal(0m, caseStock.GetProperty("available").GetDecimal());
        Assert.Equal(depot.operationId, Assert.Single(mixed.GetProperty("caseStockScope").EnumerateArray()).GetProperty("depotId").GetGuid());
    }

    [Fact]
    public async Task FulfillmentReadsOnlyAssignedApprovedWorkAndReconcilesConcurrentReservationsAndDelivery()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var seed = await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(r => r.SubmissionKey == "seed-food");
        var other = await db.Set<Organisation>().AsNoTracking().SingleAsync(o => o.Name == "Southern Relief Network (demo)");
        AssistanceRequest AddCase(RequestStatus status, Guid organisation) => new()
        {
            CrisisId = seed.CrisisId, CitizenId = seed.CitizenId, OrganisationId = organisation, Category = AidCategory.FoodWater,
            Description = "Private citizen narrative", RequesterContact = "Private citizen contact",
            Status = status, Unit = "packs", Quantity = 6, SubmissionKey = Guid.NewGuid().ToString(),
        };
        Resource AddStock(Guid organisation, string unit) => new()
        {
            OrganisationId = organisation, CountryCode = "LK", Category = AidCategory.FoodWater,
            Unit = unit, Name = "Integration test stock", Stock = 10, TransportAvailable = true,
        };
        var approved = AddCase(RequestStatus.Approved, seed.OrganisationId!.Value);
        var unapproved = AddCase(RequestStatus.Verified, approved.OrganisationId!.Value);
        var outside = AddCase(RequestStatus.Approved, other.Id);
        var origin = AddStock(approved.OrganisationId.Value, "packs");
        var secondDepot = AddStock(approved.OrganisationId.Value, "packs");
        var wrongUnit = AddStock(approved.OrganisationId.Value, "pieces");
        var otherStock = AddStock(other.Id, "packs");
        db.AddRange(approved, unapproved, outside, origin, secondDepot, wrongUnit, otherStock);
        await db.SaveChangesAsync();

        using var logistics = await fixture.Login("logistics");
        using var citizen = await fixture.Login("citizen");
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.GetAsync(Cases + Scope)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await logistics.GetAsync(Cases + "?countryCode=NP")).StatusCode);
        var queue = await logistics.GetFromJsonAsync<JsonElement>(Cases + Scope);
        Assert.Contains(queue.EnumerateArray(), row => Id(row) == approved.Id);
        Assert.DoesNotContain(queue.EnumerateArray(), row => Id(row) == unapproved.Id || Id(row) == outside.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await logistics.GetAsync($"{Cases}/{outside.Id}{Scope}")).StatusCode);
        var detail = await logistics.GetFromJsonAsync<JsonElement>($"{Cases}/{approved.Id}{Scope}");
        Assert.DoesNotContain("Private citizen", detail.GetRawText());
        Assert.DoesNotContain(seed.CitizenId, detail.GetRawText());
        Assert.Equal(HttpStatusCode.Forbidden, (await logistics.PatchAsJsonAsync($"/api/v1/requests/{unapproved.Id}/status{Scope}",
            new { status = "Approved", reason = "This role cannot approve." })).StatusCode);

        var reservation = new { operationId = Guid.NewGuid(), requestId = approved.Id, resourceId = origin.Id, quantity = 4m };
        const string allocate = "/api/v1/allocations" + Scope;
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync(allocate, reservation with { requestId = unapproved.Id })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync(allocate, reservation with { resourceId = wrongUnit.Id })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await logistics.PostAsJsonAsync(allocate, reservation with { resourceId = otherStock.Id })).StatusCode);
        var alternative = reservation with { operationId = Guid.NewGuid(), resourceId = secondDepot.Id };
        var attempts = await Task.WhenAll(logistics.PostAsJsonAsync(allocate, reservation), logistics.PostAsJsonAsync(allocate, alternative));
        Assert.Single(attempts, response => response.IsSuccessStatusCode);
        Assert.Single(attempts, response => response.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.Conflict);
        var accepted = attempts[0].IsSuccessStatusCode ? reservation : alternative;
        var retry = await logistics.PostAsJsonAsync(allocate, accepted);
        retry.EnsureSuccessStatusCode();
        Assert.Equal(accepted.operationId, Id(await retry.Content.ReadFromJsonAsync<JsonElement>()));
        var balance = reservation with { operationId = Guid.NewGuid(), quantity = 2 };
        (await logistics.PostAsJsonAsync(allocate, balance)).EnsureSuccessStatusCode();
        detail = await logistics.GetFromJsonAsync<JsonElement>($"{Cases}/{approved.Id}{Scope}");
        Assert.Equal(6m, detail.GetProperty("case").GetProperty("reservedQuantity").GetDecimal());

        foreach (var allocation in new[] { accepted, balance })
        {
            var path = $"/api/v1/logistics/allocations/{allocation.operationId}";
            (await logistics.PostAsJsonAsync(path + "/dispatch" + Scope, new { reason = "Packed and dispatched for the case." })).EnsureSuccessStatusCode();
            var receipt = new { delivery = new { reference = allocation.operationId.ToString(), confirmedQuantity = allocation.quantity,
                receivedBy = "Test receiving staff", method = "ReceivingStaff" } };
            (await logistics.PostAsJsonAsync(path + "/deliver" + Scope, receipt)).EnsureSuccessStatusCode();
            (await logistics.PostAsJsonAsync(path + "/deliver" + Scope, receipt)).EnsureSuccessStatusCode();
        }
        detail = await logistics.GetFromJsonAsync<JsonElement>($"{Cases}/{approved.Id}{Scope}");
        Assert.Equal("Fulfilled", detail.GetProperty("case").GetProperty("status").GetString());
        Assert.Equal(6m, detail.GetProperty("case").GetProperty("deliveredQuantity").GetDecimal());
        Assert.Equal(14m, await db.Set<Resource>().Where(r => r.Id == origin.Id || r.Id == secondDepot.Id).SumAsync(r => r.Stock));
        Assert.Equal(0m, await db.Set<Resource>().Where(r => r.Id == origin.Id || r.Id == secondDepot.Id).SumAsync(r => r.Reserved));
        var dashboard = await logistics.GetFromJsonAsync<JsonElement>("/api/v1/logistics" + Scope + "&specialist=true");
        var dispatched = dashboard.GetProperty("orders").EnumerateArray().Where(order => order.GetProperty("requestId").ValueKind == JsonValueKind.String &&
            order.GetProperty("requestId").GetGuid() == approved.Id && order.GetProperty("dispatchedAt").ValueKind == JsonValueKind.String).ToArray();
        Assert.Equal(2, dispatched.Length);
        var dispatchReferences = dispatched.Select(order => order.GetProperty("reference").GetString()!).ToArray();
        Assert.All(dispatchReferences, reference => Assert.Matches(@"^DSP-[0-9]{4,}$", reference));
        Assert.Equal(2, dispatchReferences.Distinct().Count());
        Assert.Matches(@"^RES-[0-9]{4,}$", dashboard.GetProperty("inventory").EnumerateArray().Single(item => Id(item) == origin.Id)
            .GetProperty("reference").GetString()!);
    }

    [Fact]
    public async Task SupplyRequestPinsReceiptsToTheSelectedDepotAndCreditsPartialAndFinalReceiptsOnce()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var source = await db.Set<Resource>().AsNoTracking().SingleAsync(x => x.Name == "Family food packs");
        var target = await db.Set<Organisation>().AsNoTracking().SingleAsync(x => x.Name == "Southern Relief Network (demo)");
        var depot = new Depot { CountryCode = "LK", OrganisationId = source.OrganisationId, Name = "Test receiving depot", Location = "Colombo" };
        var receiving = new Resource { CountryCode = depot.CountryCode, OrganisationId = depot.OrganisationId, DepotId = depot.Id,
            Name = source.Name, Unit = source.Unit, Category = source.Category, Stock = 3 };
        db.AddRange(depot, receiving);
        await db.SaveChangesAsync();
        using var logistics = await fixture.Login("logistics");
        using var admin = await fixture.Login("admin");
        using var citizen = await fixture.Login("citizen");
        const string supply = "/api/v1/supply-support/LK";
        var request = new { operationId = Guid.NewGuid(), requestingOrganisationId = source.OrganisationId,
            targetOrganisationId = target.Id, destinationResourceId = receiving.Id, category = "FoodWater",
            unit = receiving.Unit, quantity = 5, reason = "Replenish depot stock." };
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.PostAsJsonAsync(supply + Scope, request)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync(supply + Scope, request with { unit = "l" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync(supply + Scope, request with { quantity = 0 })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await logistics.PostAsJsonAsync(supply + Scope,
            request with { requestingOrganisationId = target.Id, targetOrganisationId = source.OrganisationId })).StatusCode);
        var submitted = await logistics.PostAsJsonAsync(supply + Scope, request);
        submitted.EnsureSuccessStatusCode();
        var repeated = await logistics.PostAsJsonAsync(supply + Scope, request);
        repeated.EnsureSuccessStatusCode();
        var reference = (await submitted.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reference").GetString()!;
        Assert.Matches(@"^SR-[0-9]{4,}$", reference);
        Assert.Equal(reference, (await repeated.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reference").GetString());
        var matching = await logistics.GetFromJsonAsync<JsonElement>(supply + Scope + "&search=" + reference);
        Assert.Equal(request.operationId, Id(Assert.Single(matching.GetProperty("requests").EnumerateArray())));
        var offer = new PartnerContribution { OrganisationId = target.Id, CountryCode = "LK", SupportRequestId = request.operationId,
            Category = source.Category, Title = "Test supply commitment", Kind = "Resource", Unit = request.unit, Quantity = 5 };
        db.Add(offer);
        await db.SaveChangesAsync();

        var accept = $"/api/v1/partner/contributions/{offer.Id}/accept";
        var receipt = new { operationId = Guid.NewGuid(), resourceId = receiving.Id, quantity = 2, reference = "PART-01" };
        var receiptPath = $"{supply}/contributions/{offer.Id}/receipts{Scope}";
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync(receiptPath, receipt)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await logistics.PostAsJsonAsync(accept + Scope, new { note = "Not authorised." })).StatusCode);
        (await admin.PostAsJsonAsync(accept + "?countryCode=LK", new { note = "Approved matching supply commitment." })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await logistics.PostAsJsonAsync(receiptPath, receipt with { resourceId = source.Id })).StatusCode);
        (await logistics.PostAsJsonAsync(receiptPath, receipt)).EnsureSuccessStatusCode();
        (await logistics.PostAsJsonAsync(receiptPath, receipt)).EnsureSuccessStatusCode();
        Assert.Equal(5m, await db.Set<Resource>().Where(r => r.Id == receiving.Id).Select(r => r.Stock).SingleAsync());
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync(receiptPath, receipt with { operationId = Guid.NewGuid() })).StatusCode);
        var final = receipt with { operationId = Guid.NewGuid(), quantity = 3, reference = "FINAL-02" };
        (await logistics.PostAsJsonAsync(receiptPath, final)).EnsureSuccessStatusCode();
        Assert.Equal(8m, await db.Set<Resource>().Where(r => r.Id == receiving.Id).Select(r => r.Stock).SingleAsync());
        var workspace = await logistics.GetFromJsonAsync<JsonElement>(supply + Scope);
        Assert.Equal(2, workspace.GetProperty("receipts").GetArrayLength());
        var recorded = Assert.Single(workspace.GetProperty("requests").EnumerateArray(), r => Id(r) == request.operationId);
        Assert.Equal(5m, recorded.GetProperty("receivedQuantity").GetDecimal());
        Assert.Equal(depot.Name, recorded.GetProperty("destination").GetString());
    }

    private static Guid Id(JsonElement element) => element.GetProperty("id").GetGuid();
}
