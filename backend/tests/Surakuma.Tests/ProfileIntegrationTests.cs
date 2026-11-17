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
