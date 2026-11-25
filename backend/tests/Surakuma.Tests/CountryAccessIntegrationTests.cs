using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class CountryAccessIntegrationTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task CaseManagerGrantedByCountryAdministratorCanManageOnlyCasesInThatCountry()
    {
        Guid localId, foreignId, organisationId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var existing = await db.Set<AssistanceRequest>().FirstAsync(r => r.OrganisationId != null);
            organisationId = existing.OrganisationId!.Value;
            var localCrisis = new Crisis { CountryCode = "LK", Name = "Local case scope test" };
            var foreignCrisis = new Crisis { CountryCode = "NP", Name = "Foreign case scope test" };
            var local = new AssistanceRequest
            {
                CrisisId = localCrisis.Id, CitizenId = existing.CitizenId, OrganisationId = organisationId,
                SubmissionKey = Guid.NewGuid().ToString(), Description = "Local case"
            };
            var foreign = new AssistanceRequest
            {
                CrisisId = foreignCrisis.Id, CitizenId = existing.CitizenId, OrganisationId = organisationId,
                SubmissionKey = Guid.NewGuid().ToString(), Description = "Same organisation in a different country"
            };
            db.AddRange(localCrisis, foreignCrisis, local, foreign);
            await db.SaveChangesAsync();
            (localId, foreignId) = (local.Id, foreign.Id);
        }

        using var systemAdmin = await fixture.Login("admin");
        using var adminGrant = await systemAdmin.PostAsJsonAsync("/api/v1/admin/users", new
        {
            name = "Sri Lanka Administrator", email = "case-scope-admin@surakuma.test",
            password = fixture.Password, role = Roles.CountryAdministrator, countryCode = "LK"
        });
        adminGrant.EnsureSuccessStatusCode();
        using var countryAdmin = await fixture.Login("case-scope-admin");
        using var managerGrant = await countryAdmin.PostAsJsonAsync("/api/v1/admin/users", new
        {
            name = "Sri Lanka Case Manager", email = "case-scope-manager@surakuma.test",
            password = fixture.Password, role = Roles.CaseManager, countryCode = "LK", organisationId
        });
        managerGrant.EnsureSuccessStatusCode();
        using var caseManager = await fixture.Login("case-scope-manager");

        var localCases = await caseManager.GetFromJsonAsync<JsonElement>("/api/v1/requests?staffRole=CaseManager&countryCode=LK");
        Assert.Contains(localCases.GetProperty("items").EnumerateArray(), request => request.GetProperty("id").GetGuid() == localId);
        var foreignCases = await caseManager.GetFromJsonAsync<JsonElement>("/api/v1/requests?staffRole=CaseManager&countryCode=NP");
        Assert.Empty(foreignCases.GetProperty("items").EnumerateArray());
        var allCases = await caseManager.GetFromJsonAsync<JsonElement>("/api/v1/requests?staffRole=CaseManager");
        Assert.DoesNotContain(allCases.GetProperty("items").EnumerateArray(), request => request.GetProperty("id").GetGuid() == foreignId);
        Assert.Equal(HttpStatusCode.OK, (await caseManager.GetAsync("/api/v1/staff/overview/CaseManager")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await caseManager.GetAsync("/api/v1/staff/overview/CaseManager?countryCode=NP")).StatusCode);
        using var foreignDetail = await caseManager.GetAsync($"/api/v1/requests/{foreignId}?countryCode=NP");
        Assert.Equal(HttpStatusCode.NotFound, foreignDetail.StatusCode);

        var review = new { status = RequestStatus.UnderReview.ToString(), reason = "Verified intake details." };
        using var localUpdate = await caseManager.PatchAsJsonAsync($"/api/v1/requests/{localId}/status", review);
        Assert.Equal(HttpStatusCode.OK, localUpdate.StatusCode);
        using var foreignUpdate = await caseManager.PatchAsJsonAsync($"/api/v1/requests/{foreignId}/status", review);
        Assert.Equal(HttpStatusCode.NotFound, foreignUpdate.StatusCode);
    }

    [Fact]
    public async Task ManagerOverviewAndQueueUseTheSameAssignedCasesAndRejectAmbiguousScope()
    {
        Guid inScope, newest, wrongCrisis, wrongOrganisation, regionId, centreId;
        string managerId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            managerId = await db.Users.Where(u => u.Email == "case@surakuma.test").Select(u => u.Id).SingleAsync();
            var grant = await db.Set<Membership>().SingleAsync(m => m.UserId == managerId && m.Role == Roles.CaseManager);
            centreId = grant.OrganisationId!.Value;
            var citizen = await db.Users.Where(u => u.Email == "citizen@surakuma.test").Select(u => u.Id).SingleAsync();
            var crisis = new Crisis { CountryCode = "LK", Name = "Case workspace test crisis" };
            var otherCrisis = new Crisis { CountryCode = "LK", Name = "Other local crisis" };
            var otherCentre = new Organisation { Name = "Out of scope centre" };
            var region = new AdministrativeDivision { CountryCode = "LK", Name = "Workspace test district", LevelName = "District" };
            db.AddRange(crisis, otherCrisis, otherCentre, region);
            grant.CrisisId = crisis.Id;
            regionId = region.Id;
            var now = DateTimeOffset.UtcNow;

            AssistanceRequest Create(Guid crisisId, Guid orgId, bool assigned = true)
            {
                var request = new AssistanceRequest { CrisisId = crisisId, OrganisationId = orgId, CitizenId = citizen,
                    AssignedCaseManagerId = assigned ? managerId : null, AdministrativeDivisionId = regionId, Category = AidCategory.Medical,
                    Status = RequestStatus.UnderReview, Priority = Priority.Critical, HouseholdSize = 3,
                    Quantity = 2, Unit = "kits", SubmissionKey = Guid.NewGuid().ToString(), Description = "Workspace filter match",
                    CreatedAt = now.AddHours(-2) };
                db.Add(request);
                return request;
            }
            var recentReview = Create(crisis.Id, centreId);
            recentReview.CreatedAt = now.AddMinutes(-2);
            inScope = recentReview.Id;
            var recentSubmission = Create(crisis.Id, centreId);
            recentSubmission.Status = RequestStatus.Submitted;
            recentSubmission.Priority = Priority.Normal;
            recentSubmission.CreatedAt = now.AddMinutes(-1);
            newest = recentSubmission.Id;
            wrongCrisis = Create(otherCrisis.Id, centreId).Id;
            wrongOrganisation = Create(crisis.Id, otherCentre.Id).Id;
            Create(crisis.Id, centreId, assigned: false);
            for (var i = 0; i < 20; i++) Create(crisis.Id, centreId);
            var closed = Create(crisis.Id, centreId);
            closed.Status = RequestStatus.Closed;
            closed.Escalated = true;
            db.Add(new Feedback { RequestId = closed.Id, UserId = citizen, Problem = true });
            await db.SaveChangesAsync();
        }

        using var manager = await fixture.Login("case");
        var overview = await manager.GetFromJsonAsync<JsonElement>("/api/v1/staff/overview/CaseManager");
        var metrics = overview.GetProperty("metrics");
        Assert.Equal(22, metrics.GetProperty("assigned").GetInt32());
        Assert.Equal(21, metrics.GetProperty("verification").GetInt32());
        Assert.Equal(21, metrics.GetProperty("critical").GetInt32());
        Assert.Equal(1, metrics.GetProperty("followUps").GetInt32());
        var needs = Assert.Single(overview.GetProperty("needs").EnumerateArray());
        Assert.Equal("Medical", needs.GetProperty("category").GetString());
        Assert.Equal(66, needs.GetProperty("householdMembers").GetInt32());
        Assert.Equal(regionId, Assert.Single(overview.GetProperty("regions").EnumerateArray()).GetProperty("id").GetGuid());
        var attention = overview.GetProperty("attention");
        Assert.Equal(4, attention.GetArrayLength());
        Assert.Equal(newest, attention[0].GetProperty("id").GetGuid());
        Assert.Equal(inScope, attention[1].GetProperty("id").GetGuid());

        var history = await manager.GetFromJsonAsync<JsonElement>("/api/v1/requests?staffRole=CaseManager&assignedToMe=true&search=Workspace");
        Assert.Equal(newest, history.GetProperty("items")[0].GetProperty("id").GetGuid());

        var query = $"/api/v1/requests?staffRole=CaseManager&assignedToMe=true&view=verification&category=Medical&priority=Critical&regionId={regionId}&search=Workspace";
        var first = await manager.GetFromJsonAsync<JsonElement>(query);
        var second = await manager.GetFromJsonAsync<JsonElement>(query + "&page=2");
        var items = first.GetProperty("items").EnumerateArray().Concat(second.GetProperty("items").EnumerateArray()).ToArray();
        Assert.Equal(20, first.GetProperty("items").GetArrayLength());
        Assert.Equal(2, second.GetProperty("pageNumber").GetInt32());
        Assert.Equal(21, second.GetProperty("total").GetInt32());
        Assert.Equal(21, items.Select(r => r.GetProperty("id").GetGuid()).Distinct().Count());
        Assert.Equal(inScope, items[0].GetProperty("id").GetGuid());
        var submissionTimes = items.Select(r => r.GetProperty("createdAt").GetDateTimeOffset()).ToArray();
        Assert.Equal(submissionTimes.OrderByDescending(time => time), submissionTimes);
        Assert.Equal(HttpStatusCode.NotFound, (await manager.GetAsync($"/api/v1/requests/{wrongCrisis}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await manager.GetAsync($"/api/v1/requests/{wrongOrganisation}")).StatusCode);
        var followUps = await manager.GetFromJsonAsync<JsonElement>("/api/v1/requests?staffRole=CaseManager&assignedToMe=true&view=follow-ups");
        Assert.Equal("Closed", Assert.Single(followUps.GetProperty("items").EnumerateArray()).GetProperty("status").GetString());

        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            db.Add(new Membership { UserId = managerId, OrganisationId = centreId, Role = Roles.CaseManager, CountryCode = "NP" });
            await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.BadRequest, (await manager.GetAsync("/api/v1/staff/overview/CaseManager?countryCode=LK")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await manager.GetAsync(query)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await manager.GetAsync($"/api/v1/requests/{inScope}?countryCode=LK")).StatusCode);
        var verify = new { status = "Verified", reason = "Attempt outside active scope" };
        Assert.Equal(HttpStatusCode.NotFound, (await manager.PatchAsJsonAsync($"/api/v1/requests/{inScope}/status?countryCode=LK", verify)).StatusCode);
    }

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
