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
    public string Password { get; } = "Sk!" + Convert.ToHexString(RandomNumberGenerator.GetBytes(12)) + "a9";
    public WebApplicationFactory<Program> Factory { get; private set; } = null!;
    public async Task InitializeAsync()
    {
        string key = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));
        Environment.SetEnvironmentVariable("Jwt__Key", key);
        string server = Environment.GetEnvironmentVariable("SURAKUMA_TEST_SERVER") ?? ".\\SQLEXPRESS";
        Factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Testing").ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Default"] = $"Server={server};Database={DatabaseName};Trusted_Connection=True;TrustServerCertificate=True;Connect Timeout=10",
            ["Jwt:Key"] = key,
            ["Seed:Password"] = Password,
            ["Email:Provider"] = "Capture",
            ["Ai:ApiKey"] = "",
            ["Mapping:ApiKey"] = "",
            ["RateLimits:AuthPermitLimit"] = "1000"
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
    }
}
public sealed partial class IntegrationTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
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
            submissionKey = Guid.NewGuid().ToString(),
            synthetic = true
        };
        var first = await client.PostAsJsonAsync("/api/v1/requests", input);
        first.EnsureSuccessStatusCode();
        var second = await client.PostAsJsonAsync("/api/v1/requests", input);
        second.EnsureSuccessStatusCode();
        Assert.Equal((await first.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid(), (await second.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid());
        using var other = await fixture.Login("citizen");
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
    public async Task SqlTransactionsPreventConcurrentStockOverAllocation()
    {
        Guid requestId, resourceId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var request = await db.Set<AssistanceRequest>().FirstAsync(x => x.Category == AidCategory.FoodWater && x.Status == RequestStatus.Approved);
            requestId = request.Id;
            var resource = new Resource { OrganisationId = request.OrganisationId, Name = "Concurrent allocation test", Category = AidCategory.FoodWater, Stock = 6 };
            db.Add(resource);
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
