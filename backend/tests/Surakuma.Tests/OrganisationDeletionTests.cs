using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Api.Controllers;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class OrganisationDeletionTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    private const string Directory = "/api/v1/admin/organisations";

    [Fact]
    public async Task SystemAdminCanDeleteUnusedOrganisationFromEveryCountryAndAuditTheRemoval()
    {
        using var admin = await fixture.Login("admin");
        var organisation = await CreateOrganisation(admin);
        var path = $"{Directory}/{organisation.Id}";
        (await admin.PutAsync(path + "/countries/NP", null)).EnsureSuccessStatusCode();

        using (var setup = fixture.Factory.Services.CreateScope())
        {
            var db = setup.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var coordinator = await db.Users.SingleAsync(u => u.Email == "coordinator@surakuma.test");
            var grant = await db.Set<Membership>().SingleAsync(m => m.UserId == coordinator.Id && m.Role == Roles.Coordinator);
            db.Add(new Membership { UserId = coordinator.Id, OrganisationId = grant.OrganisationId, CountryCode = "LK", Role = Roles.CountryAdministrator });
            await db.SaveChangesAsync();
        }
        using var countryAdmin = await fixture.Login("coordinator");
        Assert.Equal(HttpStatusCode.Forbidden, (await countryAdmin.GetAsync(path + "/deletion")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await countryAdmin.DeleteAsync(path)).StatusCode);

        var preview = await admin.GetFromJsonAsync<OrganisationDeletionController.DeletionImpact>(path + "/deletion");
        Assert.Equal(["Nepal", "Sri Lanka"], preview!.Countries);
        Assert.Empty(preview.Blockers);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync(path + "/deletion")).StatusCode);

        using var check = fixture.Factory.Services.CreateScope();
        var database = check.ServiceProvider.GetRequiredService<CrisisDbContext>();
        Assert.False(await database.Set<OrganisationCountry>().AnyAsync(link => link.OrganisationId == organisation.Id));
        var audit = await database.Set<AuditEvent>().Where(a => a.EntityId == organisation.Id && a.Action == "OrganisationDeleted")
            .OrderBy(a => a.CountryCode).ToListAsync();
        Assert.Equal(["LK", "NP"], audit.Select(a => a.CountryCode));
        Assert.All(audit, a => Assert.Equal(organisation.Name, a.Detail));
    }

    [Fact]
    public async Task DeletionRechecksEndedCrisesAndSuspendedGrantsAddedAfterPreview()
    {
        using var admin = await fixture.Login("admin");
        var organisation = await CreateOrganisation(admin);
        var path = $"{Directory}/{organisation.Id}";
        var preview = await admin.GetFromJsonAsync<OrganisationDeletionController.DeletionImpact>(path + "/deletion");
        Assert.Empty(preview!.Blockers);
        (await admin.PutAsync(path + "/countries/NP", null)).EnsureSuccessStatusCode();

        using (var setup = fixture.Factory.Services.CreateScope())
        {
            var db = setup.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var citizen = await db.Users.SingleAsync(u => u.Email == "citizen@surakuma.test");
            db.Add(new Crisis { Name = "Ended Nepal response", CountryCode = "NP", PrimaryOrganisationId = organisation.Id, Active = false });
            db.Add(new Membership { UserId = citizen.Id, OrganisationId = organisation.Id, CountryCode = "NP", Role = Roles.CaseManager, Suspended = true });
            await db.SaveChangesAsync();
        }

        Assert.Equal(HttpStatusCode.Conflict, (await admin.DeleteAsync(path)).StatusCode);
        var updated = await admin.GetFromJsonAsync<OrganisationDeletionController.DeletionImpact>(path + "/deletion");
        Assert.Contains(updated!.Blockers, reason => reason.Contains("suspended grants"));
        Assert.Contains(updated.Blockers, reason => reason.Contains("primary centre"));
        Assert.Equal(["Nepal", "Sri Lanka"], updated.Countries);
    }

    [Fact]
    public async Task DeleteAnywayWithdrawsAccessAndRoutingWhileKeepingTheCases()
    {
        using var admin = await fixture.Login("admin");
        var organisation = await CreateOrganisation(admin);
        var path = $"{Directory}/{organisation.Id}";
        var archive = path + "?archiveLinked=true";
        (await admin.PutAsync(path + "/countries/NP", null)).EnsureSuccessStatusCode();
        Guid crisisId, openCaseId, closedCaseId, shelterId, proposalId;
        string managerId;
        using (var setup = fixture.Factory.Services.CreateScope())
        {
            var db = setup.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var citizen = await db.Users.SingleAsync(u => u.Email == "citizen@surakuma.test");
            var manager = await db.Users.SingleAsync(u => u.Email == "case@surakuma.test");
            managerId = manager.Id;
            var crisis = new Crisis { Name = "Archive test response", CountryCode = "LK", PrimaryOrganisationId = organisation.Id, Active = true };
            var grant = new Membership { UserId = managerId, OrganisationId = organisation.Id, CountryCode = "LK", Role = Roles.CaseManager };
            var open = new AssistanceRequest
            {
                CrisisId = crisis.Id, CitizenId = citizen.Id, OrganisationId = organisation.Id, AssignedCaseManagerId = managerId,
                AssignmentStatus = AssignmentStatus.Claimed, Status = RequestStatus.Approved, SubmissionKey = Guid.NewGuid().ToString()
            };
            var closed = new AssistanceRequest
            {
                CrisisId = crisis.Id, CitizenId = citizen.Id, OrganisationId = organisation.Id, AssignedCaseManagerId = managerId,
                AssignmentStatus = AssignmentStatus.Claimed, Status = RequestStatus.Closed, SubmissionKey = Guid.NewGuid().ToString()
            };
            var shelter = new Shelter { Name = "Archive test shelter", CountryCode = "LK", OrganisationId = organisation.Id, Capacity = 20, Open = true };
            var proposal = new AdminProposal
            {
                CountryCode = "LK", Kind = "GlobalAccess", State = "Pending",
                RequesterUserId = managerId, ExpiresAt = DateTimeOffset.UtcNow.AddDays(1),
                Payload = JsonSerializer.Serialize(new AdministrationController.GrantPayload(managerId))
            };
            foreach (var link in await db.Set<OrganisationCountry>().Where(link => link.OrganisationId == organisation.Id).ToListAsync())
                link.VerificationState = "Verified";
            db.AddRange(crisis, grant, open, closed, shelter, proposal);
            await db.SaveChangesAsync();
            crisisId = crisis.Id;
            openCaseId = open.Id;
            closedCaseId = closed.Id;
            shelterId = shelter.Id;
            proposalId = proposal.Id;
        }

        using var managerSession = await fixture.Login("case");
        Assert.Equal(HttpStatusCode.Forbidden, (await managerSession.DeleteAsync(archive)).StatusCode);
        var preview = await admin.GetFromJsonAsync<OrganisationDeletionController.DeletionImpact>(path + "/deletion");
        Assert.True(preview!.CanArchiveLinked);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.DeleteAsync(path)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync(archive)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync(archive)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await managerSession.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsync(path + "/countries/IN", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync(path + "/deletion")).StatusCode);

        var triage = await admin.GetFromJsonAsync<JsonElement>("/api/v1/requests/triage?countryCode=LK");
        Assert.Contains(triage.EnumerateArray(), request => request.GetProperty("id").GetGuid() == openCaseId
            && request.GetProperty("assignedCaseManagerId").ValueKind == JsonValueKind.Null);
        foreach (var country in new[] { "LK", "NP" })
        {
            var directory = await admin.GetFromJsonAsync<JsonElement>($"{Directory}?countryCode={country}");
            Assert.DoesNotContain(directory.EnumerateArray(), entry => entry.GetProperty("id").GetGuid() == organisation.Id);
            var lookups = await admin.GetFromJsonAsync<JsonElement>($"/api/v1/public/lookups?countryCode={country}");
            Assert.DoesNotContain(lookups.GetProperty("organisations").EnumerateArray(), entry => entry.GetProperty("id").GetGuid() == organisation.Id);
        }
        var shelters = await admin.GetFromJsonAsync<JsonElement>("/api/v1/shelters?countryCode=LK");
        Assert.DoesNotContain(shelters.EnumerateArray(), entry => entry.GetProperty("id").GetGuid() == shelterId);

        using var check = fixture.Factory.Services.CreateScope();
        var database = check.ServiceProvider.GetRequiredService<CrisisDbContext>();
        Assert.NotNull((await database.Set<Organisation>().FindAsync(organisation.Id))!.ArchivedAt);
        Assert.Null((await database.Set<Crisis>().FindAsync(crisisId))!.PrimaryOrganisationId);
        var opened = (await database.Set<AssistanceRequest>().FindAsync(openCaseId))!;
        Assert.Null(opened.OrganisationId);
        Assert.Equal(RequestStatus.Approved, opened.Status);
        Assert.Equal(organisation.Id, (await database.Set<AssistanceRequest>().FindAsync(closedCaseId))!.OrganisationId);
        Assert.True(await database.Set<RequestHistory>().AnyAsync(h => h.RequestId == openCaseId && h.Note.Contains("awaiting reassignment")));
        Assert.True(await database.Set<Membership>().IgnoreQueryFilters().AnyAsync(m => m.OrganisationId == organisation.Id && m.UserId == managerId && m.Suspended));
        Assert.Equal("Pending", (await database.Set<AdminProposal>().FindAsync(proposalId))!.State);
        Assert.True(await database.Set<Shelter>().AnyAsync(s => s.Id == shelterId));
        Assert.Equal(2, await database.Set<AuditEvent>().CountAsync(a => a.EntityId == organisation.Id && a.Action == "OrganisationArchived"));
    }

    [Fact]
    public async Task ArchivingAnOrganisationWithALegacyAdminGrantKeepsSystemAccess()
    {
        using var admin = await fixture.Login("admin");
        var organisation = await CreateOrganisation(admin);
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var administrator = await db.ActiveSystemAdministrators.SingleAsync();
        db.Add(new Membership { UserId = administrator.Id, OrganisationId = organisation.Id, Role = Roles.Administrator });
        await db.SaveChangesAsync();
        var path = $"{Directory}/{organisation.Id}";
        var impact = await admin.GetFromJsonAsync<OrganisationDeletionController.DeletionImpact>(path + "/deletion");
        Assert.True(impact!.CanArchiveLinked);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync(path + "?archiveLinked=true")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync(Directory + "?countryCode=NP")).StatusCode);
        Assert.Empty((await admin.GetFromJsonAsync<JsonElement>("/api/v1/auth/me")).GetProperty("memberships").EnumerateArray());
        Assert.True(await db.Set<Organisation>().AnyAsync(o => o.Id == organisation.Id && o.ArchivedAt != null));
    }

    [Fact]
    public async Task CountryRemovalOnlyWithdrawsLocalRoutingAccessAndDirectoryListing()
    {
        using var admin = await fixture.Login("admin");
        var organisation = await CreateOrganisation(admin);
        var path = $"{Directory}/{organisation.Id}";
        (await admin.PutAsync(path + "/countries/NP", null)).EnsureSuccessStatusCode();
        (await admin.PostAsJsonAsync("/api/v1/admin/users", new
        {
            role = Roles.CountryAdministrator, countryCode = "NP", email = "removal-np@surakuma.test",
            name = "Nepal administrator", password = fixture.Password
        })).EnsureSuccessStatusCode();

        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var citizen = await db.Users.SingleAsync(u => u.Email == "citizen@surakuma.test");
        var staff = await db.Users.SingleAsync(u => u.Email == "case@surakuma.test");
        var nepal = new Crisis { Name = "Nepal response", CountryCode = "NP", PrimaryOrganisationId = organisation.Id };
        var sriLanka = new Crisis { Name = "Sri Lanka response", CountryCode = "LK", PrimaryOrganisationId = organisation.Id };
        var nepalCase = new AssistanceRequest { CrisisId = nepal.Id, OrganisationId = organisation.Id, CitizenId = citizen.Id, SubmissionKey = Guid.NewGuid().ToString() };
        var sriLankaCase = new AssistanceRequest { CrisisId = sriLanka.Id, OrganisationId = organisation.Id, CitizenId = citizen.Id, SubmissionKey = Guid.NewGuid().ToString() };
        db.AddRange(nepal, sriLanka, nepalCase, sriLankaCase,
            new Membership { UserId = staff.Id, Role = Roles.CaseManager, CountryCode = "NP", OrganisationId = organisation.Id },
            new Membership { UserId = staff.Id, Role = Roles.CaseManager, CountryCode = "LK", OrganisationId = organisation.Id });
        await db.SaveChangesAsync();

        using var country = await fixture.Login("removal-np");
        Assert.Equal(HttpStatusCode.Forbidden, (await country.DeleteAsync(path + "?archiveLinked=true")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await country.DeleteAsync(path + "/countries/LK")).StatusCode);
        var removal = path + "/countries/NP";
        var preview = await country.GetFromJsonAsync<OrganisationDeletionController.DeletionImpact>(removal + "/deletion");
        Assert.Equal(["Nepal"], preview!.Countries);
        Assert.Equal(HttpStatusCode.NoContent, (await country.DeleteAsync(removal)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await country.DeleteAsync(removal)).StatusCode);
        Assert.DoesNotContain(organisation.Name, await country.GetStringAsync(Directory + "?countryCode=NP"));
        Assert.Contains(organisation.Name, await admin.GetStringAsync(Directory + "?countryCode=LK"));

        db.ChangeTracker.Clear();
        Assert.Null((await db.Set<Crisis>().FindAsync(nepal.Id))!.PrimaryOrganisationId);
        Assert.Equal(organisation.Id, (await db.Set<Crisis>().FindAsync(sriLanka.Id))!.PrimaryOrganisationId);
        Assert.Null((await db.Set<AssistanceRequest>().FindAsync(nepalCase.Id))!.OrganisationId);
        Assert.Equal(organisation.Id, (await db.Set<AssistanceRequest>().FindAsync(sriLankaCase.Id))!.OrganisationId);
        Assert.Equal("LK", await db.Set<Membership>().Where(m => m.OrganisationId == organisation.Id).Select(m => m.CountryCode).SingleAsync());
        Assert.True(await db.Set<AuditEvent>().AnyAsync(a => a.Action == "OrganisationCountryRemoved" && a.CountryCode == "NP" && a.Detail == organisation.Name));
        (await admin.PutAsync(removal, null)).EnsureSuccessStatusCode();
        Assert.Equal("Pending", await db.Set<OrganisationCountry>().Where(link => link.OrganisationId == organisation.Id && link.CountryCode == "NP").Select(link => link.VerificationState).SingleAsync());
        Assert.False(await db.Set<Membership>().AnyAsync(m => m.OrganisationId == organisation.Id && m.CountryCode == "NP"));
    }

    private static async Task<Organisation> CreateOrganisation(HttpClient admin)
    {
        var response = await admin.PostAsJsonAsync(Directory, new { name = "Unused response organisation", countryCode = "LK" });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<Organisation>())!;
    }
}
