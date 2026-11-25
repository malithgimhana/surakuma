using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class ShelterRegistrationTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task RegistrationIsScopedAndIdempotentAndRequiresSeparateVerification()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var membership = await (from member in db.Set<Membership>()
            join user in db.Users on member.UserId equals user.Id
            where user.Email == "shelter@surakuma.test" && member.Role == Roles.ShelterAdmin && member.CountryCode == "LK"
            select member).SingleAsync();
        var division = await db.Set<AdministrativeDivision>().FirstAsync(r => r.CountryCode == "LK");
        var otherOperator = await db.Set<Organisation>().FirstAsync(o => o.Id != membership.OrganisationId);
        var citizen = await db.Users.FirstAsync(u => u.Email == "citizen@surakuma.test");
        var crisis = await db.Set<Crisis>().FirstAsync(c => c.CountryCode == "LK");
        var approved = new AssistanceRequest
        {
            CitizenId = citizen.Id, OrganisationId = membership.OrganisationId, CrisisId = crisis.Id,
            Category = AidCategory.Shelter, Status = RequestStatus.Approved, HouseholdSize = 4,
            SubmissionKey = "shelter-registration-placement",
        };
        db.Add(approved);
        await db.SaveChangesAsync();

        using var staff = await fixture.Login("shelter");
        using var coordinator = await fixture.Login("coordinator");
        const string scopeQuery = "?countryCode=LK&staffRole=ShelterAdmin";
        const string dashboard = "/api/v1/staff/shelters" + scopeQuery + "&dashboard=true";
        var input = new
        {
            registrationId = Guid.NewGuid(), organisationId = membership.OrganisationId, countryCode = "LK",
            administrativeDivisionId = (Guid?)division.Id, name = "Registration test shelter", address = "11 Test Lane",
            latitude = 6.9, longitude = 79.8, capacity = 6, accessible = true, open = true,
            facilities = "Drinking water, Toilets, Accessible entrance, Generator",
        };
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.PostAsJsonAsync("/api/v1/shelters?countryCode=LK", input)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.GetAsync("/api/v1/staff/shelters?dashboard=true&countryCode=NP&staffRole=ShelterAdmin")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await staff.PostAsJsonAsync("/api/v1/shelters" + scopeQuery, input with
        {
            organisationId = otherOperator.Id,
        })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.PostAsJsonAsync("/api/v1/shelters" + scopeQuery, input with
        {
            administrativeDivisionId = null,
        })).StatusCode);

        var created = await Read(await staff.PostAsJsonAsync("/api/v1/shelters" + scopeQuery, input));
        var retry = await Read(await staff.PostAsJsonAsync("/api/v1/shelters" + scopeQuery, input));
        Assert.Equal(input.registrationId, created.GetProperty("id").GetGuid());
        Assert.Equal(created.GetProperty("id").GetGuid(), retry.GetProperty("id").GetGuid());
        Assert.False(created.GetProperty("open").GetBoolean());
        Assert.True(created.GetProperty("pendingVerification").GetBoolean());
        Assert.Equal(1, await db.Set<AuditEvent>().CountAsync(a => a.EntityId == input.registrationId && a.Action == "ShelterCreated"));

        var detail = $"/api/v1/staff/shelters/{input.registrationId}" + scopeQuery;
        var mutation = $"/api/v1/shelters/{input.registrationId}" + scopeQuery;
        var placement = new { requestId = approved.Id, shelterId = input.registrationId };
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.GetAsync(detail + "&allocation=true")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.PostAsJsonAsync("/api/v1/shelter-allocations" + scopeQuery, placement)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.PutAsJsonAsync(mutation, input with { registrationId = Guid.Empty })).StatusCode);
        var entries = (await staff.GetFromJsonAsync<JsonElement>(dashboard)).GetProperty("entries");
        var entry = entries.EnumerateArray().Single(row => row.GetProperty("shelter").GetProperty("id").GetGuid() == input.registrationId);
        Assert.Equal(6, entry.GetProperty("reportedAvailable").GetInt32());
        Assert.False(entry.GetProperty("eligible").GetBoolean());

        var edit = new
        {
            input.organisationId, input.countryCode, input.administrativeDivisionId, input.name, input.address,
            input.latitude, input.longitude, input.capacity, input.accessible, input.open, input.facilities, verifyOperations = true,
            expectedOperationalUpdate = created.GetProperty("operationalUpdatedAt").GetDateTimeOffset(),
        };
        var verified = await Read(await staff.PutAsJsonAsync(mutation, edit));
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.PutAsJsonAsync(
            $"/api/v1/shelters/{input.registrationId}?countryCode=LK", edit with { capacity = 7 })).StatusCode);
        Assert.True(verified.GetProperty("open").GetBoolean());
        Assert.False(verified.GetProperty("pendingVerification").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.PutAsJsonAsync(mutation, edit with { capacity = 7 })).StatusCode);
        Assert.Contains((await staff.GetFromJsonAsync<JsonElement>(detail + "&allocation=true")).EnumerateArray(),
            row => row.GetProperty("id").GetGuid() == approved.Id);

        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.PostAsJsonAsync("/api/v1/shelter-allocations?countryCode=LK", placement)).StatusCode);
        var stay = await Read(await staff.PostAsJsonAsync("/api/v1/shelter-allocations" + scopeQuery, placement));
        var oversight = await coordinator.GetFromJsonAsync<JsonElement>($"/api/v1/staff/shelters/{input.registrationId}?countryCode=LK");
        Assert.Equal("Reserved", Assert.Single(oversight.GetProperty("households").EnumerateArray()).GetProperty("status").GetString());
        var current = edit with { expectedOperationalUpdate = verified.GetProperty("operationalUpdatedAt").GetDateTimeOffset() };
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.PutAsJsonAsync(mutation, current with { capacity = 3 })).StatusCode);
        var closed = await Read(await staff.PutAsJsonAsync(mutation, current with { open = false }));
        var checkIn = $"/api/v1/shelter-allocations/{stay.GetProperty("id").GetGuid()}/CheckIn" + scopeQuery;
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.PostAsync(checkIn.Replace(scopeQuery, "?countryCode=LK"), null)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.PostAsync(checkIn, null)).StatusCode);
        (await staff.PutAsJsonAsync(mutation, current with
        {
            expectedOperationalUpdate = closed.GetProperty("operationalUpdatedAt").GetDateTimeOffset(),
        })).EnsureSuccessStatusCode();
        (await staff.PostAsync(checkIn, null)).EnsureSuccessStatusCode();
        var stayPath = $"/api/v1/shelter-allocations/{stay.GetProperty("id").GetGuid()}/Depart" + scopeQuery;
        (await staff.PostAsync(stayPath, null)).EnsureSuccessStatusCode();
        var persisted = (await staff.GetFromJsonAsync<JsonElement>(detail)).GetProperty("shelter");
        Assert.Equal(0, persisted.GetProperty("occupancy").GetInt32());
        Assert.Equal(0, persisted.GetProperty("reserved").GetInt32());
    }

    private static async Task<JsonElement> Read(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }
}
