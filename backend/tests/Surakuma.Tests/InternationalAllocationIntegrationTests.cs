using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class InternationalAllocationIntegrationTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task ForeignStockAndSheltersCannotBeReservedForSriLankanRequests()
    {
        Guid foodRequest, shelterRequest, foreignStock, foreignShelter;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var food = await db.Set<AssistanceRequest>().SingleAsync(x => x.SubmissionKey == "seed-food");
            var shelter = await db.Set<AssistanceRequest>().SingleAsync(x => x.SubmissionKey == "seed-shelter");
            foodRequest = food.Id;
            shelterRequest = shelter.Id;
            var stock = new Resource { OrganisationId = food.OrganisationId!.Value, CountryCode = "NP", Name = "Nepal stock", Category = AidCategory.FoodWater, Stock = 10 };
            var building = new Shelter { OrganisationId = shelter.OrganisationId!.Value, CountryCode = "NP", Name = "Nepal shelter", Capacity = 20, Accessible = true };
            db.AddRange(stock, building);
            await db.SaveChangesAsync();
            foreignStock = stock.Id;
            foreignShelter = building.Id;
        }
        using var logistics = await fixture.Login("logistics");
        using var shelterAdmin = await fixture.Login("shelter");
        var allocation = await logistics.PostAsJsonAsync("/api/v1/allocations", new { requestId = foodRequest, resourceId = foreignStock, quantity = 1 });
        var placement = await shelterAdmin.PostAsJsonAsync("/api/v1/shelter-allocations", new { requestId = shelterRequest, shelterId = foreignShelter });
        Assert.Equal(HttpStatusCode.BadRequest, allocation.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, placement.StatusCode);
    }
}
