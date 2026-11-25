using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class ProfileIntegrationTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    private const string Profile = "/api/v1/auth/profile";

    [Fact]
    public async Task LogisticsContactPatchPreservesIdentityAndGrantsAndValidatesChangedFields()
    {
        using var logistics = await fixture.Login("logistics");
        using var citizen = await fixture.Login("citizen");
        var before = await logistics.GetFromJsonAsync<JsonElement>("/api/v1/auth/me");
        var path = Profile + "/contact";
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.PatchAsJsonAsync(path, new { workPhone = "+94 77 555 0100" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PatchAsJsonAsync(path, new { workPhone = "invalid" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PatchAsJsonAsync(path, new { name = "  " })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PatchAsJsonAsync(path, new { language = "xx" })).StatusCode);
        (await logistics.PatchAsJsonAsync(path, new
        {
            workPhone = "+94 77 555 0100", email = "forged@surakuma.test", role = Roles.Administrator, countryCode = "NP"
        })).EnsureSuccessStatusCode();
        var after = await logistics.GetFromJsonAsync<JsonElement>("/api/v1/auth/me");
        foreach (var key in new[] { "email", "name", "language", "memberships", "roles" })
            Assert.True(JsonElement.DeepEquals(before.GetProperty(key), after.GetProperty(key)));
        var details = await logistics.GetFromJsonAsync<JsonElement>(Profile);
        Assert.Equal("+94 77 555 0100", details.GetProperty("workPhone").GetString());
        Assert.Contains(details.GetProperty("assignments").EnumerateArray(), a => a.GetProperty("role").GetString() == Roles.Logistics);
        (await logistics.PatchAsJsonAsync(path, new { workPhone = "" })).EnsureSuccessStatusCode();
        Assert.Equal(JsonValueKind.Null, (await logistics.GetFromJsonAsync<JsonElement>(Profile)).GetProperty("workPhone").ValueKind);
    }

    [Fact]
    public async Task SystemAdminCanSaveWorkContactButCannotWriteHouseholdDetails()
    {
        using var admin = await fixture.Login("admin");
        var details = await admin.GetFromJsonAsync<JsonElement>(Profile);
        Assert.Empty(details.GetProperty("assignments").EnumerateArray());
        var account = await admin.GetFromJsonAsync<JsonElement>("/api/v1/auth/me");
        Assert.Contains(account.GetProperty("roles").EnumerateArray(), role => role.GetString() == Roles.Administrator);
        Assert.Equal(JsonValueKind.Null, details.GetProperty("volunteer").ValueKind);

        var invalid = await admin.PutAsJsonAsync(Profile, new { name = "System Administrator", language = "en", householdSize = 2 });
        Assert.Equal(HttpStatusCode.Forbidden, invalid.StatusCode);
        (await admin.PutAsJsonAsync(Profile, new { name = "System Administrator", language = "ne", workPhone = "+94 11 555 0100" })).EnsureSuccessStatusCode();
        details = await admin.GetFromJsonAsync<JsonElement>(Profile);
        Assert.Equal("+94 11 555 0100", details.GetProperty("workPhone").GetString());
        (await admin.PutAsJsonAsync(Profile, new { name = "System Administrator", language = "ne", workPhone = "" })).EnsureSuccessStatusCode();
        details = await admin.GetFromJsonAsync<JsonElement>(Profile);
        Assert.Equal(JsonValueKind.Null, details.GetProperty("workPhone").ValueKind);

        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var id = await db.Users.Where(u => u.Email == "admin@surakuma.test").Select(u => u.Id).SingleAsync();
        Assert.False(await db.Set<Household>().AnyAsync(h => h.UserId == id));
    }

    [Fact]
    public async Task VolunteerCanUpdateTheirAvailabilityWhileRecordedSkillsRemainVerified()
    {
        using var volunteer = await fixture.Login("volunteer");
        var before = (await volunteer.GetFromJsonAsync<JsonElement>(Profile)).GetProperty("volunteer");
        Assert.True(before.GetProperty("verified").GetBoolean());
        (await volunteer.PutAsJsonAsync(Profile, new
        {
            name = "Asha Raman",
            language = "en",
            volunteerAvailability = new { schedule = "", available = false, skills = "unreviewed skill", verified = false }
        })).EnsureSuccessStatusCode();
        var after = (await volunteer.GetFromJsonAsync<JsonElement>(Profile)).GetProperty("volunteer");
        Assert.True(after.GetProperty("verified").GetBoolean());
        Assert.Equal(before.GetProperty("skills").GetString(), after.GetProperty("skills").GetString());
        Assert.Equal("", after.GetProperty("schedule").GetString());
        Assert.False(after.GetProperty("available").GetBoolean());
    }

    [Fact]
    public async Task VolunteerCanEditOwnSkillsAndServicePointWithoutChangingIdentityOrAccess()
    {
        using var volunteer = await fixture.Login("volunteer");
        using var citizen = await fixture.Login("citizen");
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var region = await db.Set<AdministrativeDivision>().Where(r => r.CountryCode == "LK").OrderBy(r => r.Id).FirstAsync();
        var otherRegion = await db.Set<AdministrativeDivision>().Where(r => r.CountryCode != "LK").OrderBy(r => r.Id).FirstAsync();
        var account = await volunteer.GetFromJsonAsync<JsonElement>("/api/v1/auth/me");
        var details = await volunteer.GetFromJsonAsync<JsonElement>(Profile);
        var initial = details.GetProperty("volunteer");
        var name = account.GetProperty("name").GetString();
        var language = account.GetProperty("language").GetString();
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.PutAsJsonAsync(Profile, new { name, language, volunteerSkills = "Logistics" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await volunteer.PutAsJsonAsync(Profile,
            new { name, language, volunteerSkills = new string('x', 1001) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await volunteer.PutAsJsonAsync(Profile, new
        {
            name, language, volunteerAvailability = new { schedule = "", available = true, serviceArea = new { regionId = otherRegion.Id } }
        })).StatusCode);

        try
        {
            (await volunteer.PutAsJsonAsync(Profile, new
            {
                name, language = "ta", workPhone = "+94 77 555 0100", volunteerSkills = "First aid, Tamil",
                volunteerAvailability = new { schedule = "Weekends", available = true,
                    serviceArea = new { regionId = region.Id, consent = true, latitude = 0, longitude = 80.4 } },
                verified = false, role = Roles.Administrator, countryCode = "NP", email = "different@example.test"
            })).EnsureSuccessStatusCode();
            (await volunteer.PutAsJsonAsync(Profile, new { name, language = "ta", workPhone = "" })).EnsureSuccessStatusCode();
            var after = await volunteer.GetFromJsonAsync<JsonElement>(Profile);
            var updated = after.GetProperty("volunteer");
            Assert.Equal("First aid, Tamil", updated.GetProperty("skills").GetString());
            Assert.Equal("Weekends", updated.GetProperty("schedule").GetString());
            Assert.Equal(region.Id, updated.GetProperty("serviceRegionId").GetGuid());
            Assert.True(updated.GetProperty("serviceLocationConsent").GetBoolean());
            Assert.Equal(0, updated.GetProperty("serviceLatitude").GetDouble());
            Assert.Equal(80.4, updated.GetProperty("serviceLongitude").GetDouble());
            Assert.Equal(JsonValueKind.Null, after.GetProperty("workPhone").ValueKind);
            foreach (var key in new[] { "verified", "organisation", "countryCode" })
                Assert.True(JsonElement.DeepEquals(initial.GetProperty(key), updated.GetProperty(key)));
            var identity = await volunteer.GetFromJsonAsync<JsonElement>("/api/v1/auth/me");
            foreach (var key in new[] { "email", "memberships", "roles" })
                Assert.True(JsonElement.DeepEquals(account.GetProperty(key), identity.GetProperty(key)));
            Assert.Equal("ta", identity.GetProperty("language").GetString());

            (await volunteer.PutAsJsonAsync(Profile, new
            {
                name, language, volunteerAvailability = new { schedule = "Weekends", available = true, serviceArea = new { consent = false } }
            })).EnsureSuccessStatusCode();
            updated = (await volunteer.GetFromJsonAsync<JsonElement>(Profile)).GetProperty("volunteer");
            Assert.Null(updated.GetProperty("serviceRegionId").GetString());
            Assert.False(updated.GetProperty("serviceLocationConsent").GetBoolean());
            Assert.Equal(JsonValueKind.Null, updated.GetProperty("serviceLongitude").ValueKind);
        }
        finally
        {
            (await volunteer.PutAsJsonAsync(Profile, new
            {
                name, language, workPhone = details.GetProperty("workPhone").GetString() ?? "",
                volunteerSkills = initial.GetProperty("skills").GetString(),
                volunteerAvailability = new
                {
                    schedule = initial.GetProperty("schedule"), available = initial.GetProperty("available"),
                    serviceArea = new { regionId = initial.GetProperty("serviceRegionId"), consent = initial.GetProperty("serviceLocationConsent"),
                        latitude = initial.GetProperty("serviceLatitude"), longitude = initial.GetProperty("serviceLongitude") }
                }
            })).EnsureSuccessStatusCode();
        }
    }

    [Fact]
    public async Task MixedRolesCanUpdateTheirHouseholdAndTheirOwnCaseManagerGrant()
    {
        Guid ownGrant, otherGrant;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var citizen = await db.Users.SingleAsync(u => u.Email == "citizen@surakuma.test");
            var existing = await db.Set<Membership>().SingleAsync(m => m.Role == Roles.CaseManager);
            var grant = new Membership { UserId = citizen.Id, OrganisationId = existing.OrganisationId, CountryCode = existing.CountryCode, Role = Roles.CaseManager, AvailableForAssignment = true };
            db.Add(grant);
            await db.SaveChangesAsync();
            ownGrant = grant.Id;
            otherGrant = existing.Id;
        }

        using var citizenStaff = await fixture.Login("citizen");
        var details = await citizenStaff.GetFromJsonAsync<JsonElement>(Profile);
        Assert.Equal(ownGrant, Assert.Single(details.GetProperty("assignments").EnumerateArray()).GetProperty("id").GetGuid());
        var denied = await citizenStaff.PutAsJsonAsync(Profile, new
        {
            name = "Amara Silva", language = "en", householdSize = 3,
            caseManagerAvailability = new Dictionary<Guid, bool> { [ownGrant] = false, [otherGrant] = false }
        });
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        var account = await citizenStaff.GetFromJsonAsync<JsonElement>("/api/v1/auth/me");
        Assert.Equal(4, account.GetProperty("householdSize").GetInt32());
        details = await citizenStaff.GetFromJsonAsync<JsonElement>(Profile);
        Assert.True(Assert.Single(details.GetProperty("assignments").EnumerateArray()).GetProperty("availableForAssignment").GetBoolean());

        (await citizenStaff.PutAsJsonAsync(Profile, new
        {
            name = "Amara Silva", language = "en", householdSize = 3, accessibilityNeeds = "Step-free access",
            caseManagerAvailability = new Dictionary<Guid, bool> { [ownGrant] = false }
        })).EnsureSuccessStatusCode();
        account = await citizenStaff.GetFromJsonAsync<JsonElement>("/api/v1/auth/me");
        Assert.Equal(3, account.GetProperty("householdSize").GetInt32());
        Assert.Equal("Step-free access", account.GetProperty("accessibilityNeeds").GetString());
        details = await citizenStaff.GetFromJsonAsync<JsonElement>(Profile);
        Assert.False(Assert.Single(details.GetProperty("assignments").EnumerateArray()).GetProperty("availableForAssignment").GetBoolean());
    }
}
