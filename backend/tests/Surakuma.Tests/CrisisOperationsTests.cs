using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Surakuma.Application;
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
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync($"{workflow}/image?{country}")).StatusCode);

        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            Assert.Equal(1, await db.Set<PublicAlertVisual>().CountAsync(x => x.AlertId == publishedAlert.Id));
            var visualProvider = new AlertVisualProvider();
            await using var visualServices = new ServiceCollection()
                .AddDbContext<CrisisDbContext>(options => options.UseSqlServer(db.Database.GetConnectionString()))
                .AddSingleton<IAiProvider>(visualProvider).BuildServiceProvider();
            var worker = new PublicAlertVisualWorker(visualServices.GetRequiredService<IServiceScopeFactory>(),
                NullLogger<PublicAlertVisualWorker>.Instance);
            Assert.True(await worker.ProcessNext(default));
            Assert.False(await worker.ProcessNext(default));
            Assert.Equal(("storm", "Assam", "India"), visualProvider.ImageLocation);
            visualProvider.Description = "The Assam notice describes an exercise.";
            await db.Set<PublicAlertVisual>().Where(x => x.AlertId == publishedAlert.Id).ExecuteUpdateAsync(change => change
                .SetProperty(x => x.Completed, false).SetProperty(x => x.DescriptionOnly, true)
                .SetProperty(x => x.AvailableAt, DateTimeOffset.UtcNow));
            Assert.True(await worker.ProcessNext(default));
            Assert.Equal(1, visualProvider.ImageCalls);
            db.AddRange(
                new PublicAlert { CrisisId = crisis.Id, Title = "Historic alert", Published = true, ExpiresAt = DateTimeOffset.UtcNow.AddHours(-1) },
                new PublicAlert { CrisisId = crisis.Id, Title = "Private draft", Published = false });
            await db.SaveChangesAsync();
        }
        var publicVisual = Assert.Single((await anonymous.GetFromJsonAsync<List<PublicAlert>>($"/api/v1/alerts?{country}"))!,
            row => row.Id == publishedAlert.Id);
        Assert.Equal("Test only", publicVisual.VisualSummary);
        Assert.Equal("The Assam notice describes an exercise.", publicVisual.PopupDescription);
        Assert.Equal("Test only", publicVisual.Message);
        Assert.Null(publicVisual.VisualImageUrl);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync($"{workflow}/image?{country}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"{workflow}/image-review?{country}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.GetAsync($"{workflow}/image-review?{country}")).StatusCode);
        Assert.Equal(AlertVisualProvider.Image, await reviewer.GetByteArrayAsync($"{workflow}/image-review?{country}"));
        Assert.Equal(HttpStatusCode.BadRequest, (await reviewer.PutAsJsonAsync($"{workflow}/image-review?{country}", new { imageReviewed = false })).StatusCode);
        var approvedImage = await reviewer.PutAsJsonAsync($"{workflow}/image-review?{country}", new { imageReviewed = true });
        approvedImage.EnsureSuccessStatusCode();
        var approvedImageUrl = (await approvedImage.Content.ReadFromJsonAsync<PublicAlert>())!.VisualImageUrl;
        Assert.Equal($"{workflow}/image?{country}", approvedImageUrl);
        using var image = await anonymous.GetAsync(approvedImageUrl);
        Assert.Equal("image/webp", image.Content.Headers.ContentType?.MediaType);
        Assert.Equal(AlertVisualProvider.Image, await image.Content.ReadAsByteArrayAsync());
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync($"{workflow}/image?{otherCountry}")).StatusCode);
        var filtered = await admin.GetFromJsonAsync<JsonElement>($"{history}?{country}&status=All&search=Synthetic&severity=Advisory&crisisId={crisis.Id}");
        Assert.Equal(1, filtered.GetProperty("publishedCount").GetInt32());
        Assert.Equal("Published", Assert.Single(filtered.GetProperty("items").EnumerateArray()).GetProperty("status").GetString());
        var withdraw = $"/api/v1/alerts/{publishedAlert.Id}/unpublish";
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsync($"{withdraw}?{otherCountry}", null)).StatusCode);
        (await admin.PostAsJsonAsync($"{withdraw}?{country}", new { reason = "The source issued updated guidance." })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync(approvedImageUrl)).StatusCode);
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
        var emergencyReason = new { reason = "Immediate evacuation instructions require release.", translationsReviewed = false };
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"{emergency}/emergency-publish?{country}", emergencyReason)).StatusCode);
        (await admin.PostAsJsonAsync($"{emergency}/emergency-publish?{country}", emergencyReason with { translationsReviewed = true })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsJsonAsync($"{emergency}/post-review?{country}", approval)).StatusCode);
        (await reviewer.PostAsJsonAsync($"{emergency}/post-review?{country}", approval)).EnsureSuccessStatusCode();
        var audit = await admin.GetFromJsonAsync<JsonElement>($"{emergency}/history?{country}");
        Assert.Contains(audit.EnumerateArray(), a => a.GetProperty("action").GetString() == "PublicAlertEmergencyPublished");
        Assert.Contains(audit.EnumerateArray(), a => a.GetProperty("action").GetString() == "PublicAlertEmergencyReviewed");
    }

    private sealed class AlertVisualProvider : IAiProvider
    {
        public static readonly byte[] Image = "RIFFfakeWEBP"u8.ToArray();
        public (string Kind, string? Locality, string Country) ImageLocation { get; private set; }
        public string? Description { get; set; }
        public int ImageCalls { get; private set; }
        public Task<AiResult> RecommendAsync(AssistanceRequest request, CancellationToken ct) => throw new NotSupportedException();
        public Task<AlertPresentation?> DescribePublicAlertAsync(string title, string message, string area, CancellationToken ct) =>
            Task.FromResult<AlertPresentation?>(new("storm", message, Description: Description));
        public Task<byte[]?> IllustratePublicAlertAsync(string kind, string? locality, string country, CancellationToken ct)
        {
            ImageLocation = (kind, locality, country);
            ImageCalls++;
            return Task.FromResult<byte[]?>(Image);
        }
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
