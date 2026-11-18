using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class ShelterDashboardTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task DashboardScopesRecordsAndCountsPeopleSeparatelyFromHouseholds()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var org = await db.Set<Organisation>().FirstAsync();
        var citizenId = await db.Users.Where(u => u.Email == "citizen@surakuma.test").Select(u => u.Id).SingleAsync();
        var adminId = await db.Users.Where(u => u.Email == "admin@surakuma.test").Select(u => u.Id).SingleAsync();
        var crisis = new Crisis { CountryCode = "NP", Name = "Nepal flood", PrimaryOrganisationId = org.Id };
        var shelter = new Shelter { CountryCode = "NP", OrganisationId = org.Id, Name = "Hill shelter", Capacity = 10, Occupancy = 8, Reserved = 1 };
        var india = new Shelter { CountryCode = "IN", OrganisationId = org.Id, Name = "India shelter", Capacity = 10, Occupancy = 10 };
        var request = new AssistanceRequest { CitizenId = citizenId, CrisisId = crisis.Id, Category = AidCategory.Shelter, HouseholdSize = 8, SubmissionKey = "dashboard-check-in" };
        var reserved = new AssistanceRequest { CitizenId = citizenId, CrisisId = crisis.Id, Category = AidCategory.Shelter, HouseholdSize = 1, SubmissionKey = "dashboard-reserved" };
        var candidate = new AssistanceRequest { CitizenId = citizenId, CrisisId = crisis.Id, Category = AidCategory.Shelter, Status = RequestStatus.Approved, HouseholdSize = 1, SubmissionKey = "dashboard-candidate" };
        db.AddRange(crisis, shelter, india, request, reserved, candidate,
            new OrganisationCountry { CountryCode = "NP", OrganisationId = org.Id, VerificationState = "Verified" },
            new ShelterAllocation { ShelterId = shelter.Id, RequestId = request.Id, People = 8, Status = StayStatus.CheckedIn, ApprovedBy = adminId },
            new ShelterAllocation { ShelterId = shelter.Id, RequestId = reserved.Id, People = 1, Status = StayStatus.Reserved, ApprovedBy = adminId });
        await db.SaveChangesAsync();
        using var admin = await fixture.Login("admin");
        using var citizen = await fixture.Login("citizen");
        string List(string country) => $"/api/v1/staff/shelters?countryCode={country}&dashboard=true";
        string Detail(string country) => $"/api/v1/staff/shelters/{shelter.Id}?countryCode={country}";
        foreach (var country in new[] { "LK", "NP", "IN" })
        {
            var snapshot = await admin.GetFromJsonAsync<JsonElement>(List(country));
            Assert.All(snapshot.GetProperty("entries").EnumerateArray(), row =>
                Assert.Equal(country, row.GetProperty("shelter").GetProperty("countryCode").GetString()));
            if (country == "LK") continue;
            var row = Assert.Single(snapshot.GetProperty("entries").EnumerateArray());
            var warning = Assert.Single(row.GetProperty("warnings").EnumerateArray());
            Assert.Equal(country == "NP" ? "nearCapacity" : "full", warning.GetProperty("kind").GetString());
            var counts = snapshot.GetProperty("statistics");
            Assert.Equal(1, counts.GetProperty("attention").GetInt32());
            Assert.Equal(country == "NP" ? 1 : 0, counts.GetProperty("available").GetInt32());
            Assert.Equal(country == "NP" ? 8 : 10, counts.GetProperty("occupied").GetInt32());
            Assert.Equal(country == "NP" ? 1 : 0, counts.GetProperty("households").GetInt32());
        }
        var detail = await admin.GetFromJsonAsync<JsonElement>(Detail("NP"));
        Assert.Equal(2, detail.GetProperty("households").GetArrayLength());
        Assert.DoesNotContain("citizenId", detail.GetRawText());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync(Detail("IN"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.GetAsync(Detail("NP"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.GetAsync(List("NP"))).StatusCode);

        var candidates = await admin.GetFromJsonAsync<JsonElement>(Detail("NP") + "&allocation=true");
        Assert.Equal(candidate.Id, Assert.Single(candidates.EnumerateArray()).GetProperty("id").GetGuid());
        var shelterUser = await db.Users.SingleAsync(u => u.Email == "shelter@surakuma.test");
        var caseUser = await db.Users.SingleAsync(u => u.Email == "case@surakuma.test");
        var externalOrg = new Organisation { Name = "Separate shelter operator" };
        var externalShelter = new Shelter { CountryCode = "NP", OrganisationId = externalOrg.Id, Name = "Restricted shelter", Capacity = 5 };
        var externalRequest = new AssistanceRequest { CitizenId = citizenId, CrisisId = crisis.Id, OrganisationId = externalOrg.Id,
            Category = AidCategory.Shelter, Status = RequestStatus.Approved, SubmissionKey = "restricted-candidate" };
        candidate.OrganisationId = org.Id;
        db.AddRange(externalOrg, externalShelter, externalRequest,
            new Membership { UserId = shelterUser.Id, Role = Roles.ShelterAdmin, CountryCode = "NP", OrganisationId = org.Id },
            new Membership { UserId = caseUser.Id, Role = Roles.CaseManager, CountryCode = "NP", OrganisationId = org.Id });
        await db.SaveChangesAsync();
        (await admin.PostAsJsonAsync("/api/v1/admin/users", new
        {
            email = "shelter-authority@surakuma.test", name = "Nepal authority", password = fixture.Password,
            role = Roles.CountryAdministrator, countryCode = "NP",
        })).EnsureSuccessStatusCode();
        using var authority = await fixture.Login("shelter-authority");
        using var shelterStaff = await fixture.Login("shelter");
        using var caseStaff = await fixture.Login("case");
        Assert.Equal(2, (await authority.GetFromJsonAsync<JsonElement>(List("NP"))).GetProperty("entries").GetArrayLength());
        var specialist = await shelterStaff.GetFromJsonAsync<JsonElement>(List("NP"));
        Assert.Equal(shelter.Id, Assert.Single(specialist.GetProperty("entries").EnumerateArray()).GetProperty("shelter").GetProperty("id").GetGuid());
        Assert.Equal(HttpStatusCode.Forbidden, (await shelterStaff.GetAsync(Detail("IN"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await caseStaff.GetAsync(Detail("NP"))).StatusCode);
        var restrictedDetails = $"/api/v1/staff/shelters/{externalShelter.Id}?countryCode=NP";
        Assert.Equal(HttpStatusCode.NotFound, (await shelterStaff.GetAsync(restrictedDetails)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await shelterStaff.GetAsync(restrictedDetails + "&allocation=true")).StatusCode);
        var scopedCandidates = await shelterStaff.GetFromJsonAsync<JsonElement>(Detail("NP") + "&allocation=true");
        Assert.Equal(candidate.Id, Assert.Single(scopedCandidates.EnumerateArray()).GetProperty("id").GetGuid());
        var placement = await admin.PostAsJsonAsync("/api/v1/shelter-allocations?countryCode=NP", new { requestId = candidate.Id, shelterId = shelter.Id });
        placement.EnsureSuccessStatusCode();
        var stayId = (await placement.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var afterReservation = (await admin.GetFromJsonAsync<JsonElement>(List("NP"))).GetProperty("statistics");
        Assert.Equal(0, afterReservation.GetProperty("available").GetInt32());
        Assert.Equal(8, afterReservation.GetProperty("occupied").GetInt32());
        Assert.Equal(1, afterReservation.GetProperty("households").GetInt32());
        var arrival = await shelterStaff.PostAsync($"/api/v1/shelter-allocations/{stayId}/CheckIn?countryCode=NP", null);
        arrival.EnsureSuccessStatusCode();
        var afterArrival = (await admin.GetFromJsonAsync<JsonElement>(List("NP"))).GetProperty("statistics");
        Assert.Equal(0, afterArrival.GetProperty("available").GetInt32());
        Assert.Equal(9, afterArrival.GetProperty("occupied").GetInt32());
        Assert.Equal(2, afterArrival.GetProperty("households").GetInt32());
        var audit = (await admin.GetFromJsonAsync<JsonElement>(Detail("NP"))).GetProperty("activity");
        Assert.Contains(audit.EnumerateArray(), a => a.GetProperty("action").GetString() == "ShelterCheckIn");

        var newShelter = new { organisationId = org.Id, countryCode = "NP", name = "New Nepal shelter", address = "Kathmandu", capacity = 50, latitude = 27.7, longitude = 85.3, accessible = true, open = true, facilities = "Water" };
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsJsonAsync("/api/v1/shelters?countryCode=IN", newShelter)).StatusCode);
        var created = await admin.PostAsJsonAsync("/api/v1/shelters?countryCode=NP", newShelter);
        created.EnsureSuccessStatusCode();
        var createdId = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        (await admin.PutAsJsonAsync($"/api/v1/shelters/{createdId}?countryCode=NP", newShelter with { capacity = 60 })).EnsureSuccessStatusCode();
        var afterEdit = (await admin.GetFromJsonAsync<JsonElement>(List("NP"))).GetProperty("statistics");
        Assert.Equal(60, afterEdit.GetProperty("available").GetInt32());
    }
}
