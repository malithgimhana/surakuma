using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class PhaseOneWorkspaceTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task PartnersSeeExplicitSharesAndOnlyTheirOrganisationsCommitments()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var clientId = await db.Users.Where(u => u.Email == "citizen@surakuma.test").Select(u => u.Id).SingleAsync();
        var org = await db.Set<Organisation>().SingleAsync(o => o.Name == "Surakuma Community Response (demo)");
        var other = new Organisation { Name = "Other response organisation" };
        db.AddRange(other, new OrganisationCountry { OrganisationId = other.Id, CountryCode = "LK", VerificationState = "Verified" },
            new OrganisationCountry { OrganisationId = other.Id, CountryCode = "NP", VerificationState = "Verified" });
        var crisis = await db.Set<Crisis>().FirstAsync(c => c.CountryCode == "LK");
        var work = new AssistanceRequest { CrisisId = crisis.Id, OrganisationId = org.Id, CitizenId = clientId,
            Status = RequestStatus.Approved, SubmissionKey = "partner-share", Description = "Sensitive citizen details" };
        db.Add(work);
        await db.SaveChangesAsync();
        using var admin = await fixture.Login("admin");
        foreach (var (name, organisation, country) in new[] { ("partner-one", org.Id, "LK"), ("partner-two", other.Id, "LK"), ("partner-nepal", other.Id, "NP") })
        {
            (await admin.PostAsJsonAsync("/api/v1/admin/users", new
            {
                email = name + "@surakuma.test", name, password = fixture.Password, organisationId = organisation,
                role = Roles.Partner, countryCode = country,
            })).EnsureSuccessStatusCode();
        }
        using var partner = await fixture.Login("partner-one");
        using var second = await fixture.Login("partner-two");
        using var nepal = await fixture.Login("partner-nepal");
        const string lk = "?countryCode=LK";
        const string np = "?countryCode=NP";
        var first = await partner.GetFromJsonAsync<JsonElement>("/api/v1/partner" + lk);
        Assert.Empty(first.GetProperty("work").EnumerateArray());
        var share = $"/api/v1/partner/cases/{work.Id}/shares/{org.Id}";
        Assert.Equal(HttpStatusCode.NotFound, (await partner.GetAsync($"/api/v1/requests/{work.Id}" + lk)).StatusCode);
        (await admin.PutAsJsonAsync(share + lk, new { title = "Coordinate family kits", instructions = "Confirm pickup with the depot." })).EnsureSuccessStatusCode();
        var workspace = await partner.GetFromJsonAsync<JsonElement>("/api/v1/partner" + lk);
        var assigned = Assert.Single(workspace.GetProperty("work").EnumerateArray());
        Assert.Equal(work.Reference, assigned.GetProperty("reference").GetString());
        Assert.Equal("Confirm pickup with the depot.", assigned.GetProperty("workInstructions").GetString());
        Assert.DoesNotContain(work.Description, workspace.GetRawText());
        Assert.DoesNotContain("citizenId", workspace.GetRawText());
        Assert.Empty((await second.GetFromJsonAsync<JsonElement>("/api/v1/partner" + lk)).GetProperty("work").EnumerateArray());
        Assert.Empty((await partner.GetFromJsonAsync<JsonElement>("/api/v1/partner" + np)).GetProperty("work").EnumerateArray());
        Assert.Empty((await nepal.GetFromJsonAsync<JsonElement>("/api/v1/partner" + lk)).GetProperty("work").EnumerateArray());

        var stockBefore = await db.Set<Resource>().CountAsync();
        const string offers = "/api/v1/partner/contributions";
        var offer = new { operationId = Guid.NewGuid(), organisationId = org.Id, title = "Family kits", kind = "Resource", unit = "kits",
            quantity = 10, description = "Ten kits available after approval." };
        Assert.Equal(HttpStatusCode.Forbidden, (await second.PostAsJsonAsync(offers + lk, offer)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await partner.PostAsJsonAsync(offers + np, offer)).StatusCode);
        var created = await partner.PostAsJsonAsync(offers + lk, offer);
        created.EnsureSuccessStatusCode();
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        (await partner.PostAsJsonAsync(offers + lk, offer)).EnsureSuccessStatusCode();
        var action = new { note = "Accepted by the receiving organisation." };
        Assert.Equal(HttpStatusCode.Forbidden, (await partner.PostAsJsonAsync($"{offers}/{id}/accept" + lk, action)).StatusCode);
        (await admin.PostAsJsonAsync($"{offers}/{id}/accept" + lk, action)).EnsureSuccessStatusCode();
        var progress = new { quantity = 4, note = "Four kits released to the response team." };
        Assert.Equal(HttpStatusCode.Forbidden, (await second.PostAsJsonAsync($"{offers}/{id}/progress" + lk, progress)).StatusCode);
        (await partner.PostAsJsonAsync($"{offers}/{id}/progress" + lk, progress)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest, (await partner.PostAsJsonAsync($"{offers}/{id}/progress" + lk, progress)).StatusCode);
        Assert.Equal(stockBefore, await db.Set<Resource>().CountAsync());
        var saved = await partner.GetFromJsonAsync<JsonElement>("/api/v1/partner" + lk);
        Assert.Equal(4, Assert.Single(saved.GetProperty("contributions").EnumerateArray()).GetProperty("fulfilledQuantity").GetDecimal());
        Assert.NotEmpty(saved.GetProperty("history").EnumerateArray());
        Assert.Empty((await second.GetFromJsonAsync<JsonElement>("/api/v1/partner" + lk)).GetProperty("contributions").EnumerateArray());
        (await admin.DeleteAsync(share + lk)).EnsureSuccessStatusCode();
        Assert.Empty((await partner.GetFromJsonAsync<JsonElement>("/api/v1/partner" + lk)).GetProperty("work").EnumerateArray());
    }

    [Fact]
    public async Task SpecialistMetricsAndResourceCoordinatesUseCountryAndRoleGrants()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var org = await db.Set<Organisation>().SingleAsync(o => o.Name == "Surakuma Community Response (demo)");
        var foreign = new Organisation { Name = "Independent stock owner" };
        db.AddRange(foreign, new Resource { OrganisationId = foreign.Id, CountryCode = "LK", Name = "Inaccessible stock" });
        await db.SaveChangesAsync();
        using var logistics = await fixture.Login("logistics");
        using var citizen = await fixture.Login("citizen");
        var expected = await db.Set<Resource>().CountAsync(r => r.CountryCode == "LK" && r.OrganisationId == org.Id);
        var dashboard = await logistics.GetFromJsonAsync<JsonElement>("/api/v1/staff/overview/Logistics?countryCode=LK");
        Assert.True(dashboard.GetProperty("hasAccess").GetBoolean());
        Assert.Equal(expected, dashboard.GetProperty("metrics").GetProperty("inventory").GetInt32());
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.GetAsync("/api/v1/staff/overview/Logistics?countryCode=LK")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await logistics.GetAsync("/api/v1/staff/overview/CaseManager?countryCode=LK")).StatusCode);
        var inventory = await logistics.GetFromJsonAsync<JsonElement>("/api/v1/logistics?countryCode=LK&specialist=true");
        Assert.Equal(expected, inventory.GetProperty("inventory").GetArrayLength());
        var outOfScope = await logistics.GetFromJsonAsync<JsonElement>("/api/v1/staff/overview/Logistics?countryCode=NP");
        Assert.False(outOfScope.GetProperty("hasAccess").GetBoolean());

        var request = new ResourceInput(org.Id, "Warehouse supplies", AidCategory.FoodWater, "packs", 1, "Registered warehouse",
            27.7, 85.3, "", true, "LK");
        Assert.Equal(HttpStatusCode.BadRequest, (await logistics.PostAsJsonAsync("/api/v1/resources", new
        {
            organisationId = request.OrganisationId, name = request.Name, category = "FoodWater", unit = request.Unit,
            stock = request.Stock, locationText = request.LocationText, latitude = request.Latitude, longitude = request.Longitude,
            suitability = request.Suitability, transportAvailable = request.TransportAvailable, countryCode = request.CountryCode,
        })).StatusCode);
        foreach (var (account, role) in new[] { ("coordinator", Roles.Coordinator), ("case", Roles.CaseManager),
            ("shelter", Roles.ShelterAdmin), ("volunteers", Roles.VolunteerCoordinator) })
        {
            using var staff = await fixture.Login(account);
            var result = await staff.GetFromJsonAsync<JsonElement>($"/api/v1/staff/overview/{role}?countryCode=LK");
            Assert.True(result.GetProperty("hasAccess").GetBoolean());
            Assert.NotEmpty(result.GetProperty("metrics").EnumerateObject());
        }
    }
}
