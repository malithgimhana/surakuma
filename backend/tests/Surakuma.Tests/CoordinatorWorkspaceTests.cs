using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class CoordinatorWorkspaceTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    private const string Scope = "countryCode=LK&staffRole=Coordinator";

    [Fact]
    public async Task MonitoringUsesAssignedCrisesAndLiveInventoryUnits()
    {
        Guid foodId, hiddenId, stockId;
        Guid[] expectedPageOrder;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var membership = await db.Set<Membership>().SingleAsync(m => m.Role == Roles.Coordinator);
            var food = await db.Set<AssistanceRequest>().SingleAsync(r => r.SubmissionKey == "seed-food");
            var stock = await db.Set<Resource>().SingleAsync(r => r.Name == "Family food packs");
            foodId = food.Id;
            stockId = stock.Id;
            membership.CrisisId = food.CrisisId;
            food.Priority = Priority.Critical;
            food.Escalated = true;
            food.CreatedAt = DateTimeOffset.UtcNow.AddDays(-2);
            var otherCrisis = await db.Set<Crisis>().SingleAsync(c => c.Id != food.CrisisId);
            var hidden = new AssistanceRequest
            {
                CitizenId = food.CitizenId, OrganisationId = food.OrganisationId, CrisisId = otherCrisis.Id,
                Category = AidCategory.FoodWater, Priority = Priority.Critical, Quantity = 1, Unit = "packs",
                Description = "Outside the selected crisis grant.", SubmissionKey = "outside-coordination-scope",
            };
            hiddenId = hidden.Id;
            var outsideOrganisation = await db.Set<Organisation>().SingleAsync(o => o.Id != food.OrganisationId);
            db.Add(new Resource { OrganisationId = outsideOrganisation.Id, Name = "Private inventory", Unit = "packs", Stock = 100 });
            db.AddRange(new CaseNeed { RequestId = foodId, Name = "Meal packs", Category = AidCategory.FoodWater, Unit = "packs", RequiredQuantity = 4, ApprovedQuantity = 4 },
                new CaseNeed { RequestId = foodId, Name = "Breakfast packs", Category = AidCategory.FoodWater, Unit = "packs", RequiredQuantity = 4, ApprovedQuantity = 4 });
            var pageStart = DateTimeOffset.UtcNow.AddMinutes(-30);
            var pageCases = Enumerable.Range(0, 21).Select(index => new AssistanceRequest
            {
                CitizenId = food.CitizenId, OrganisationId = food.OrganisationId, CrisisId = food.CrisisId,
                Category = AidCategory.FoodWater, Unit = "packs", Quantity = 1,
                CreatedAt = pageStart.AddMinutes(index), Priority = index == 0 ? Priority.Urgent : Priority.Normal,
                Description = "Pagination fixture", SubmissionKey = $"coordinator-page-{index}",
            }).ToArray();
            expectedPageOrder = pageCases.Reverse().Select(r => r.Id).ToArray();
            db.AddRange(pageCases);
            await db.SaveChangesAsync();
        }

        using var coordinator = await fixture.Login("coordinator");
        using var caseManager = await fixture.Login("case");
        const string overviewPath = "/api/v1/staff/overview/Coordinator";
        var overview = await coordinator.GetFromJsonAsync<JsonElement>($"{overviewPath}?{Scope}");
        var metrics = overview.GetProperty("metrics");
        Assert.Equal(1, metrics.GetProperty("crises").GetInt32());
        Assert.Equal(2, metrics.GetProperty("critical").GetInt32());
        Assert.Equal(1, metrics.GetProperty("overdue").GetInt32());
        Assert.Equal(1, metrics.GetProperty("shortages").GetInt32());
        Assert.Contains(overview.GetProperty("attention").EnumerateArray(), r =>
            r.GetProperty("id").GetGuid() == foodId && r.GetProperty("shortage").GetBoolean());
        var shortages = await coordinator.GetFromJsonAsync<JsonElement>($"/api/v1/requests?{Scope}&view=shortages&priority=Critical");
        Assert.Equal(foodId, Assert.Single(shortages.GetProperty("items").EnumerateArray()).GetProperty("id").GetGuid());
        const string caseRecordsPath = $"/api/v1/requests/coordinator?{Scope}&search=Pagination&status=Submitted";
        var firstPage = await coordinator.GetFromJsonAsync<JsonElement>(caseRecordsPath);
        Assert.Equal(expectedPageOrder[..20], firstPage.GetProperty("items").EnumerateArray().Select(r => r.GetProperty("id").GetGuid()));
        var secondPage = await coordinator.GetFromJsonAsync<JsonElement>(caseRecordsPath + "&page=2");
        Assert.Equal(21, secondPage.GetProperty("total").GetInt32());
        Assert.Equal(2, secondPage.GetProperty("pageNumber").GetInt32());
        Assert.Equal(expectedPageOrder[20], Assert.Single(secondPage.GetProperty("items").EnumerateArray()).GetProperty("id").GetGuid());
        var urgentPage = await coordinator.GetFromJsonAsync<JsonElement>(caseRecordsPath + "&priority=Urgent");
        Assert.Equal(expectedPageOrder[20], Assert.Single(urgentPage.GetProperty("items").EnumerateArray()).GetProperty("id").GetGuid());
        var detail = await coordinator.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{foodId}?{Scope}");
        Assert.True(detail.GetProperty("hasStockShortage").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await coordinator.GetAsync($"/api/v1/requests/{hiddenId}?{Scope}")).StatusCode);

        const string inventoryPath = "/api/v1/staff/coordinator/inventory";
        var inventory = await coordinator.GetFromJsonAsync<JsonElement>($"{inventoryPath}?{Scope}");
        Assert.Equal(2, inventory.GetArrayLength());
        Assert.True(inventory.EnumerateArray().Single(row => row.GetProperty("resource").GetProperty("id").GetGuid() == stockId)
            .GetProperty("matchesApprovedNeed").GetBoolean());
        Assert.Equal(HttpStatusCode.Forbidden, (await caseManager.GetAsync($"{inventoryPath}?{Scope}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.GetAsync($"{inventoryPath}?countryCode=NP&staffRole=Coordinator")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await coordinator.GetAsync($"/api/v1/resources/{stockId}/movements?{Scope}")).StatusCode);

        var shelters = await coordinator.GetFromJsonAsync<JsonElement>($"/api/v1/staff/shelters?{Scope}&dashboard=true");
        Assert.Equal(3, shelters.GetProperty("statistics").GetProperty("total").GetInt32());
        var volunteers = await coordinator.GetFromJsonAsync<JsonElement>($"/api/v1/volunteers?{Scope}");
        Assert.Single(volunteers.GetProperty("tasks").EnumerateArray());
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.PatchAsJsonAsync($"/api/v1/requests/{foodId}/status?{Scope}",
            new { status = "Approved", reason = "This is a coordinator workspace." })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.PutAsJsonAsync($"/api/v1/fulfillment/cases/{foodId}/items?{Scope}",
            new { items = new[] { new { name = "Meals", category = "FoodWater", unit = "packs", requiredQuantity = 4, approvedQuantity = 4 } } })).StatusCode);
    }
}
