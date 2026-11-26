using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Domain;
using Surakuma.Infrastructure;
using Surakuma.Application;

namespace Surakuma.Tests;

public sealed class GroupedAllocationTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    private const string Scope = "?countryCode=LK&staffRole=Logistics";

    [Fact]
    public async Task GroupedAllocationCombinesMatchingDepotStockAndIsAtomicOnFailureAndRetry()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var seed = await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(r => r.SubmissionKey == "seed-food");
        var organisationId = seed.OrganisationId!.Value;
        var depot = new Depot { OrganisationId = organisationId, CountryCode = "LK", Name = "Grouped stock depot", Location = "Colombo" };
        var otherDepot = new Depot { OrganisationId = organisationId, CountryCode = "LK", Name = "Separate depot", Location = "Colombo" };
        var request = new AssistanceRequest { CitizenId = seed.CitizenId, OrganisationId = organisationId, CrisisId = seed.CrisisId,
            Category = AidCategory.FoodWater, Status = RequestStatus.Approved, Unit = "l", Quantity = 70, SubmissionKey = Guid.NewGuid().ToString() };
        var need = new CaseNeed { RequestId = request.Id, Name = "Drinking water", Category = AidCategory.FoodWater,
            Unit = "l", RequiredQuantity = 70, ApprovedQuantity = 70 };
        Resource Stock(decimal amount, string unit = "l", Guid? depotId = null, string name = "Drinking water", bool transport = true) =>
            new() { OrganisationId = organisationId, CountryCode = "LK", DepotId = depotId ?? depot.Id, Name = name,
                Category = AidCategory.FoodWater, Unit = unit, Stock = amount, TransportAvailable = transport };
        var main = Stock(52);
        main.Reserve(2);
        var topup = Stock(10, "litres", name: " DRINKING WATER ");
        var elsewhere = Stock(50, depotId: otherDepot.Id);
        var bottles = Stock(50, "bottles");
        var otherProduct = Stock(50, name: "Cooking oil");
        var noTransport = Stock(50, transport: false);
        db.AddRange(depot, otherDepot, request, need, main, topup, elsewhere, bottles, otherProduct, noTransport);
        await db.SaveChangesAsync();

        using var logistics = await fixture.Login("logistics");
        const string endpoint = "/api/v1/allocations/group" + Scope;
        var input = new { requestId = request.Id, needId = need.Id, resourceId = main.Id, operationId = Guid.NewGuid(), quantity = 55m };
        using var rejected = await logistics.PostAsJsonAsync(endpoint, input with { quantity = 61m });
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        Assert.False(await db.Set<ResourceAllocation>().AnyAsync(a => a.RequestId == request.Id));

        using var saved = await logistics.PostAsJsonAsync(endpoint, input);
        saved.EnsureSuccessStatusCode();
        var result = await saved.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, result.GetArrayLength());
        using var retried = await logistics.PostAsJsonAsync(endpoint, input);
        retried.EnsureSuccessStatusCode();
        Assert.Equal(2, (await retried.Content.ReadFromJsonAsync<JsonElement>()).GetArrayLength());

        var allocations = await db.Set<ResourceAllocation>().AsNoTracking().Where(a => a.RequestId == request.Id).ToListAsync();
        Assert.Equal(2, allocations.Count);
        Assert.Equal(55m, allocations.Sum(a => a.RequestQuantity));
        Assert.Equal(50m, allocations.Single(a => a.ResourceId == main.Id).Quantity);
        Assert.Equal(5m, allocations.Single(a => a.ResourceId == topup.Id).Quantity);
        Assert.Equal(2, await db.Set<StockMovement>().CountAsync(m => m.RequestId == request.Id && m.Kind == "Reserved"));
    }
}

public sealed class FulfillmentOperationsTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    private const string Scope = "?countryCode=LK&staffRole=Logistics";
    [Fact]
    public async Task MultipleItemsRequireCoordinatorHandoffAndPackingAndCompleteOnlyAfterEveryItemIsDelivered()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var seed = await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(r => r.SubmissionKey == "seed-food");
        var request = new AssistanceRequest { CitizenId = seed.CitizenId, OrganisationId = seed.OrganisationId, CrisisId = seed.CrisisId,
            Category = AidCategory.FoodWater, Status = RequestStatus.Approved, Unit = "packs", Quantity = 2, SubmissionKey = Guid.NewGuid().ToString() };
        db.Add(request);
        var food = new Resource { Name = "Food", OrganisationId = seed.OrganisationId!.Value, Category = AidCategory.FoodWater, Unit = "packs", Stock = 10 };
        var water = new Resource { Name = "Water", OrganisationId = food.OrganisationId, Category = AidCategory.FoodWater, Unit = "ml", Stock = 10000 };
        db.AddRange(food, water);
        await db.SaveChangesAsync();
        using var manager = await fixture.Login("case");
        using var coordinator = await fixture.Login("coordinator");
        using var logistics = await fixture.Login("logistics");
        var items = new { items = new[] {
            new { name = "Food", category = "FoodWater", unit = "packs", requiredQuantity = 3, approvedQuantity = 2 },
            new { name = "Water", category = "FoodWater", unit = "l", requiredQuantity = 5, approvedQuantity = 4 } } };
        var path = $"/api/v1/fulfillment/cases/{request.Id}";
        Assert.Equal(HttpStatusCode.Forbidden, (await logistics.PutAsJsonAsync(path + "/items" + Scope, items)).StatusCode);
        (await manager.PutAsJsonAsync(path + "/items?countryCode=LK", items)).EnsureSuccessStatusCode();
        var plan = await logistics.GetFromJsonAsync<JsonElement>(path + Scope);
        var needs = plan.GetProperty("items").EnumerateArray().ToArray();
        var queue = await logistics.GetFromJsonAsync<JsonElement>("/api/v1/logistics/cases" + Scope);
        var queueCase = Assert.Single(queue.EnumerateArray(), r => r.GetProperty("id").GetGuid() == request.Id);
        Assert.Equal(2, queueCase.GetProperty("items").GetArrayLength());
        var first = needs.Single(n => n.GetProperty("unit").GetString() == "packs").GetProperty("id").GetGuid();
        var allocationId = Guid.NewGuid();
        var allocation = new { requestId = request.Id, resourceId = food.Id, needId = first, operationId = allocationId, quantity = 2 };
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync("/api/v1/allocations" + Scope, allocation)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await logistics.PostAsJsonAsync(path + "/authorize" + Scope, new { reason = "Unauthorized" })).StatusCode);
        var authorizationPath = path + "/authorize?countryCode=LK";
        var authorization = new { reason = "Approved stock handoff." };
        var results = await Task.WhenAll(coordinator.PostAsJsonAsync(authorizationPath, authorization),
            coordinator.PostAsJsonAsync(authorizationPath, authorization));
        using var initialAuthorization = results[0];
        using var concurrentAuthorization = results[1];
        initialAuthorization.EnsureSuccessStatusCode();
        concurrentAuthorization.EnsureSuccessStatusCode();
        var firstAuthorization = await initialAuthorization.Content.ReadFromJsonAsync<JsonElement>();
        var secondAuthorization = await concurrentAuthorization.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(firstAuthorization.GetProperty("authorizedAt").GetDateTimeOffset(),
            secondAuthorization.GetProperty("authorizedAt").GetDateTimeOffset());
        Assert.Equal(1, await db.Set<AuditEvent>().CountAsync(row =>
            row.EntityId == request.Id && row.Action == "CoordinatorAuthorized"));
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.PostAsJsonAsync("/api/v1/allocations?countryCode=LK", allocation)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.PostAsJsonAsync("/api/v1/allocations" + Scope, allocation)).StatusCode);
        (await logistics.PostAsJsonAsync("/api/v1/allocations" + Scope, allocation)).EnsureSuccessStatusCode();
        var shipment = $"/api/v1/logistics/allocations/{allocationId}";
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync(shipment + "/dispatch" + Scope, new { reason = "Unpacked" })).StatusCode);
        var arrival = DateTimeOffset.UtcNow.AddDays(1);
        var prepare = $"/api/v1/fulfillment/allocations/{allocationId}/prepare";
        var packing = new { packedQuantity = 2, scheduledArrivalAt = arrival, note = "Counted and packed." };
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.PostAsJsonAsync(prepare + "?countryCode=LK", packing)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.PostAsync($"/api/v1/allocations/{allocationId}/Dispatch?countryCode=LK", null)).StatusCode);
        (await logistics.PostAsJsonAsync(prepare + Scope, packing)).EnsureSuccessStatusCode();
        (await logistics.PostAsJsonAsync(shipment + "/dispatch" + Scope, new { reason = "Departed" })).EnsureSuccessStatusCode();
        queue = await logistics.GetFromJsonAsync<JsonElement>("/api/v1/logistics/cases" + Scope);
        queueCase = Assert.Single(queue.EnumerateArray(), r => r.GetProperty("id").GetGuid() == request.Id);
        Assert.True(queueCase.GetProperty("inTransit").GetBoolean());
        Assert.False(queueCase.GetProperty("hasReservations").GetBoolean());
        Assert.True(queueCase.GetProperty("needsPending").GetBoolean());
        (await logistics.PostAsJsonAsync(shipment + "/deliver" + Scope, new { delivery = new {
            reference = "FOOD-DELIVERY", confirmedQuantity = 2, receivedBy = "Receiving staff", method = "ReceivingStaff" } })).EnsureSuccessStatusCode();
        db.ChangeTracker.Clear();
        Assert.Equal(RequestStatus.PartiallyFulfilled, (await db.Set<AssistanceRequest>().SingleAsync(r => r.Id == request.Id)).Status);
        var oversight = await coordinator.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{request.Id}?countryCode=LK");
        Assert.Equal("Delivered", Assert.Single(oversight.GetProperty("allocations").EnumerateArray()).GetProperty("status").GetString());
        Assert.Equal(2, oversight.GetProperty("items").GetArrayLength());
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.PostAsJsonAsync($"/api/v1/resources/{food.Id}/replenish?countryCode=LK",
            new { quantity = 1, note = "Coordinator cannot adjust stock." })).StatusCode);
        var second = needs.Single(n => n.GetProperty("unit").GetString() == "l").GetProperty("id").GetGuid();
        var ranking = await logistics.GetFromJsonAsync<JsonElement>(
            $"/api/v1/requests/{request.Id}/allocation-recommendations{Scope}&needId={second}");
        Assert.Equal(4m, ranking.GetProperty("outstanding").GetDecimal());
        var waterMatch = Assert.Single(ranking.GetProperty("candidates").EnumerateArray());
        Assert.Equal(water.Id, waterMatch.GetProperty("resourceId").GetGuid());
        Assert.Equal(4000m, waterMatch.GetProperty("suggestedQuantity").GetDecimal());
        var secondId = Guid.NewGuid();
        (await logistics.PostAsJsonAsync("/api/v1/allocations" + Scope,
            new { requestId = request.Id, resourceId = water.Id, needId = second, operationId = secondId, quantity = 4000,
                recommendedResourceId = water.Id })).EnsureSuccessStatusCode();
        (await logistics.PostAsJsonAsync($"/api/v1/fulfillment/allocations/{secondId}/prepare" + Scope,
            new { packedQuantity = 4000, note = "Packed water." })).EnsureSuccessStatusCode();
        var secondShipment = $"/api/v1/logistics/allocations/{secondId}";
        (await logistics.PostAsJsonAsync(secondShipment + "/dispatch" + Scope, new { reason = "Departed" })).EnsureSuccessStatusCode();
        (await logistics.PostAsJsonAsync(secondShipment + "/deliver" + Scope, new { delivery = new {
            reference = "WATER-DELIVERY", confirmedQuantity = 1, exceptionDetail = "Only one millilitre received.",
            receivedBy = "Receiving staff", method = "ReceivingStaff" } })).EnsureSuccessStatusCode();
        db.ChangeTracker.Clear();
        Assert.Equal(.001m, (await db.Set<CaseNeed>().SingleAsync(n => n.Id == second)).DeliveredQuantity);
        var replacement = Guid.NewGuid();
        (await logistics.PostAsJsonAsync("/api/v1/allocations" + Scope,
            new { requestId = request.Id, resourceId = water.Id, needId = second, operationId = replacement, quantity = 3999 })).EnsureSuccessStatusCode();
        (await logistics.PostAsJsonAsync($"/api/v1/fulfillment/allocations/{replacement}/prepare" + Scope,
            new { packedQuantity = 3999, note = "Packed remaining water." })).EnsureSuccessStatusCode();
        (await logistics.PostAsJsonAsync($"/api/v1/logistics/allocations/{replacement}/dispatch" + Scope, new { reason = "Departed" })).EnsureSuccessStatusCode();
        (await logistics.PostAsJsonAsync($"/api/v1/logistics/allocations/{replacement}/deliver" + Scope, new { delivery = new {
            reference = "REMAINING-WATER", confirmedQuantity = 3999, receivedBy = "Receiving staff", method = "ReceivingStaff" } })).EnsureSuccessStatusCode();
        db.ChangeTracker.Clear();
        Assert.Equal(RequestStatus.Fulfilled, (await db.Set<AssistanceRequest>().SingleAsync(r => r.Id == request.Id)).Status);
    }

    [Fact]
    public async Task DepotRestrictionAndNotificationPreferencesPersistAndProtectOtherDepots()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var grant = await db.Set<Membership>().SingleAsync(m => m.Role == Roles.Logistics);
        var one = new Depot { OrganisationId = grant.OrganisationId!.Value, CountryCode = "LK", Name = "Assigned depot", Location = "Colombo" };
        var two = new Depot { OrganisationId = one.OrganisationId, CountryCode = "LK", Name = "Other depot", Location = "Colombo" };
        var stock = new Resource { OrganisationId = one.OrganisationId, CountryCode = "LK", DepotId = two.Id, Name = "Restricted food", Stock = 2 };
        var coordinatorGrant = new Membership { UserId = grant.UserId, OrganisationId = grant.OrganisationId, Role = Roles.Coordinator, CountryCode = "LK" };
        db.AddRange(one, two, stock, coordinatorGrant);
        await db.SaveChangesAsync();
        using var admin = await fixture.Login("admin");
        using var logistics = await fixture.Login("logistics");
        var assignment = $"/api/v1/fulfillment/assignments/{grant.Id}/depot";
        Assert.Equal(HttpStatusCode.Forbidden, (await logistics.PutAsJsonAsync(assignment + Scope, new { depotId = two.Id })).StatusCode);
        (await admin.PutAsJsonAsync(assignment + "?countryCode=LK", new { depotId = one.Id })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await logistics.PostAsJsonAsync($"/api/v1/logistics/resources/{stock.Id}/stock" + Scope,
            new { operationId = Guid.NewGuid(), delta = 1, reason = "Wrong depot" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await logistics.PostAsJsonAsync($"/api/v1/resources/{stock.Id}/replenish?countryCode=LK",
            new { quantity = 1, note = "Coordinator grant cannot extend logistics depot access." })).StatusCode);
        var data = await logistics.GetFromJsonAsync<JsonElement>("/api/v1/logistics" + Scope + "&specialist=true");
        Assert.DoesNotContain(data.GetProperty("inventory").EnumerateArray(), r => r.GetProperty("id").GetGuid() == stock.Id);

        var seed = await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(r => r.SubmissionKey == "seed-food");
        var request = new AssistanceRequest { CitizenId = seed.CitizenId, OrganisationId = one.OrganisationId, CrisisId = seed.CrisisId,
            Category = AidCategory.FoodWater, Status = RequestStatus.PartiallyFulfilled, Unit = "packs", Quantity = 10,
            SubmissionKey = Guid.NewGuid().ToString() };
        var need = new CaseNeed { RequestId = request.Id, Name = "Food packs", Category = AidCategory.FoodWater,
            Unit = "packs", RequiredQuantity = 12, ApprovedQuantity = 10, DeliveredQuantity = 1 };
        ResourceAllocation Allocation(AllocationStatus status, decimal quantity) => new()
        {
            RequestId = request.Id, NeedId = need.Id, ResourceId = stock.Id, Status = status, Quantity = quantity,
            RequestQuantity = quantity, ApprovedBy = grant.UserId,
        };
        db.AddRange(request, need, Allocation(AllocationStatus.Reserved, 2), Allocation(AllocationStatus.Dispatched, 4),
            Allocation(AllocationStatus.Delivered, 1), Allocation(AllocationStatus.Cancelled, 5));
        await db.SaveChangesAsync();

        var detail = await logistics.GetFromJsonAsync<JsonElement>($"/api/v1/logistics/cases/{request.Id}{Scope}");
        Assert.Empty(detail.GetProperty("allocations").EnumerateArray());
        var totals = Assert.Single(detail.GetProperty("case").GetProperty("items").EnumerateArray());
        Assert.Equal(10m, totals.GetProperty("approvedQuantity").GetDecimal());
        Assert.Equal(1m, totals.GetProperty("deliveredQuantity").GetDecimal());
        Assert.Equal(2m, totals.GetProperty("reservedQuantity").GetDecimal());
        Assert.Equal(4m, totals.GetProperty("inTransitQuantity").GetDecimal());

        (await logistics.PutAsJsonAsync("/api/v1/auth/logistics-preferences", new {
            dispatchUpdates = false, stockAlerts = false, supplyUpdates = false, assignmentUpdates = false })).EnsureSuccessStatusCode();
        var preferences = await logistics.GetFromJsonAsync<JsonElement>("/api/v1/auth/logistics-preferences");
        Assert.False(preferences.GetProperty("stockAlerts").GetBoolean());
        Assert.False(preferences.GetProperty("supplyUpdates").GetBoolean());
        var notifier = scope.ServiceProvider.GetRequiredService<InternalNotifications>();
        var before = await db.Set<Notification>().CountAsync(n => n.UserId == grant.UserId);
        await notifier.StockAlert(new Resource { OrganisationId = one.OrganisationId, CountryCode = "LK", DepotId = one.Id, Name = "Empty stock" }, default);
        await notifier.LogisticsReceipt(stock, null, true, default);
        await db.SaveChangesAsync();
        Assert.Equal(before, await db.Set<Notification>().CountAsync(n => n.UserId == grant.UserId));
        (await admin.PutAsJsonAsync(assignment + "?countryCode=LK", new { depotId = (Guid?)null })).EnsureSuccessStatusCode();
        db.Remove(coordinatorGrant);
        await db.SaveChangesAsync();
    }
}
