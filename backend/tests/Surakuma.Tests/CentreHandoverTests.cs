using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class CentreHandoverTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task ReadyLinesShareADispatchAndOnlyVerifiedCitizenHandoverFulfilsTheItems()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var seed = await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(r => r.SubmissionKey == "seed-food");
        var profile = await db.Set<VolunteerProfile>().SingleAsync(v => v.OrganisationId == seed.OrganisationId);
        profile.Available = true;
        var seedTask = await db.Set<VolunteerTask>().SingleAsync(t => t.VolunteerId == profile.Id);
        seedTask.Status = Surakuma.Domain.TaskStatus.Completed;
        var centre = new Depot { Name = "Gampaha receiving centre", Location = "Gampaha", OrganisationId = seed.OrganisationId!.Value, CountryCode = "LK" };
        var request = new AssistanceRequest { CitizenId = seed.CitizenId, OrganisationId = seed.OrganisationId, CrisisId = seed.CrisisId,
            Category = AidCategory.FoodWater, Status = RequestStatus.Approved, Unit = "packs", Quantity = 2,
            RequiresCoordinatorAuthorization = true, RequiresCentreHandover = true, SubmissionKey = Guid.NewGuid().ToString() };
        CaseNeed Need(string name, string unit, decimal quantity) => new() { RequestId = request.Id, Name = name,
            Category = AidCategory.FoodWater, Unit = unit, RequiredQuantity = quantity, ApprovedQuantity = quantity };
        Resource Stock(CaseNeed need, int quantity) => new() { OrganisationId = centre.OrganisationId, CountryCode = "LK",
            DepotId = centre.Id, Name = need.Name, Category = need.Category, Unit = need.Unit, Stock = quantity, TransportAvailable = true };
        var meals = Need("Ready meals", "packs", 2);
        var water = Need("Drinking water", "l", 3);
        var hygiene = Need("Hygiene supplies", "packs", 1);
        var mealsStock = Stock(meals, 10);
        var waterStock = Stock(water, 10);
        var hygieneStock = Stock(hygiene, 10);
        db.AddRange(centre, request, meals, water, hygiene, mealsStock, waterStock, hygieneStock);
        await db.SaveChangesAsync();
        using var coordinator = await fixture.Login("coordinator");
        using var logistics = await fixture.Login("logistics");
        using var volunteerCoordinator = await fixture.Login("volunteers");
        using var volunteer = await fixture.Login("volunteer");
        using var citizen = await fixture.Login("citizen");
        const string logisticsScope = "?countryCode=LK&staffRole=Logistics";
        const string volunteerScope = "?countryCode=LK&staffRole=VolunteerCoordinator";
        var fulfillment = $"/api/v1/fulfillment/cases/{request.Id}";
        var shipmentPath = fulfillment + "/dispatches";
        (await coordinator.PutAsJsonAsync(fulfillment + "/handover-centre?countryCode=LK", new { centreId = centre.Id })).EnsureSuccessStatusCode();
        (await coordinator.PostAsJsonAsync(fulfillment + "/authorize?countryCode=LK", new { reason = "Approved for centre dispatch." })).EnsureSuccessStatusCode();

        async Task<Guid> ReserveAndPack(CaseNeed need, Resource stock)
        {
            var allocation = Guid.NewGuid();
            (await logistics.PostAsJsonAsync("/api/v1/allocations" + logisticsScope, new { requestId = request.Id, needId = need.Id,
                resourceId = stock.Id, quantity = need.ApprovedQuantity, operationId = allocation })).EnsureSuccessStatusCode();
            (await logistics.PostAsJsonAsync($"/api/v1/fulfillment/allocations/{allocation}/prepare" + logisticsScope,
                new { packedQuantity = need.ApprovedQuantity, note = "Packed and checked." })).EnsureSuccessStatusCode();
            return allocation;
        }
        var released = await ReserveAndPack(water, waterStock);
        (await logistics.PostAsJsonAsync($"/api/v1/logistics/allocations/{released}/cancel" + logisticsScope,
            new { reason = "Released before dispatch." })).EnsureSuccessStatusCode();
        var notifications = await logistics.GetFromJsonAsync<JsonElement>("/api/v1/notifications" + logisticsScope);
        var release = Assert.Single(notifications.EnumerateArray(), n => n.TryGetProperty("allocationId", out var linked)
            && linked.ValueKind == JsonValueKind.String && linked.GetGuid() == released);
        Assert.Contains("Released 3 L of Drinking water back to Gampaha receiving centre", release.GetProperty("message").GetString());
        Assert.Equal(request.Id, release.GetProperty("requestId").GetGuid());

        var a = await ReserveAndPack(meals, mealsStock);
        var b = await ReserveAndPack(water, waterStock);
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync($"/api/v1/logistics/allocations/{a}/dispatch" + logisticsScope,
            new { reason = "Bypass centre." })).StatusCode);
        var dispatch = Guid.NewGuid();
        var dispatchInput = new { operationId = dispatch, allocationIds = new[] { a, b } };
        (await logistics.PostAsJsonAsync(shipmentPath + logisticsScope, dispatchInput)).EnsureSuccessStatusCode();
        (await logistics.PostAsJsonAsync(shipmentPath + logisticsScope, dispatchInput)).EnsureSuccessStatusCode();
        var citizenDispatches = await citizen.GetFromJsonAsync<JsonElement>(shipmentPath);
        var citizenDispatch = Assert.Single(citizenDispatches.GetProperty("dispatches").EnumerateArray());
        Assert.Equal(2, citizenDispatch.GetProperty("items").GetArrayLength());
        Assert.False(citizenDispatch.GetProperty("canReceive").GetBoolean());
        var dashboard = await logistics.GetFromJsonAsync<JsonElement>("/api/v1/logistics" + logisticsScope + "&specialist=true");
        var stockLines = dashboard.GetProperty("orders").EnumerateArray().Where(order => order.GetProperty("caseDispatchId").ValueKind == JsonValueKind.String
            && order.GetProperty("caseDispatchId").GetGuid() == dispatch).ToArray();
        Assert.Equal(2, stockLines.Length);
        Assert.All(stockLines, line => Assert.Equal(citizenDispatch.GetProperty("reference").GetString(), line.GetProperty("reference").GetString()));

        var taskInput = new { requestId = request.Id, volunteerId = profile.Id, caseDispatchId = dispatch,
            title = "Deliver aid from Gampaha centre", requiredSkill = "distribution", dueAt = DateTimeOffset.UtcNow.AddHours(1) };
        Assert.Equal(HttpStatusCode.BadRequest, (await volunteerCoordinator.PostAsJsonAsync("/api/v1/volunteer-tasks" + volunteerScope, taskInput)).StatusCode);
        var receiptPath = $"/api/v1/fulfillment/dispatches/{dispatch}/receive" + logisticsScope;
        (await logistics.PostAsJsonAsync(receiptPath, new { items = new[] { new { allocationId = a, quantity = 2m },
            new { allocationId = b, quantity = 3m } } })).EnsureSuccessStatusCode();
        await AssertDelivered(0m, 0m, RequestStatus.InProgress);
        var workQueue = await volunteerCoordinator.GetFromJsonAsync<JsonElement>("/api/v1/volunteer-tasks/cases" + volunteerScope);
        Assert.Contains(workQueue.EnumerateArray(), row => row.GetProperty("id").GetGuid() == request.Id &&
            row.GetProperty("requiresCentreHandover").GetBoolean());

        async Task Handover(Guid batch, decimal mealsQuantity, Guid[] allocationIds, decimal[] quantities, string issues)
        {
            var assigned = await volunteerCoordinator.PostAsJsonAsync("/api/v1/volunteer-tasks" + volunteerScope,
                taskInput with { caseDispatchId = batch });
            Assert.True(assigned.IsSuccessStatusCode, await assigned.Content.ReadAsStringAsync());
            var taskId = (await assigned.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
            var taskPath = $"/api/v1/volunteer-tasks/{taskId}";
            var volunteerManifest = await volunteer.GetFromJsonAsync<JsonElement>($"/api/v1/fulfillment/volunteer-tasks/{taskId}/dispatch");
            Assert.Equal("Gampaha receiving centre", volunteerManifest.GetProperty("centre").GetString());
            (await volunteer.PostAsJsonAsync(taskPath, new { action = "Accept" })).EnsureSuccessStatusCode();
            (await volunteer.PostAsJsonAsync(taskPath, new { action = "Start" })).EnsureSuccessStatusCode();
            (await volunteer.PostAsJsonAsync(taskPath, new { action = "Complete", workDescription = "Collected items at the centre.",
                outcome = "Handed over the reported quantities in person.", issues,
                handoverQuantities = allocationIds.Zip(quantities, (allocationId, quantity) => new { allocationId, quantity }).ToArray()
            })).EnsureSuccessStatusCode();
            Assert.Equal(mealsQuantity, await db.Set<CaseNeed>().AsNoTracking().Where(n => n.Id == meals.Id).Select(n => n.DeliveredQuantity).SingleAsync());
            Assert.Equal(HttpStatusCode.Forbidden, (await volunteer.PostAsJsonAsync(taskPath,
                new { action = "Verify", note = "Cannot verify own report." })).StatusCode);
            (await volunteerCoordinator.PostAsJsonAsync(taskPath + volunteerScope,
                new { action = "Verify", note = "Reviewed the item quantities reported at the handover." })).EnsureSuccessStatusCode();
        }
        await Handover(dispatch, 0m, [a, b], [2m, 2m], "One litre stayed at the centre for a second handover.");
        await AssertDelivered(2m, 2m, RequestStatus.PartiallyFulfilled);
        await Handover(dispatch, 2m, [b], [1m], "");
        await AssertDelivered(2m, 3m, RequestStatus.PartiallyFulfilled);

        var c = await ReserveAndPack(hygiene, hygieneStock);
        var followUp = Guid.NewGuid();
        (await logistics.PostAsJsonAsync(shipmentPath + logisticsScope,
            new { operationId = followUp, allocationIds = new[] { c } })).EnsureSuccessStatusCode();
        (await logistics.PostAsJsonAsync($"/api/v1/fulfillment/dispatches/{followUp}/receive" + logisticsScope,
            new { items = new[] { new { allocationId = c, quantity = 1m } } })).EnsureSuccessStatusCode();
        await Handover(followUp, 2m, [c], [1m], "");
        await AssertDelivered(2m, 3m, RequestStatus.Fulfilled);
        Assert.Equal(2, await db.Set<CaseDispatch>().CountAsync(d => d.RequestId == request.Id));

        async Task AssertDelivered(decimal mealQuantity, decimal waterQuantity, RequestStatus status)
        {
            var needs = await db.Set<CaseNeed>().AsNoTracking().Where(n => n.RequestId == request.Id).ToDictionaryAsync(n => n.Id);
            Assert.Equal(mealQuantity, needs[meals.Id].DeliveredQuantity);
            Assert.Equal(waterQuantity, needs[water.Id].DeliveredQuantity);
            Assert.Equal(status, await db.Set<AssistanceRequest>().AsNoTracking().Where(r => r.Id == request.Id).Select(r => r.Status).SingleAsync());
        }
    }
}
