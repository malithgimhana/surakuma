using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class CrisisOperationsTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task DashboardReadsAlertHistoryAndOnlyAllowsWritesInItsCountry()
    {
        using var admin = await fixture.Login("admin");
        using var anonymous = fixture.Client();
        using var coordinator = await fixture.Login("coordinator");
        (await admin.PostAsJsonAsync("/api/v1/admin/users", new
        {
            email = "alert-reviewer@surakuma.test", name = "India alert reviewer", password = fixture.Password,
            role = Roles.CountryAdministrator, countryCode = "IN",
        })).EnsureSuccessStatusCode();
        using var reviewer = await fixture.Login("alert-reviewer");
        var created = await admin.PostAsJsonAsync("/api/v1/crises?countryCode=IN", new
        {
            countryCode = "IN", name = "Isolated India response", district = "Assam",
        });
        created.EnsureSuccessStatusCode();
        var crisis = (await created.Content.ReadFromJsonAsync<Crisis>())!;
        var country = "countryCode=IN";
        var otherCountry = "countryCode=NP";
        var crisisPath = $"/api/v1/crises/{crisis.Id}";
        const string history = "/api/v1/admin/crisis-operations/alerts";
        var snapshot = $"/api/v1/admin/crisis-operations/crises/{crisis.Id}/snapshot";
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.GetAsync($"{history}?{country}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"{history}?{country}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"{snapshot}?{otherCountry}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PutAsJsonAsync($"{crisisPath}/centre?{otherCountry}", new { organisationId = (Guid?)null })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PutAsJsonAsync($"{crisisPath}/response-status?{otherCountry}", new { active = false })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync($"{crisisPath}/areas?{otherCountry}")).StatusCode);

        var areas = await admin.PostAsJsonAsync($"{crisisPath}/areas?{country}", new
        {
            name = "Assam response area",
            geoJson = """{"type":"Polygon","coordinates":[[[92,26],[93,26],[93,27],[92,26]]]}""",
        });
        areas.EnsureSuccessStatusCode();
        var area = (await areas.Content.ReadFromJsonAsync<OperationalArea>())!;
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.DeleteAsync($"{crisisPath}/areas/{area.Id}?{otherCountry}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"{crisisPath}/areas/{area.Id}?{country}")).StatusCode);

        var alert = new PublicAlert
        {
            CrisisId = crisis.Id, Title = "Synthetic safety notice", Message = "Test only", Severity = "Advisory",
            Area = "Assam", Authority = "Isolated QA", ExpiresAt = DateTimeOffset.UtcNow.AddHours(2), Published = true,
        };
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/v1/alerts?{country}", alert)).StatusCode);
        alert.Published = false;
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsJsonAsync($"/api/v1/alerts?{otherCountry}", alert)).StatusCode);
        var drafted = await admin.PostAsJsonAsync($"/api/v1/alerts?{country}", alert);
        drafted.EnsureSuccessStatusCode();
        var publishedAlert = (await drafted.Content.ReadFromJsonAsync<PublicAlert>())!;
        var workflow = $"/api/v1/alerts/{publishedAlert.Id}";
        Assert.DoesNotContain((await anonymous.GetFromJsonAsync<List<PublicAlert>>($"/api/v1/alerts?{country}"))!, row => row.Id == publishedAlert.Id);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync($"{workflow}/submit?{country}", null)).StatusCode);
        alert.TranslationsJson = """{"hi":{"title":"परीक्षण","message":"केवल परीक्षण"}}""";
        (await admin.PutAsJsonAsync($"{workflow}?{country}", alert)).EnsureSuccessStatusCode();
        (await admin.PostAsync($"{workflow}/submit?{country}", null)).EnsureSuccessStatusCode();
        var approval = new { reason = "Confirmed source, affected area and translations." };
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsJsonAsync($"{workflow}/approve?{country}", approval)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.PostAsJsonAsync($"{workflow}/approve?{country}", approval)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync($"{workflow}/publish?{country}", null)).StatusCode);
        (await reviewer.PostAsJsonAsync($"{workflow}/approve?{country}", approval)).EnsureSuccessStatusCode();
        Assert.DoesNotContain((await anonymous.GetFromJsonAsync<List<PublicAlert>>($"/api/v1/alerts?{country}"))!, row => row.Id == publishedAlert.Id);
        (await admin.PostAsync($"{workflow}/publish?{country}", null)).EnsureSuccessStatusCode();
        (await admin.PostAsync($"{workflow}/publish?{country}", null)).EnsureSuccessStatusCode();
        Assert.Contains((await anonymous.GetFromJsonAsync<List<PublicAlert>>($"/api/v1/alerts?{country}"))!, row => row.Id == publishedAlert.Id);
        Assert.DoesNotContain((await anonymous.GetFromJsonAsync<List<PublicAlert>>($"/api/v1/alerts?{otherCountry}"))!, row => row.Id == publishedAlert.Id);

        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            db.AddRange(
                new PublicAlert { CrisisId = crisis.Id, Title = "Historic alert", Published = true, ExpiresAt = DateTimeOffset.UtcNow.AddHours(-1) },
                new PublicAlert { CrisisId = crisis.Id, Title = "Private draft", Published = false });
            await db.SaveChangesAsync();
        }
        var filtered = await admin.GetFromJsonAsync<JsonElement>($"{history}?{country}&status=All&search=Synthetic&severity=Advisory&crisisId={crisis.Id}");
        Assert.Equal(1, filtered.GetProperty("publishedCount").GetInt32());
        Assert.Equal("Published", Assert.Single(filtered.GetProperty("items").EnumerateArray()).GetProperty("status").GetString());
        var withdraw = $"/api/v1/alerts/{publishedAlert.Id}/unpublish";
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsync($"{withdraw}?{otherCountry}", null)).StatusCode);
        (await admin.PostAsJsonAsync($"{withdraw}?{country}", new { reason = "The source issued updated guidance." })).EnsureSuccessStatusCode();
        var all = await admin.GetFromJsonAsync<JsonElement>($"{history}?{country}&status=All&pageSize=3");
        Assert.Equal(0, all.GetProperty("publishedCount").GetInt32());
        Assert.Equal(new[] { "Draft", "Expired", "Withdrawn" }, all.GetProperty("items").EnumerateArray()
            .Select(row => row.GetProperty("status").GetString()).OrderBy(s => s));

        var responseStatus = $"{crisisPath}/response-status?{country}";
        (await admin.PutAsJsonAsync(responseStatus, new { active = false })).EnsureSuccessStatusCode();
        (await admin.PutAsJsonAsync(responseStatus, new { active = true })).EnsureSuccessStatusCode();
        var restored = (await admin.GetFromJsonAsync<List<Crisis>>($"/api/v1/crises?{country}"))!.Single(x => x.Id == crisis.Id);
        Assert.True(restored.Active);
        Assert.Equal("Isolated India response", restored.Name);

        alert.Severity = "Critical";
        var urgentDraft = await admin.PostAsJsonAsync($"/api/v1/alerts?{country}", alert);
        urgentDraft.EnsureSuccessStatusCode();
        var urgent = (await urgentDraft.Content.ReadFromJsonAsync<PublicAlert>())!;
        var emergency = $"/api/v1/alerts/{urgent.Id}";
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync($"{emergency}/emergency-publish?{country}", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.PostAsJsonAsync($"{emergency}/emergency-publish?{country}", approval)).StatusCode);
        (await admin.PostAsJsonAsync($"{emergency}/emergency-publish?{country}", new { reason = "Immediate evacuation instructions require release." })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsJsonAsync($"{emergency}/post-review?{country}", approval)).StatusCode);
        (await reviewer.PostAsJsonAsync($"{emergency}/post-review?{country}", approval)).EnsureSuccessStatusCode();
        var audit = await admin.GetFromJsonAsync<JsonElement>($"{emergency}/history?{country}");
        Assert.Contains(audit.EnumerateArray(), a => a.GetProperty("action").GetString() == "PublicAlertEmergencyPublished");
        Assert.Contains(audit.EnumerateArray(), a => a.GetProperty("action").GetString() == "PublicAlertEmergencyReviewed");
    }

    [Fact]
    public async Task SnapshotCountsShelterStaysForTheSelectedCrisis()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var shelter = await db.Set<Shelter>().FirstAsync(x => x.CountryCode == "LK" && x.Open);
        var original = await db.Set<AssistanceRequest>().FirstAsync();
        var crisis = new Crisis { CountryCode = "LK", Name = "Snapshot response" };
        var other = new Crisis { CountryCode = "LK", Name = "Other response" };
        var checkedIn = new AssistanceRequest { CitizenId = original.CitizenId, CrisisId = crisis.Id, SubmissionKey = Guid.NewGuid().ToString() };
        var reserved = new AssistanceRequest { CitizenId = original.CitizenId, CrisisId = crisis.Id, SubmissionKey = Guid.NewGuid().ToString() };
        var unrelated = new AssistanceRequest { CitizenId = original.CitizenId, CrisisId = other.Id, SubmissionKey = Guid.NewGuid().ToString() };
        db.AddRange(crisis, other, checkedIn, reserved, unrelated,
            new ShelterAllocation { ShelterId = shelter.Id, RequestId = checkedIn.Id, Status = StayStatus.CheckedIn, People = 3, ApprovedBy = original.CitizenId },
            new ShelterAllocation { ShelterId = shelter.Id, RequestId = reserved.Id, Status = StayStatus.Reserved, People = 6, ApprovedBy = original.CitizenId },
            new ShelterAllocation { ShelterId = shelter.Id, RequestId = unrelated.Id, Status = StayStatus.CheckedIn, People = 14, ApprovedBy = original.CitizenId });
        await db.SaveChangesAsync();
        using var admin = await fixture.Login("admin");
        var snapshot = await admin.GetFromJsonAsync<JsonElement>($"/api/v1/admin/crisis-operations/crises/{crisis.Id}/snapshot?countryCode=LK");
        Assert.Equal(1, snapshot.GetProperty("activeShelters").GetInt32());
        Assert.Equal(3, snapshot.GetProperty("shelteredPeople").GetInt32());
    }
}
