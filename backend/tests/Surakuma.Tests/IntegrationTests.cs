using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

[assembly: CollectionBehavior(DisableTestParallelization = true)]
namespace Surakuma.Tests;

public sealed class ApiFixture : IAsyncLifetime
{
    public string DatabaseName { get; } = "Surakuma_Test_" + Guid.NewGuid().ToString("N");
    private string EvidenceDirectory => Path.Combine(Path.GetTempPath(), DatabaseName + "_evidence");
    public string Password { get; } = "Sk!" + Convert.ToHexString(RandomNumberGenerator.GetBytes(12)) + "a9";
    public WebApplicationFactory<Program> Factory { get; private set; } = null!;
    public async Task InitializeAsync()
    {
        string key = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));
        Environment.SetEnvironmentVariable("Jwt__Key", key);
        string server = Environment.GetEnvironmentVariable("SURAKUMA_TEST_SERVER") ?? ".\\SQLEXPRESS";
        Factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Testing").ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Default"] = $"Server={server};Database={DatabaseName};Trusted_Connection=True;TrustServerCertificate=True;Connect Timeout=10;Command Timeout=120",
            ["Jwt:Key"] = key,
            ["Seed:Password"] = Password,
            ["Email:Provider"] = "Capture",
            ["Ai:OpenAiApiKey"] = "",
            ["Mapping:ApiKey"] = "",
            ["Storage:EvidencePath"] = EvidenceDirectory,
            ["RateLimits:AuthPermitLimit"] = "1000",
            ["RateLimits:GlobalPermitLimit"] = "10000"
        })).ConfigureServices(services => { var worker = services.SingleOrDefault(d => d.ServiceType == typeof(IHostedService) && d.ImplementationType == typeof(NotificationWorker)); if (worker is not null) services.Remove(worker); }));
        using var scope = Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        await db.Database.MigrateAsync();
        await SeedData.Initialise(db, scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>(), scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>(), scope.ServiceProvider.GetRequiredService<IConfiguration>());
    }
    public HttpClient Client() => Factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
    public async Task<HttpClient> Login(string account)
    {
        var client = Client();
        var response = await client.PostAsJsonAsync("/api/v1/auth/login", new
        {
            email = account + "@surakuma.test",
            password = Password
        });
        response.EnsureSuccessStatusCode();
        var data = await response.Content.ReadFromJsonAsync<JsonElement>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", data.GetProperty("accessToken").GetString());
        return client;
    }
    public async Task<HttpClient> RegisterDonor(string name)
    {
        var client = Client();
        var response = await client.PostAsJsonAsync("/api/v1/auth/donor/register", new
        {
            email = Guid.NewGuid().ToString("N") + "@surakuma.test",
            password = Password,
            name
        });
        response.EnsureSuccessStatusCode();
        var data = await response.Content.ReadFromJsonAsync<JsonElement>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", data.GetProperty("accessToken").GetString());
        return client;
    }
    public async Task DisposeAsync()
    {
        var connection = "";
        using (var scope = Factory.Services.CreateScope())
            connection = scope.ServiceProvider.GetRequiredService<CrisisDbContext>().Database.GetConnectionString()!;
        await Factory.DisposeAsync();
        // Delete only this fixture's freshly created, randomly named test database.
        if (!DatabaseName.StartsWith("Surakuma_Test_", StringComparison.Ordinal) || DatabaseName.Length != 46)
            throw new InvalidOperationException("Unsafe test database name.");
        await using var db = new CrisisDbContext(new DbContextOptionsBuilder<CrisisDbContext>().UseSqlServer(connection).Options);
        await db.Database.EnsureDeletedAsync();
        if (Directory.Exists(EvidenceDirectory))
        {
            foreach (var evidence in Directory.EnumerateFiles(EvidenceDirectory)) File.Delete(evidence);
            Directory.Delete(EvidenceDirectory);
        }
    }
}
public sealed partial class IntegrationTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task DonorRegistrationCreatesOnlyDonorRoleAndKeepsCitizenSignInSeparate()
    {
        const string register = "/api/v1/auth/donor/register";
        const string login = "/api/v1/auth/donor/login";
        const string workspace = "/api/v1/funding/LK/workspace";
        var email = Guid.NewGuid().ToString("N") + "@surakuma.test";
        using var donor = fixture.Client();
        using var registration = await donor.PostAsJsonAsync(register, new
        {
            email, password = fixture.Password, name = "Synthetic donor", organisationName = "Community group", role = "Citizen"
        });
        registration.EnsureSuccessStatusCode();
        var session = await registration.Content.ReadFromJsonAsync<JsonElement>();
        var user = session.GetProperty("user");
        Assert.Equal(Roles.Donor, Assert.Single(user.GetProperty("roles").EnumerateArray()).GetString());
        var id = user.GetProperty("id").GetString();
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        Assert.False(await db.Set<Household>().AnyAsync(h => h.UserId == id));
        donor.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.GetProperty("accessToken").GetString());
        var profile = (await donor.GetFromJsonAsync<JsonElement>(workspace)).GetProperty("profile");
        Assert.Equal("Community group", profile.GetProperty("organisationName").GetString());
        Assert.Equal(HttpStatusCode.Forbidden, (await donor.PostAsJsonAsync("/api/v1/requests", new { })).StatusCode);

        using var returning = fixture.Client();
        using var signedIn = await returning.PostAsJsonAsync(login, new { email, password = fixture.Password });
        signedIn.EnsureSuccessStatusCode();
        var returned = (await signedIn.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("user");
        Assert.Equal(id, returned.GetProperty("id").GetString());
        Assert.Equal(Roles.Donor, Assert.Single(returned.GetProperty("roles").EnumerateArray()).GetString());
        Assert.Equal(HttpStatusCode.Unauthorized, (await returning.PostAsJsonAsync(login, new
        {
            email = "citizen@surakuma.test", password = fixture.Password
        })).StatusCode);
        using var citizen = await fixture.Login("citizen");
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.GetAsync(workspace)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.PutAsJsonAsync("/api/v1/funding/profile", new { displayName = "Citizen" })).StatusCode);
    }

    [Fact]
    public async Task ReverseGeocodingRequiresAuthenticationValidCoordinatesAndHandlesUnavailableProvider()
    {
        using var anonymous = fixture.Client();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/api/v1/maps/reverse-geocode", new { latitude = 6.9, longitude = 79.8 })).StatusCode);
        using var citizen = await fixture.Login("citizen");
        Assert.Equal(HttpStatusCode.BadRequest, (await citizen.PostAsJsonAsync("/api/v1/maps/reverse-geocode", new { latitude = 91, longitude = 79.8 })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await citizen.PostAsJsonAsync("/api/v1/maps/reverse-geocode", new { latitude = 6.9 })).StatusCode);
        var unavailable = await citizen.PostAsJsonAsync("/api/v1/maps/reverse-geocode", new { latitude = 6.9, longitude = 79.8 });
        Assert.Equal(HttpStatusCode.ServiceUnavailable, unavailable.StatusCode);
        Assert.True(unavailable.Headers.CacheControl?.NoStore);
    }
    [Fact]
    public async Task AnonymousAndCitizenCannotPerformStaffActions()
    {
        using var client = fixture.Client();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/requests")).StatusCode);
        using var citizen = await fixture.Login("citizen");
        var requests = await citizen.GetFromJsonAsync<JsonElement>("/api/v1/requests/mine");
        string id = requests.GetProperty("items")[0].GetProperty("id").GetString()!;
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.PatchAsJsonAsync($"/api/v1/requests/{id}/status", new
        {
            status = "UnderReview",
            reason = ""
        })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.GetAsync("/api/v1/admin/users")).StatusCode);
    }
    [Fact]
    public async Task RegistrationCannotGrantStaffAndRepeatedSubmissionKeepsOneCase()
    {
        using var client = fixture.Client();
        string email = Guid.NewGuid().ToString("N") + "@surakuma.test";
        var registration = await client.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email,
            password = fixture.Password,
            name = "Synthetic test citizen",
            language = "si",
            role = "Administrator"
        });
        registration.EnsureSuccessStatusCode();
        var auth = await registration.Content.ReadFromJsonAsync<JsonElement>();
        Assert.DoesNotContain("Administrator", auth.GetProperty("user").GetProperty("roles").ToString());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.GetProperty("accessToken").GetString());
        var lookups = await client.GetFromJsonAsync<JsonElement>("/api/v1/public/lookups");
        var input = new
        {
            crisisId = lookups.GetProperty("crises")[0].GetProperty("id").GetGuid(),
            organisationId = lookups.GetProperty("organisations")[1].GetProperty("id").GetGuid(),
            category = "FoodWater",
            priority = "High",
            description = "Synthetic test household requires drinking water.",
            locationText = "Demo collection point",
            latitude = 6.93,
            longitude = 79.88,
            householdSize = 4,
            accessibilityNeeds = "",
            quantity = 10,
            unit = "packs",
            submissionKey = Guid.NewGuid().ToString(),
            synthetic = true
        };
        var first = await client.PostAsJsonAsync("/api/v1/requests", input);
        first.EnsureSuccessStatusCode();
        var second = await client.PostAsJsonAsync("/api/v1/requests", input);
        second.EnsureSuccessStatusCode();
        var created = await first.Content.ReadFromJsonAsync<JsonElement>();
        var repeated = await second.Content.ReadFromJsonAsync<JsonElement>();
        var caseId = created.GetProperty("id").GetGuid();
        var reference = created.GetProperty("reference").GetString()!;
        Assert.Equal(caseId, repeated.GetProperty("id").GetGuid());
        Assert.Matches(@"^SK-[0-9]{4,}$", reference);
        Assert.Equal(reference, repeated.GetProperty("reference").GetString());
        const string legacyReference = "SK-12A4C67D89";
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var message = await db.Set<OutboxMessage>().SingleAsync(m => m.RequestId == caseId);
            Assert.StartsWith(reference + ": ", message.Message);
            var request = await db.Set<AssistanceRequest>().SingleAsync(r => r.Id == caseId);
            request.LegacyReference = legacyReference;
            await db.SaveChangesAsync();
        }
        var found = await client.GetFromJsonAsync<JsonElement>("/api/v1/requests/mine?search=" + legacyReference);
        Assert.Equal(reference, Assert.Single(found.GetProperty("items").EnumerateArray()).GetProperty("reference").GetString());
        using var other = await fixture.Login("citizen");
        var outside = await other.GetFromJsonAsync<JsonElement>("/api/v1/requests/mine?search=" + legacyReference);
        Assert.Empty(outside.GetProperty("items").EnumerateArray());
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync(first.Headers.Location)).StatusCode);
    }
    [Fact]
    public async Task AiFallbackAndOverrideAreAuditedWithoutChangingCaseApproval()
    {
        using var manager = await fixture.Login("case");
        var cases = await manager.GetFromJsonAsync<JsonElement>("/api/v1/requests?status=Submitted");
        string id = cases.GetProperty("items")[0].GetProperty("id").GetString()!;
        var generated = await manager.PostAsync($"/api/v1/requests/{id}/recommendations/generate", null);
        generated.EnsureSuccessStatusCode();
        var rec = await generated.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(rec.GetProperty("fallback").GetBoolean());
        Assert.Equal(JsonValueKind.Null, rec.GetProperty("confidence").ValueKind);
        var decision = await manager.PostAsJsonAsync($"/api/v1/requests/{id}/decisions", new
        {
            recommendationId = rec.GetProperty("id").GetGuid(),
            action = "Modify",
            finalPriority = "High",
            finalCategory = "Medical",
            reason = "Verified household needs by staff."
        });
        decision.EnsureSuccessStatusCode();
        var detail = await manager.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{id}");
        Assert.Equal("Submitted", detail.GetProperty("request").GetProperty("status").GetString());
        var history = await manager.GetFromJsonAsync<JsonElement>($"/api/v1/requests/{id}/recommendations");
        Assert.Contains(history.GetProperty("decisions").EnumerateArray(), d => d.GetProperty("action").GetString() == "Modify");
    }
    [Fact]
    public async Task RegeneratingAiReplacesDraftsAndKeepsDecisionHistory()
    {
        using var manager = await fixture.Login("case");
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var seed = await db.Set<AssistanceRequest>().SingleAsync(x => x.SubmissionKey == "seed-food");
        var request = new AssistanceRequest
        {
            CitizenId = seed.CitizenId, OrganisationId = seed.OrganisationId, CrisisId = seed.CrisisId,
            Category = seed.Category, Quantity = seed.Quantity, Unit = seed.Unit, Synthetic = true,
            Status = RequestStatus.UnderReview, SubmissionKey = Guid.NewGuid().ToString("N")
        };
        var olderDraft = new Recommendation { RequestId = request.Id, CreatedAt = DateTimeOffset.UtcNow.AddDays(-1) };
        var current = new Recommendation { RequestId = request.Id };
        db.AddRange(request, olderDraft, current);
        await db.SaveChangesAsync();

        string path = $"/api/v1/requests/{request.Id}";
        async Task<JsonElement> Detail() => await manager.GetFromJsonAsync<JsonElement>($"{path}/recommendations");
        async Task<Guid> Generate()
        {
            using var response = await manager.PostAsync($"{path}/recommendations/generate", null);
            response.EnsureSuccessStatusCode();
            return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        }
        Guid CurrentId(JsonElement detail) => Assert.Single(detail.GetProperty("recommendations").EnumerateArray()).GetProperty("id").GetGuid();

        Assert.Equal(current.Id, CurrentId(await Detail()));
        using var defer = await manager.PostAsJsonAsync($"{path}/decisions", new { recommendationId = current.Id, action = "Defer", reason = "Awaiting verification." });
        defer.EnsureSuccessStatusCode();
        Guid replaced = await Generate();
        Assert.Equal(replaced, CurrentId(await Detail()));
        Guid latest = await Generate();
        Assert.NotEqual(replaced, latest);
        var detail = await Detail();
        Assert.Equal(latest, CurrentId(detail));
        Assert.Equal(current.Id, Assert.Single(detail.GetProperty("decisions").EnumerateArray()).GetProperty("recommendationId").GetGuid());

        foreach (var stale in new[] { olderDraft.Id, current.Id, replaced })
        {
            using var decision = await manager.PostAsJsonAsync($"{path}/decisions", new { recommendationId = stale, action = "Approve", reason = "" });
            Assert.Equal(HttpStatusCode.NotFound, decision.StatusCode);
        }

        string queuePath = $"/api/v1/requests?view=pending-ai&search={request.Reference}";
        Assert.Single((await manager.GetFromJsonAsync<JsonElement>(queuePath)).GetProperty("items").EnumerateArray());
        using var reject = await manager.PostAsJsonAsync($"{path}/decisions", new { recommendationId = latest, action = "Reject", reason = "Staff assessment complete." });
        reject.EnsureSuccessStatusCode();
        Assert.Empty((await manager.GetFromJsonAsync<JsonElement>(queuePath)).GetProperty("items").EnumerateArray());

        var stored = await db.Set<Recommendation>().AsNoTracking().Where(x => x.RequestId == request.Id).Select(x => x.Id).ToListAsync();
        Assert.Equal(2, stored.Count);
        Assert.Contains(current.Id, stored);
        Assert.Contains(latest, stored);
    }
    [Fact]
    public async Task SqlTransactionsPreventConcurrentStockOverAllocation()
    {
        Guid requestId, resourceId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var seed = await db.Set<AssistanceRequest>().SingleAsync(x => x.SubmissionKey == "seed-food");
            var request = new AssistanceRequest { CrisisId = seed.CrisisId, CitizenId = seed.CitizenId,
                OrganisationId = seed.OrganisationId, Category = AidCategory.FoodWater, Status = RequestStatus.Approved,
                Quantity = 10, Unit = "packs", SubmissionKey = "concurrent-" + Guid.NewGuid().ToString("N") };
            requestId = request.Id;
            var resource = new Resource { OrganisationId = request.OrganisationId ?? throw new InvalidOperationException("Test request must have an organisation."),
                Name = "Concurrent allocation test", Category = AidCategory.FoodWater, Stock = 6, Unit = "packs" };
            db.AddRange(request, resource);
            await db.SaveChangesAsync();
            resourceId = resource.Id;
        }
        using var first = await fixture.Login("logistics");
        using var second = await fixture.Login("logistics");
        var responses = await Task.WhenAll(first.PostAsJsonAsync("/api/v1/allocations", new
        {
            requestId,
            resourceId,
            quantity = 4
        }), second.PostAsJsonAsync("/api/v1/allocations", new
        {
            requestId,
            resourceId,
            quantity = 4
        }));
        Assert.Single(responses, r => r.IsSuccessStatusCode);
        Assert.All(responses.Where(r => !r.IsSuccessStatusCode), r => Assert.Contains(r.StatusCode, new[] { HttpStatusCode.BadRequest, HttpStatusCode.Conflict }));
        using var check = fixture.Factory.Services.CreateScope();
        var dbCheck = check.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var stock = await dbCheck.Set<Resource>().FindAsync(resourceId);
        Assert.Equal(4, stock!.Reserved);
        Assert.Equal(6, stock.Stock);
    }
    [Fact]
    public async Task PublicSheltersDoNotExposeCitizenRequestsOrPreciseLocations()
    {
        using var client = fixture.Client();
        string shelters = await client.GetStringAsync("/api/v1/shelters");
        Assert.DoesNotContain("citizenId", shelters);
        Assert.DoesNotContain("placements", shelters);
        Assert.DoesNotContain("organisationId", shelters);
        Assert.DoesNotContain("version", shelters);
        Assert.DoesNotContain("createdAt", shelters);
        var lookups = await client.GetStringAsync("/api/v1/public/lookups");
        Assert.DoesNotContain("version", lookups);
        Assert.DoesNotContain("createdAt", lookups);
        Assert.DoesNotContain("latitude", lookups);
    }
}
