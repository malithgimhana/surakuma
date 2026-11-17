using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class AdminOverviewTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task ReadinessAndCaseQueuesFollowCountryScopeAndOverviewReadsDoNotChangeRecords()
    {
        using var admin = await fixture.Login("admin");
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var citizen = await db.Users.SingleAsync(user => user.Email == "citizen@surakuma.test");
        var organisation = new Organisation { Name = "Overview test partner" };
        var expired = new AdminProposal { Kind = "GlobalAccess", ExpiresAt = DateTimeOffset.UtcNow.AddHours(-1) };
        db.AddRange(organisation, expired, new AdminProposal { Kind = "GlobalAccess" });
        var countries = new[] { "LK", "NP", "IN" };
        var crises = countries.Select(code => new Crisis { CountryCode = code, Name = code + " overview response" }).ToArray();
        db.AddRange(crises);
        for (var i = 0; i < countries.Length; i++)
        {
            var country = countries[i];
            db.Add(new OrganisationCountry { OrganisationId = organisation.Id, CountryCode = country, VerificationState = i == 1 ? "Pending" : "Verified" });
            db.Add(new Resource { OrganisationId = organisation.Id, CountryCode = country, Name = "Water", Unit = "litres",
                Stock = i == 2 ? 0 : 10, Reserved = i == 2 ? 0 : 4, LowStockThreshold = i == 0 ? 6 : 7 });
            db.Add(new Shelter { OrganisationId = organisation.Id, CountryCode = country, Name = "Overview shelter",
                Open = true, Capacity = 90 + 10 * i, Occupancy = 25, Reserved = 10 });
            db.Add(new Shelter { OrganisationId = organisation.Id, CountryCode = country, Name = "Closed shelter", Open = false, Capacity = 700 });
            foreach (var (status, hours) in new[] { (RequestStatus.Approved, 25), (RequestStatus.Submitted, 1), (RequestStatus.Closed, 30) })
                db.Add(new AssistanceRequest { CrisisId = crises[i].Id, CitizenId = citizen.Id, Status = status,
                    SubmissionKey = Guid.NewGuid().ToString(), CreatedAt = DateTimeOffset.UtcNow.AddHours(-hours) });
        }
        db.AddRange(
            new AdminAlert { ConditionKey = "service:example", Message = "Global provider issue" },
            new AdminAlert { ConditionKey = "unassigned:in", CountryCode = "IN", Message = "India assignment issue" },
            new AdminAlert { ConditionKey = "unassigned:np", CountryCode = "NP", Message = "Nepal assignment issue" },
            new AdminAlert { ConditionKey = "delivery:np", CountryCode = "NP", Message = "Nepal private delivery issue" });
        await db.SaveChangesAsync();
        var outboxCount = await db.Set<OutboxMessage>().CountAsync();
        var auditCount = await db.Set<AuditEvent>().CountAsync();

        for (var i = 0; i < countries.Length; i++)
        {
            var code = countries[i];
            var dashboard = await admin.GetFromJsonAsync<JsonElement>($"/api/v1/admin/overview?countryCode={code}");
            Assert.Equal(code, dashboard.GetProperty("countryCode").GetString());
            Assert.Equal(1, dashboard.GetProperty("systemAccess").GetProperty("count").GetInt32());
            Assert.Equal(i == 1 ? 1 : 0, dashboard.GetProperty("partnerVerification").GetProperty("count").GetInt32());
            Assert.Equal(i == 0 ? 0 : 1, dashboard.GetProperty("stock").GetProperty("belowThreshold").GetInt32());
            Assert.Equal(i == 2 ? 1 : 0, dashboard.GetProperty("stock").GetProperty("outOfStock").GetInt32());
            // Sri Lanka also has the fixture's seeded shelters.
            if (i > 0)
            {
                var shelter = dashboard.GetProperty("shelters");
                Assert.Equal(1, shelter.GetProperty("openShelters").GetInt32());
                Assert.Equal(90 + 10 * i, shelter.GetProperty("capacity").GetInt32());
                Assert.Equal(25, shelter.GetProperty("occupancy").GetInt32());
                Assert.Equal(10, shelter.GetProperty("reserved").GetInt32());
                Assert.Equal(55 + 10 * i, shelter.GetProperty("available").GetInt32());
            }
            var report = await admin.GetFromJsonAsync<JsonElement>($"/api/v1/admin/reports?scope=country&countryCode={code}&crisisId={crises[i].Id}");
            var totals = report.GetProperty("totals");
            Assert.Equal(1, totals.GetProperty("activeCrises").GetInt32());
            Assert.Equal(1, totals.GetProperty("resolved").GetInt32());
            foreach (var (view, count) in new[] { ("open", 2), ("overdue", 1) })
            {
                var cases = await admin.GetFromJsonAsync<JsonElement>($"/api/v1/requests?view={view}&countryCode={code}&crisisId={crises[i].Id}");
                Assert.Equal(count, cases.GetProperty("total").GetInt32());
                Assert.Equal(totals.GetProperty(view).GetInt32(), cases.GetProperty("total").GetInt32());
            }
        }
        await db.Entry(expired).ReloadAsync();
        Assert.Equal("Pending", expired.State);
        Assert.Equal(outboxCount, await db.Set<OutboxMessage>().CountAsync());
        Assert.Equal(auditCount, await db.Set<AuditEvent>().CountAsync());
        var globalAlerts = await admin.GetFromJsonAsync<JsonElement>("/api/v1/admin/alerts?countryCode=NP&includeGlobal=true&activeOnly=true");
        Assert.Equal(3, globalAlerts.GetArrayLength());

        using var grant = await admin.PostAsJsonAsync("/api/v1/admin/users", new
        {
            email = "overview-national@surakuma.test", name = "Nepal administrator", password = fixture.Password,
            role = Roles.CountryAdministrator, countryCode = "NP",
        });
        grant.EnsureSuccessStatusCode();
        using var national = await fixture.Login("overview-national");
        Assert.Equal(HttpStatusCode.Forbidden, (await national.GetAsync("/api/v1/admin/overview?countryCode=IN")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await national.GetAsync("/api/v1/admin/alerts?countryCode=IN&includeGlobal=true")).StatusCode);
        var nationalOverview = await national.GetFromJsonAsync<JsonElement>("/api/v1/admin/overview?countryCode=NP");
        Assert.Equal(JsonValueKind.Null, nationalOverview.GetProperty("systemAccess").ValueKind);
        var comparison = await national.GetFromJsonAsync<JsonElement>("/api/v1/admin/reports?scope=all");
        Assert.Equal("NP", Assert.Single(comparison.GetProperty("countries").EnumerateArray()).GetProperty("countryCode").GetString());
        var nationalAlerts = await national.GetFromJsonAsync<JsonElement>("/api/v1/admin/alerts?countryCode=NP&includeGlobal=true");
        Assert.Equal("unassigned:np", Assert.Single(nationalAlerts.EnumerateArray()).GetProperty("conditionKey").GetString());
        var unauthorizedCases = await national.GetFromJsonAsync<JsonElement>($"/api/v1/requests?view=overdue&countryCode=IN&crisisId={crises[2].Id}");
        Assert.Empty(unauthorizedCases.GetProperty("items").EnumerateArray());
    }
}
