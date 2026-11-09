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
    public async Task VolunteerRosterProvidesNamesForScopedProfiles()
    {
        using var coordinator = await fixture.Login("volunteers");
        var roster = await coordinator.GetFromJsonAsync<JsonElement>("/api/v1/volunteers");
        var profile = roster.GetProperty("profiles").EnumerateArray().First();
        var userId = profile.GetProperty("userId").GetString()!;
        Assert.False(string.IsNullOrWhiteSpace(roster.GetProperty("names").GetProperty(userId).GetString()));
    }

    [Fact]
    public async Task UnassignedSubmissionCanBeReviewedAndAssignedByCoordinatorOnly()
    {
        using var citizen = await fixture.Login("citizen");
        var lookups = await citizen.GetFromJsonAsync<JsonElement>("/api/v1/public/lookups");
        Guid crisis;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var coordinatorId = await db.Users.Where(x => x.UserName == "coordinator@surakuma.test").Select(x => x.Id).SingleAsync();
            var unmapped = new Crisis { Name = "Unmapped test crisis" };
            db.Add(unmapped);
            db.Add(new CrisisAssignment { CrisisId = unmapped.Id, UserId = coordinatorId });
            await db.SaveChangesAsync();
            crisis = unmapped.Id;
        }
        var organisation = lookups.GetProperty("organisations")[0].GetProperty("id").GetGuid();
        var response = await citizen.PostAsJsonAsync("/api/v1/requests", new {
            crisisId = crisis, organisationId = (Guid?)null, category = "FoodWater", priority = "Normal",
            description = "A household needs drinking water.", locationText = "Test collection point",
            latitude = (double?)null, longitude = (double?)null, householdSize = 2, accessibilityNeeds = "",
            quantity = 1, submissionKey = Guid.NewGuid().ToString(), synthetic = true,
            requestedForSomeoneElse = true, requesterRelationship = "Neighbour", requesterContact = "Test contact"
        });
        response.EnsureSuccessStatusCode();
        var created = await response.Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetGuid();
        Assert.Equal(JsonValueKind.Null, created.GetProperty("organisationId").ValueKind);
        Assert.Equal("Unassigned", created.GetProperty("assignmentStatus").GetString());
        Assert.Equal("Neighbour", created.GetProperty("requesterRelationship").GetString());
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.GetAsync("/api/v1/requests/triage")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.PostAsJsonAsync($"/api/v1/requests/{id}/reassign", new { organisationId = organisation })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.PutAsJsonAsync($"/api/v1/crises/{crisis}/centre", new { organisationId = organisation })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.PostAsJsonAsync($"/api/v1/requests/{id}/case-manager", new { userId = "other" })).StatusCode);
        using var admin = await fixture.Login("admin");
        var adminQueue = await admin.GetFromJsonAsync<JsonElement>("/api/v1/requests/triage");
        Assert.Contains(adminQueue.EnumerateArray(), item => item.GetProperty("id").GetGuid() == id);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync($"/api/v1/requests/{id}")).StatusCode);
        Guid assignedId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var manager = await db.Set<Membership>().FirstAsync(x => x.Role == Roles.CaseManager);
            var seed = await db.Set<AssistanceRequest>().FirstAsync(x => x.SubmissionKey == "seed-food");
            var assignedCase = new AssistanceRequest { CitizenId = seed.CitizenId, CrisisId = seed.CrisisId, OrganisationId = manager.OrganisationId, AssignedCaseManagerId = manager.UserId, Description = "Synthetic assigned case", LocationText = "Synthetic location", SubmissionKey = Guid.NewGuid().ToString() };
            db.Add(assignedCase); await db.SaveChangesAsync(); assignedId = assignedCase.Id;
        }
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/api/v1/requests/{assignedId}")).StatusCode);
        using var coordinator = await fixture.Login("coordinator");
        var queue = await coordinator.GetFromJsonAsync<JsonElement>("/api/v1/requests/triage");
        Assert.Contains(queue.EnumerateArray(), x => x.GetProperty("id").GetGuid() == id);
        var assigned = await coordinator.PostAsJsonAsync($"/api/v1/requests/{id}/reassign", new { organisationId = organisation });
        assigned.EnsureSuccessStatusCode();
        Assert.Equal("Reassigned", (await assigned.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("assignmentStatus").GetString());
    }
    [Fact]
    public async Task ConcurrentCitizensCanSubmitAndConcurrentRetryDoesNotDuplicate()
    {
        using var anonymous = fixture.Client();
        var lookups = await anonymous.GetFromJsonAsync<JsonElement>("/api/v1/public/lookups");
        Guid crisis = lookups.GetProperty("crises")[0].GetProperty("id").GetGuid();
        var clients = new List<HttpClient>();
        try
        {
            for (int i = 0; i < 5; i++)
            {
                var client = fixture.Client(); clients.Add(client);
                var registration = await client.PostAsJsonAsync("/api/v1/auth/register", new { email = Guid.NewGuid() + "@surakuma.test", password = fixture.Password, name = "Synthetic concurrent citizen", language = "en" });
                registration.EnsureSuccessStatusCode();
                var auth = await registration.Content.ReadFromJsonAsync<JsonElement>();
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.GetProperty("accessToken").GetString());
            }
            object Input(string key) => new { crisisId = crisis, organisationId = (Guid?)null, category = "FoodWater", priority = "Normal", description = "Synthetic concurrent request for assistance.", locationText = "Synthetic location", latitude = (double?)null, longitude = (double?)null, householdSize = 1, accessibilityNeeds = "", quantity = 1, submissionKey = key, synthetic = true };
            var responses = await Task.WhenAll(clients.Select(client => client.PostAsJsonAsync("/api/v1/requests", Input(Guid.NewGuid().ToString()))));
            Assert.All(responses, response => Assert.Equal(HttpStatusCode.Created, response.StatusCode));
            var key = Guid.NewGuid().ToString();
            var retries = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => clients[0].PostAsJsonAsync("/api/v1/requests", Input(key))));
            Assert.All(retries, response => Assert.Equal(HttpStatusCode.Created, response.StatusCode));
            var results = await Task.WhenAll(retries.Select(response => response.Content.ReadFromJsonAsync<JsonElement>()));
            Assert.Single(results.Select(result => result.GetProperty("id").GetGuid()).Distinct());
        }
        finally { foreach (var client in clients) client.Dispose(); }
    }
    [Fact]
    public async Task CrisisRoutingAssignsCentreAndAvailableManager()
    {
        Guid crisis, centre; string manager;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var membership = await db.Set<Membership>().FirstAsync(x => x.Role == Roles.CaseManager);
            membership.AvailableForAssignment = true;
            centre = membership.OrganisationId; manager = membership.UserId;
            var eventRecord = new Crisis { Name = "Routing test crisis", PrimaryOrganisationId = centre };
            db.Add(eventRecord); await db.SaveChangesAsync(); crisis = eventRecord.Id;
        }
        using var citizen = await fixture.Login("citizen");
        var result = await citizen.PostAsJsonAsync("/api/v1/requests", new {
            crisisId = crisis, organisationId = (Guid?)null, category = "FoodWater", priority = "Normal",
            description = "A household needs drinking water.", locationText = "Test collection point", latitude = (double?)null,
            longitude = (double?)null, householdSize = 2, accessibilityNeeds = "", quantity = 1,
            submissionKey = Guid.NewGuid().ToString(), synthetic = true
        });
        result.EnsureSuccessStatusCode();
        var request = await result.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(centre, request.GetProperty("organisationId").GetGuid());
        Assert.Equal(manager, request.GetProperty("assignedCaseManagerId").GetString());
        Assert.Equal("AutoAssigned", request.GetProperty("assignmentStatus").GetString());
    }
    [Fact]
    public async Task RoutingUsesLeastLoadedAvailableManagerAndKeepsFallbackAtCentre()
    {
        Guid crisis, centre; string availableId, unavailableId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var organisation = new Organisation { Name = "Isolated routing centre" }; db.Add(organisation); centre = organisation.Id;
            var first = new AppUser { UserName = Guid.NewGuid() + "@example.test", Email = Guid.NewGuid() + "@example.test" };
            var second = new AppUser { UserName = Guid.NewGuid() + "@example.test", Email = Guid.NewGuid() + "@example.test" };
            Assert.True((await users.CreateAsync(first, fixture.Password)).Succeeded);
            Assert.True((await users.CreateAsync(second, fixture.Password)).Succeeded);
            availableId = first.Id; unavailableId = second.Id;
            db.AddRange(new Membership { UserId = first.Id, OrganisationId = centre, Role = Roles.CaseManager, AvailableForAssignment = true },
                new Membership { UserId = second.Id, OrganisationId = centre, Role = Roles.CaseManager, AvailableForAssignment = false });
            var c = new Crisis { Name = "Isolated workload test", PrimaryOrganisationId = centre }; db.Add(c); crisis = c.Id;
            await db.SaveChangesAsync();
        }
        using var citizen = await fixture.Login("citizen");
        object Input() => new { crisisId = crisis, organisationId = (Guid?)null, category = "FoodWater", priority = "Normal", description = "A household needs drinking water.", locationText = "Test collection point", latitude = (double?)null, longitude = (double?)null, householdSize = 2, accessibilityNeeds = "", quantity = 1, submissionKey = Guid.NewGuid().ToString(), synthetic = true };
        var firstResult = await citizen.PostAsJsonAsync("/api/v1/requests", Input()); firstResult.EnsureSuccessStatusCode();
        Assert.Equal(availableId, (await firstResult.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("assignedCaseManagerId").GetString());
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var managers = await db.Set<Membership>().Where(x => x.OrganisationId == centre).ToListAsync();
            managers.Single(x => x.UserId == unavailableId).AvailableForAssignment = true;
            await db.SaveChangesAsync();
        }
        var secondResult = await citizen.PostAsJsonAsync("/api/v1/requests", Input()); secondResult.EnsureSuccessStatusCode();
        Assert.Equal(unavailableId, (await secondResult.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("assignedCaseManagerId").GetString());
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            foreach (var m in await db.Set<Membership>().Where(x => x.OrganisationId == centre).ToListAsync()) m.AvailableForAssignment = false;
            await db.SaveChangesAsync();
        }
        var fallback = await citizen.PostAsJsonAsync("/api/v1/requests", Input()); fallback.EnsureSuccessStatusCode();
        var request = await fallback.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(centre, request.GetProperty("organisationId").GetGuid());
        Assert.Equal(JsonValueKind.Null, request.GetProperty("assignedCaseManagerId").ValueKind);
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
            var resource = new Resource { OrganisationId = request.OrganisationId!.Value, Name = "Concurrent allocation test", Category = AidCategory.FoodWater, Stock = 6 };
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
