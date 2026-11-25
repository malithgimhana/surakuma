using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class ServiceAccessFeatureTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task CategoryHelpOffersAlternativesAndRecordsTheCitizensFinalChoice()
    {
        using var citizen = await fixture.Login("citizen");
        using var manager = await fixture.Login("case");
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var crisisId = await db.Set<AssistanceRequest>().Where(r => r.SubmissionKey == "seed-food").Select(r => r.CrisisId).SingleAsync();
        var draftKey = Guid.NewGuid().ToString("N");
        async Task<JsonElement> Ask(string description)
        {
            using var response = await citizen.PostAsJsonAsync("/api/v1/requests/category-suggestion",
                new { description, countryCode = "LK", draftKey });
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadFromJsonAsync<JsonElement>();
        }
        var mixed = await Ask("I need food and a temporary place to stay.");
        Assert.Equal(JsonValueKind.Null, mixed.GetProperty("recommendation").ValueKind);
        Assert.Equal(2, mixed.GetProperty("options").GetArrayLength());
        var unclear = await Ask("Something changed yesterday.");
        Assert.Empty(unclear.GetProperty("options").EnumerateArray());

        var advice = await Ask("I ran out of food.");
        Assert.Equal("Rules", advice.GetProperty("source").GetString());
        Assert.Equal("FoodWater", advice.GetProperty("recommendation").GetString());
        var receipt = advice.GetProperty("receipt").GetString();
        async Task<string> Submit(string key)
        {
            using var response = await citizen.PostAsJsonAsync("/api/v1/requests", new
            {
                crisisId, category = "Medical", description = "Synthetic medication refill intake",
                locationText = "Synthetic location", householdSize = 1, accessibilityNeeds = "", quantity = 1,
                submissionKey = key, categoryReceipt = receipt, intake = new { need = "MedicineRefill", timing = "Later", danger = "Yes" }
            });
            response.EnsureSuccessStatusCode();
            var saved = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal("Medical", saved.GetProperty("category").GetString());
            Assert.Equal("Critical", saved.GetProperty("priority").GetString());
            return saved.GetProperty("id").GetString()!;
        }
        var id = await Submit(draftKey);
        var caseDetail = await manager.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{id}");
        var note = Assert.Single(caseDetail.GetProperty("history").EnumerateArray()).GetProperty("note").GetString();
        Assert.Contains("suggested food and water. Citizen chose medicine and medical support", note);
        var replay = await Submit(Guid.NewGuid().ToString("N"));
        Assert.DoesNotContain("category guidance", await manager.GetStringAsync($"/api/v1/requests/{replay}"));
    }

    [Fact]
    public async Task PublishedCentresAreCountryScopedAndCitizenGuidanceUsesTheMedicineForm()
    {
        using var admin = await fixture.Login("admin");
        using var citizen = await fixture.Login("citizen");
        using var publicClient = fixture.Client();
        const string management = "/api/v1/admin/assistance-centres?countryCode=LK";
        var options = await admin.GetFromJsonAsync<JsonElement>(management);
        var organisationId = options.GetProperty("organisations")[0].GetProperty("id").GetGuid();
        object Centre(bool published, string? version = null) => new { organisationId, name = "Synthetic assistance centre",
            address = "Synthetic address", latitude = 6.91, longitude = 79.88, services = "Medicine collection",
            facilities = "Accessible entrance", openingHours = "09:00–16:00", accessible = true, capacity = 20,
            published, version };
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.PostAsJsonAsync(management, Centre(true))).StatusCode);
        var creation = await admin.PostAsJsonAsync(management, Centre(false));
        creation.EnsureSuccessStatusCode();
        var saved = await creation.Content.ReadFromJsonAsync<JsonElement>();
        var id = saved.GetProperty("id").GetGuid();
        string Version(JsonElement value) => value.GetProperty("version").GetString()!;
        async Task<JsonElement[]> Public(string country) =>
            (await publicClient.GetFromJsonAsync<JsonElement[]>("/api/v1/public/assistance-centres?countryCode=" + country))!;
        bool Selected(JsonElement projector) => projector.GetProperty("id").GetGuid() == id;
        Assert.DoesNotContain(await Public("LK"), Selected);
        var updateUrl = $"/api/v1/admin/assistance-centres/{id}?countryCode=LK";
        var published = await admin.PutAsJsonAsync(updateUrl, Centre(true, Version(saved)));
        published.EnsureSuccessStatusCode();
        var listing = Assert.Single(await Public("LK"), Selected);
        Assert.Equal("Medicine collection", listing.GetProperty("services").GetString());
        Assert.False(listing.TryGetProperty("organisationId", out _));
        Assert.DoesNotContain(await Public("NP"), Selected);
        (await admin.PutAsJsonAsync(updateUrl, Centre(false, Version(await published.Content.ReadFromJsonAsync<JsonElement>()))))
            .EnsureSuccessStatusCode();
        Assert.DoesNotContain(await Public("LK"), Selected);

        var help = await citizen.PostAsJsonAsync("/api/v1/citizen/help", new { topic = "medicine", language = "si", country = "LK" });
        help.EnsureSuccessStatusCode();
        var guidance = await help.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("/app/requests/new?category=Medical", guidance.GetProperty("path").GetString());
        Assert.Contains("ඖෂධ", guidance.GetProperty("reference").GetString());
        Assert.Equal(JsonValueKind.Null, guidance.GetProperty("explanation").ValueKind);
    }

    [Fact]
    public async Task StructuredIntakeSupportsAuthorisedReviewAndPreservesCriticalPriority()
    {
        using var citizen = await fixture.Login("citizen");
        using var manager = await fixture.Login("case");
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var seed = await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(r => r.SubmissionKey == "seed-food");
        var response = await citizen.PostAsJsonAsync("/api/v1/requests", new { seed.CrisisId, category = "Medical",
            description = "Synthetic medication refill intake", locationText = "Synthetic location", householdSize = 1,
            accessibilityNeeds = "", quantity = 1, submissionKey = Guid.NewGuid().ToString("N"),
            intake = new { need = "MedicineRefill", timing = "Later", danger = "Yes" } });
        response.EnsureSuccessStatusCode();
        var id = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var request = await db.Set<AssistanceRequest>().SingleAsync(r => r.Id == id);
        request.AssessmentState = "Completed";
        var advice = new Recommendation { RequestId = id, Category = AidCategory.Medical,
            Priority = Priority.Critical, Explanation = "Original assessment", Provider = "OpenAI", Model = "fixture-model" };
        db.Add(advice);
        await db.SaveChangesAsync();

        var url = $"/api/v1/requests/{id}/decisions";
        object Update(string action) => new { recommendationId = advice.Id, action, finalPriority = "Low", reason = "Reviewed intake" };
        Assert.False((await citizen.PostAsJsonAsync(url, Update("Approve"))).IsSuccessStatusCode);
        (await manager.PostAsJsonAsync(url, Update("Defer"))).EnsureSuccessStatusCode();
        (await manager.PostAsJsonAsync(url, Update("Defer"))).EnsureSuccessStatusCode();
        (await manager.PostAsJsonAsync(url, Update("Modify"))).EnsureSuccessStatusCode();
        var detail = await manager.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{id}/recommendations");
        var decisions = detail.GetProperty("decisions").EnumerateArray().ToArray();
        Assert.Equal(2, decisions.Length);
        var modified = Assert.Single(decisions, d => d.GetProperty("action").GetString() == "Modify");
        Assert.Equal("Original assessment", modified.GetProperty("originalExplanation").GetString());
        Assert.Equal("Critical", modified.GetProperty("finalPriority").GetString());
        Assert.NotEqual("", modified.GetProperty("actorId").GetString());
        Assert.Null((await db.Set<AssistanceRequest>().AsNoTracking().SingleAsync(r => r.Id == id)).NextPriorityEscalationAt);
    }

    [Fact]
    public async Task VolunteersCanSaveAndRemoveTheirWindowsAndConflictsAreRejected()
    {
        using var volunteer = await fixture.Login("volunteer");
        using var citizen = await fixture.Login("citizen");
        using var coordinator = await fixture.Login("volunteers");
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var requestId = await db.Set<AssistanceRequest>().Where(r => r.SubmissionKey == "seed-shelter").Select(r => r.Id).SingleAsync();
        var volunteerId = await db.Set<VolunteerProfile>().Select(v => v.Id).SingleAsync();
        var url = "/api/v1/volunteers/me/availability";
        var start = DateTimeOffset.UtcNow.AddDays(2);
        var window = new { startsAt = start, endsAt = start.AddHours(3) };
        var first = await volunteer.PostAsJsonAsync(url, window);
        first.EnsureSuccessStatusCode();
        var id = (await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var retry = await volunteer.PostAsJsonAsync(url, window);
        retry.EnsureSuccessStatusCode();
        Assert.Equal(id, (await retry.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid());
        Assert.Equal(HttpStatusCode.BadRequest, (await volunteer.PostAsJsonAsync(url,
            new { startsAt = start.AddHours(1), endsAt = start.AddHours(4) })).StatusCode);
        var windows = await volunteer.GetFromJsonAsync<JsonElement[]>(url);
        Assert.Equal(id, Assert.Single(windows!).GetProperty("id").GetGuid());
        async Task<JsonElement[]> Candidates(DateTimeOffset from, DateTimeOffset until) =>
            (await coordinator.GetFromJsonAsync<JsonElement[]>($"/api/v1/volunteer-tasks/candidates?requestId={requestId}" +
                $"&startsAt={Uri.EscapeDataString(from.ToString("O"))}&dueAt={Uri.EscapeDataString(until.ToString("O"))}"))!;
        Assert.Equal(volunteerId, Assert.Single(await Candidates(start, start.AddHours(1))).GetProperty("id").GetGuid());
        Assert.Empty(await Candidates(start.AddHours(3), start.AddHours(4)));
        var outside = await coordinator.PostAsJsonAsync("/api/v1/volunteer-tasks", new
        {
            requestId, volunteerId, title = "Synthetic shelter support", startsAt = start.AddHours(3), dueAt = start.AddHours(4)
        });
        Assert.Equal(HttpStatusCode.BadRequest, outside.StatusCode);
        Assert.Contains("recorded availability", await outside.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.DeleteAsync($"{url}/{id}")).StatusCode);
        (await volunteer.DeleteAsync($"{url}/{id}")).EnsureSuccessStatusCode();
        Assert.Empty((await volunteer.GetFromJsonAsync<JsonElement[]>(url))!);
    }

    [Fact]
    public async Task PushWorkerEncryptsAndDeliversANewInboxEventOnce()
    {
        var services = fixture.Factory.Services;
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var dataProtection = services.GetRequiredService<IDataProtectionProvider>();
        var protector = BrowserPushSettings.Protector(dataProtection);
        var user = await db.Users.SingleAsync(u => u.NormalizedEmail == "CITIZEN@SURAKUMA.TEST");
        using var clientKeys = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        using var serverKeys = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        static string Public(ECParameters key) => WebEncoders.Base64UrlEncode([4, .. key.Q.X!, .. key.Q.Y!]);
        var server = serverKeys.ExportParameters(true);
        var settings = new BrowserPushSettings(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["BrowserPush:PublicKey"] = Public(server),
            ["BrowserPush:PrivateKey"] = WebEncoders.Base64UrlEncode(server.D!),
            ["BrowserPush:Subject"] = "mailto:test@surakuma.test"
        }).Build());
        Assert.True(settings.Enabled);
        var endpoint = "https://fcm.googleapis.com/fcm/send/synthetic-browser";
        var browser = new BrowserPushSubscription { UserId = user.Id, Endpoint = protector.Protect(endpoint),
            EndpointHash = BrowserPushSettings.Hash(endpoint), EnabledAt = DateTimeOffset.UtcNow,
            PublicKey = protector.Protect(Public(clientKeys.ExportParameters(false))),
            AuthSecret = protector.Protect(WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(16))) };
        var notice = new Notification { UserId = user.Id, EventId = Guid.NewGuid(), Message = "Synthetic inbox update" };
        db.AddRange(browser, notice);
        await db.SaveChangesAsync();

        var transport = new PushCapture(endpoint);
        var worker = new BrowserPushWorker(services.GetRequiredService<IServiceScopeFactory>(), settings, transport,
            dataProtection, NullLogger<BrowserPushWorker>.Instance);
        await worker.ProcessOne(default);
        await worker.ProcessOne(default);
        Assert.Equal(1, transport.Sends);
        Assert.Equal("Sent", await db.Set<BrowserPushDelivery>().Where(d => d.NotificationId == notice.Id).Select(d => d.State).SingleAsync());
    }

    private sealed class PushCapture(string endpoint) : IHttpClientFactory
    {
        private string Endpoint { get; } = endpoint;
        public int Sends { get; private set; }
        public HttpClient CreateClient(string name) => new(new Transport(this));

        private sealed class Transport(PushCapture capture) : HttpMessageHandler
        {
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            {
                Assert.Equal(capture.Endpoint, request.RequestUri!.AbsoluteUri);
                Assert.Contains("aes128gcm", request.Content!.Headers.ContentEncoding);
                Assert.Equal("vapid", request.Headers.Authorization?.Scheme, ignoreCase: true);
                capture.Sends++;
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Created));
            }
        }
    }
}
