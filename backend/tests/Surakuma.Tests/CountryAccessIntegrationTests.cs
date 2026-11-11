using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class CountryAccessIntegrationTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task OrganisationMembershipDoesNotExposeForeignCasesButGlobalAdminCanInspectThem()
    {
        Guid requestId, crisisId, organisationId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var existing = await db.Set<AssistanceRequest>().FirstAsync();
            var crisis = new Crisis { CountryCode = "NP", Name = "Nepal isolation test" };
            var request = new AssistanceRequest { CrisisId = crisis.Id, CitizenId = existing.CitizenId, OrganisationId = existing.OrganisationId, SubmissionKey = Guid.NewGuid().ToString(), Description = "Test request" };
            db.AddRange(crisis, request);
            await db.SaveChangesAsync();
            requestId = request.Id;
            crisisId = crisis.Id;
            organisationId = existing.OrganisationId!.Value;
        }
        using var coordinator = await fixture.Login("coordinator");
        using var admin = await fixture.Login("admin");
        using var citizen = await fixture.Login("citizen");
        Assert.Equal(HttpStatusCode.NotFound, (await coordinator.GetAsync($"/api/v1/requests/{requestId}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync($"/api/v1/requests/{requestId}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await citizen.GetAsync($"/api/v1/requests/{requestId}")).StatusCode);
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var userId = await db.Users.Where(x => x.Email == "coordinator@surakuma.test").Select(x => x.Id).SingleAsync();
            db.Add(new Membership { UserId = userId, OrganisationId = organisationId, Role = Roles.Coordinator, CountryCode = "NP", CrisisId = crisisId });
            await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.OK, (await coordinator.GetAsync($"/api/v1/requests/{requestId}")).StatusCode);
    }

    [Fact]
    public async Task DatabaseRejectsDivisionFromAnotherCountry()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var division = new AdministrativeDivision { CountryCode = "NP", Name = "Test province", LevelName = "Province" };
        db.Add(division);
        await db.SaveChangesAsync();
        db.Add(new Crisis { CountryCode = "LK", AdministrativeDivisionId = division.Id, Name = "Invalid location" });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }
}
