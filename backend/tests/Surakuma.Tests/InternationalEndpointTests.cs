using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class InternationalEndpointTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task CountryAdministratorsManageLocalCrisesAndSystemAdministratorSeesAllCountries()
    {
        using var admin = await fixture.Login("admin");
        var appointment = await admin.PostAsJsonAsync("/api/v1/admin/users", new
        {
            email = "nepal-admin@surakuma.test", name = "Nepal administrator", password = fixture.Password,
            role = Roles.CountryAdministrator, countryCode = "NP"
        });
        appointment.EnsureSuccessStatusCode();
        using var country = await fixture.Login("nepal-admin");
        var account = await country.GetFromJsonAsync<JsonElement>("/api/v1/auth/me");
        Assert.Equal(JsonValueKind.Null, Assert.Single(account.GetProperty("memberships").EnumerateArray()).GetProperty("organisationId").ValueKind);
        var local = new { name = "Nepal flood", countryCode = "NP" };
        var foreign = new { name = "Sri Lanka flood", countryCode = "LK" };
        var created = await country.PostAsJsonAsync("/api/v1/crises", local);
        created.EnsureSuccessStatusCode();
        var nepal = (await created.Content.ReadFromJsonAsync<Crisis>())!;
        Assert.Equal(HttpStatusCode.Forbidden, (await country.PostAsJsonAsync("/api/v1/crises", foreign)).StatusCode);
        var other = await admin.PostAsJsonAsync("/api/v1/crises", foreign);
        other.EnsureSuccessStatusCode();
        var sriLanka = (await other.Content.ReadFromJsonAsync<Crisis>())!;
        Assert.Equal(HttpStatusCode.Forbidden, (await country.PutAsJsonAsync($"/api/v1/crises/{sriLanka.Id}", foreign)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await country.PutAsJsonAsync($"/api/v1/crises/{nepal.Id}", local)).StatusCode);
        Assert.All((await country.GetFromJsonAsync<List<Crisis>>("/api/v1/crises"))!, crisis => Assert.Equal("NP", crisis.CountryCode));
        var all = (await admin.GetFromJsonAsync<List<Crisis>>("/api/v1/crises"))!;
        Assert.Contains(all, crisis => crisis.Id == sriLanka.Id);
        Assert.Contains(all, crisis => crisis.Id == nepal.Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await country.PostAsJsonAsync("/api/v1/admin/users", new
        {
            email = "second-nepal-admin@surakuma.test", role = Roles.CountryAdministrator, countryCode = "NP"
        })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync("/api/v1/incidents", new { name = "Retired option" })).StatusCode);
    }

    [Fact]
    public async Task CrisisOnlyInventorySelectionWorksWithoutNationalStockAdministration()
    {
        Guid requestId, foreignRequestId, resourceId, organisationId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var citizen = await db.Users.SingleAsync(x => x.Email == "citizen@surakuma.test");
            var user = await db.Users.SingleAsync(x => x.Email == "shelter@surakuma.test");
            organisationId = await db.Set<Organisation>().Select(x => x.Id).FirstAsync();
            var crisis = new Crisis { Name = "Crisis-only inventory", CountryCode = "NP" };
            var foreign = new Crisis { Name = "Other Nepal crisis", CountryCode = "NP" };
            var request = new AssistanceRequest { CrisisId = crisis.Id, CitizenId = citizen.Id, OrganisationId = organisationId, Status = RequestStatus.Approved, Category = AidCategory.FoodWater, Quantity = 1, SubmissionKey = Guid.NewGuid().ToString() };
            var other = new AssistanceRequest { CrisisId = foreign.Id, CitizenId = citizen.Id, OrganisationId = organisationId, SubmissionKey = Guid.NewGuid().ToString() };
            var resource = new Resource { CountryCode = "NP", OrganisationId = organisationId, Category = AidCategory.FoodWater, Name = "Scoped stock", Unit = "packs", Stock = 5 };
            if (!await db.Set<OrganisationCountry>().AnyAsync(x => x.OrganisationId == organisationId && x.CountryCode == "NP")) db.Add(new OrganisationCountry { OrganisationId = organisationId, CountryCode = "NP", VerificationState = "Verified" });
            db.AddRange(crisis, foreign, request, other, resource);
            db.Add(new Membership { CountryCode = "NP", CrisisId = crisis.Id, OrganisationId = organisationId, UserId = user.Id, Role = Roles.Coordinator });
            await db.SaveChangesAsync(); requestId = request.Id; foreignRequestId = other.Id; resourceId = resource.Id;
        }
        using var staff = await fixture.Login("shelter");
        var stock = await staff.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{requestId}/resources?countryCode=NP");
        Assert.Contains(stock.EnumerateArray(), x => x.GetProperty("id").GetGuid() == resourceId);
        Assert.Equal(HttpStatusCode.OK, (await staff.GetAsync($"/api/v1/requests/{requestId}/allocation-recommendations?countryCode=NP")).StatusCode);
        Assert.Empty((await staff.GetFromJsonAsync<List<Resource>>("/api/v1/resources?countryCode=NP"))!);
        foreach (var action in new[] { "resources", "shelters", "allocation-recommendations" })
            Assert.Equal(HttpStatusCode.NotFound, (await staff.GetAsync($"/api/v1/requests/{foreignRequestId}/{action}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync($"/api/v1/resources/{resourceId}/replenish", new { quantity = 1, note = "Not a national grant" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await staff.PostAsJsonAsync("/api/v1/allocations", new { requestId, resourceId, quantity = 1 })).StatusCode);
    }

    [Fact]
    public async Task ScopedGrantRevocationAndCountryAlertPolicyApplyImmediately()
    {
        using var admin = await fixture.Login("admin");
        Guid organisationId, np, india;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            organisationId = await db.Set<Membership>().Where(x => x.Role == Roles.Logistics).Select(x => x.OrganisationId!.Value).FirstAsync();
            var nepal = new Crisis { Name = "Nepal grant journey", CountryCode = "NP" };
            var indian = new Crisis { Name = "India grant journey", CountryCode = "IN" };
            db.AddRange(nepal, indian); await db.SaveChangesAsync(); np = nepal.Id; india = indian.Id;
        }
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PutAsync($"/api/v1/admin/organisations/{organisationId}/countries/NP", null)).StatusCode);
        (await admin.PostAsJsonAsync($"/api/v1/admin/organisations/{organisationId}/countries/NP/verification", new { evidence = "Test registration reviewed", decision = "Verified", reason = "Acceptance fixture" })).EnsureSuccessStatusCode();
        var grant = await admin.PostAsJsonAsync("/api/v1/admin/users", new { email = "logistics@surakuma.test", password = fixture.Password, name = "Logistics", organisationId, role = "Coordinator", countryCode = "NP", crisisId = np });
        grant.EnsureSuccessStatusCode();
        using var staff = await fixture.Login("logistics");
        Assert.Equal(HttpStatusCode.OK, (await staff.GetAsync($"/api/v1/crises/{np}/areas")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync($"/api/v1/crises/{india}/areas")).StatusCode);
        var alert = new { crisisId = np, title = "Safety update", message = "Follow local authorised guidance",
            area = "Local district", authority = "Local coordination team", expiresAt = DateTimeOffset.UtcNow.AddDays(1), published = true };
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.PostAsJsonAsync("/api/v1/alerts", alert)).StatusCode);
        // A country policy change takes effect immediately for the existing coordinator session.
        var contacts = new[] { new { label = "Police emergency", number = "100", sourceUrl = "https://ncb.nepalpolice.gov.np/safety-and-security/" } };
        (await admin.PutAsJsonAsync("/api/v1/countries/NP/services", new { languages = "en,ne", requiredAlertLanguages = "en", contacts })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await staff.PostAsJsonAsync("/api/v1/alerts", alert)).StatusCode);
        (await admin.PutAsJsonAsync("/api/v1/countries/NP/services", new { languages = "en,ne", requiredAlertLanguages = "en,ne", contacts })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.PostAsJsonAsync("/api/v1/alerts", alert)).StatusCode);
        Guid membershipId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            membershipId = await db.Set<Membership>().Where(x => x.CrisisId == np).Select(x => x.Id).SingleAsync();
        }
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/v1/admin/memberships/{membershipId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await staff.GetAsync($"/api/v1/crises/{np}/areas")).StatusCode);
        using var refreshed = await fixture.Login("logistics");
        Assert.Equal(HttpStatusCode.Forbidden, (await refreshed.GetAsync($"/api/v1/crises/{np}/areas")).StatusCode);
    }
    [Theory]
    [InlineData("LK", 25, "119")]
    [InlineData("NP", 7, "100")]
    [InlineData("IN", 36, "112")]
    public async Task ReferenceRegionsAndContactsAreCountrySpecific(string code, int count, string phone)
    {
        using var client = fixture.Client();
        var divisions = await client.GetFromJsonAsync<List<AdministrativeDivision>>($"/api/v1/countries/{code}/divisions");
        Assert.Equal(count, divisions!.Count(x => x.ParentId == null));
        Assert.All(divisions!, d => Assert.Equal(code, d.CountryCode));
        var countries = await client.GetFromJsonAsync<List<Country>>("/api/v1/countries");
        Assert.Contains(phone, countries!.Single(x => x.Code == code).EmergencyContactsJson);
    }

    [Fact]
    public async Task ForeignOperationsAreIsolatedAcrossReadsMutationsReportsAndAdministration()
    {
        Guid crisisId, requestId, resourceId, shelterId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var original = await db.Set<AssistanceRequest>().FirstAsync();
            var crisis = new Crisis { CountryCode = "NP", Name = "Nepal endpoint matrix" };
            var request = new AssistanceRequest { CitizenId = original.CitizenId, OrganisationId = original.OrganisationId, CrisisId = crisis.Id, SubmissionKey = Guid.NewGuid().ToString(), Status = RequestStatus.Approved };
            var resource = new Resource { OrganisationId = original.OrganisationId!.Value, CountryCode = "NP", Name = "Foreign depot", Stock = 12 };
            var shelter = new Shelter { OrganisationId = original.OrganisationId.Value, CountryCode = "NP", Name = "Foreign shelter", Capacity = 10 };
            db.AddRange(crisis, request, resource, shelter);
            db.Add(new PublicAlert { CrisisId = crisis.Id, Title = "Nepal alert", Message = "Instructions", Published = true, ExpiresAt = DateTimeOffset.UtcNow.AddDays(1) });
            await db.SaveChangesAsync();
            crisisId = crisis.Id; requestId = request.Id; resourceId = resource.Id; shelterId = shelter.Id;
        }
        using var coordinator = await fixture.Login("coordinator");
        foreach (var path in new[] { $"requests/{requestId}", $"requests/{requestId}/recommendations", $"requests/{requestId}/allocation-recommendations" })
            Assert.Equal(HttpStatusCode.NotFound, (await coordinator.GetAsync("/api/v1/" + path)).StatusCode);
        foreach (var path in new[] { $"crises/{crisisId}/areas", $"resources/{resourceId}/movements", $"requests/{requestId}/case-managers" })
            Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.GetAsync("/api/v1/" + path)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.PostAsJsonAsync($"/api/v1/resources/{resourceId}/replenish", new { quantity = 1, note = "Invalid foreign stock change" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.PutAsJsonAsync($"/api/v1/crises/{crisisId}/centre", new { organisationId = (Guid?)null })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await coordinator.PatchAsJsonAsync($"/api/v1/requests/{requestId}/status", new { status = "InProgress" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await coordinator.PostAsJsonAsync("/api/v1/allocations", new { requestId, resourceId, quantity = 1 })).StatusCode);
        var resources = await coordinator.GetFromJsonAsync<List<Resource>>("/api/v1/resources?countryCode=NP");
        var shelters = await coordinator.GetFromJsonAsync<List<Shelter>>("/api/v1/staff/shelters?countryCode=NP");
        Assert.Empty(resources!); Assert.Empty(shelters!);
        var metrics = await coordinator.GetFromJsonAsync<JsonElement>("/api/v1/reports/metrics?countryCode=NP");
        Assert.Equal(0, metrics.GetProperty("openCases").GetInt32());
        using var citizen = await fixture.Login("citizen");
        var submitted = await citizen.PostAsJsonAsync("/api/v1/requests", new { crisisId, category = "FoodWater", priority = "Normal", description = "A household needs clean drinking water", locationText = "Nepal community", householdSize = 2, accessibilityNeeds = "", quantity = 1, submissionKey = Guid.NewGuid().ToString() });
        Assert.Equal(HttpStatusCode.Created, submitted.StatusCode);
        using var publicClient = fixture.Client();
        Assert.DoesNotContain(await publicClient.GetFromJsonAsync<List<PublicAlert>>("/api/v1/alerts?countryCode=LK") ?? [], x => x.CrisisId == crisisId);
        Assert.Contains(await publicClient.GetFromJsonAsync<List<PublicAlert>>("/api/v1/alerts?countryCode=NP") ?? [], x => x.CrisisId == crisisId);
        Assert.DoesNotContain(await publicClient.GetFromJsonAsync<List<Shelter>>("/api/v1/shelters?countryCode=LK") ?? [], x => x.Id == shelterId);
    }

    [Fact]
    public async Task CountryAdministratorCannotChangeAnotherCountryOrGrantGlobalAccess()
    {
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var userId = await db.Users.Where(x => x.Email == "case@surakuma.test").Select(x => x.Id).SingleAsync();
            var org = await db.Set<Organisation>().FirstAsync();
            db.Add(new Membership { UserId = userId, OrganisationId = org.Id, Role = Roles.CountryAdministrator, CountryCode = "NP" });
            await db.SaveChangesAsync();
        }
        using var admin = await fixture.Login("case");
        var policy = new { languages = "en,ne", requiredAlertLanguages = "en,ne", contacts = Array.Empty<object>() };
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PutAsJsonAsync("/api/v1/countries/LK/services", policy)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PutAsJsonAsync("/api/v1/countries/NP/services", policy)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync("/api/v1/admin/users?countryCode=LK")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/v1/admin/users?countryCode=NP")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync("/api/v1/admin/organisations?countryCode=LK")).StatusCode);
        var partners = await admin.GetFromJsonAsync<JsonElement>("/api/v1/admin/organisations?countryCode=NP");
        Assert.All(partners.EnumerateArray(), partner => Assert.True(partner.GetProperty("enabled").GetBoolean()));
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync("/api/v1/admin/audit")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync("/api/v1/admin/deliveries")).StatusCode);
        // Restore the country policy so other cases in this fixture remain independent.
        using var global = await fixture.Login("admin");
        Assert.Equal(HttpStatusCode.NoContent, (await global.PutAsJsonAsync("/api/v1/countries/NP/services", new { languages = "en,ne", requiredAlertLanguages = "en", contacts = new[] { new { label = "Police emergency", number = "100", sourceUrl = "https://ncb.nepalpolice.gov.np/safety-and-security/" } } })).StatusCode);
    }

    [Fact]
    public async Task PartnerDirectoryReportsEnablementAndActivePrimaryCrisesByCountry()
    {
        using var admin = await fixture.Login("admin");
        var created = await admin.PostAsJsonAsync("/api/v1/admin/organisations", new { name = "Directory test partner", countryCode = "LK" });
        created.EnsureSuccessStatusCode();
        var partner = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        async Task<JsonElement> Entry(string country)
        {
            var directory = await admin.GetFromJsonAsync<JsonElement>($"/api/v1/admin/organisations?countryCode={country}");
            return Assert.Single(directory.EnumerateArray(), x => x.GetProperty("id").GetGuid() == partner);
        }

        Assert.True((await Entry("LK")).GetProperty("enabled").GetBoolean());
        var nepalBefore = await admin.GetFromJsonAsync<JsonElement>("/api/v1/admin/organisations?countryCode=NP");
        Assert.DoesNotContain(nepalBefore.EnumerateArray(), x => x.GetProperty("id").GetGuid() == partner);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PutAsync($"/api/v1/admin/organisations/{partner}/countries/NP", null)).StatusCode);

        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var crisis = new Crisis { Name = "Directory routing test", CountryCode = "NP", Active = true, PrimaryOrganisationId = partner };
        db.Add(crisis);
        db.Add(new Crisis { Name = "Closed directory test", CountryCode = "NP", Active = false, PrimaryOrganisationId = partner });
        await db.SaveChangesAsync();
        var nepal = await Entry("NP");
        Assert.True(nepal.GetProperty("enabled").GetBoolean());
        Assert.Equal(crisis.Id, Assert.Single(nepal.GetProperty("primaryCrises").EnumerateArray()).GetProperty("id").GetGuid());
        Assert.Empty((await Entry("LK")).GetProperty("primaryCrises").EnumerateArray());
    }
}
