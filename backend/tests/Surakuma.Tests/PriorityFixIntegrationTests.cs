using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed partial class IntegrationTests
{
    [Theory]
    [InlineData("Reserved")]
    [InlineData("Dispatched")]
    [InlineData("ShelterReserved")]
    [InlineData("CheckedIn")]
    public async Task ReassignmentCannotStrandActiveCommitments(string state)
    {
        Guid requestId, destination;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var seed = await db.Set<AssistanceRequest>().FirstAsync(x => x.SubmissionKey == "seed-food");
            destination = await db.Set<Organisation>().Where(x => x.Id != seed.OrganisationId).Select(x => x.Id).FirstAsync();
            var request = new AssistanceRequest { CitizenId = seed.CitizenId, CrisisId = seed.CrisisId, OrganisationId = seed.OrganisationId, Category = state.StartsWith("Shelter") || state == "CheckedIn" ? AidCategory.Shelter : AidCategory.FoodWater, Quantity = 1, Status = RequestStatus.InProgress, SubmissionKey = Guid.NewGuid().ToString() };
            db.Add(request); requestId = request.Id;
            if (request.Category == AidCategory.Shelter)
            {
                var shelter = await db.Set<Shelter>().FirstAsync(x => x.OrganisationId == seed.OrganisationId);
                db.Add(new ShelterAllocation { RequestId = request.Id, ShelterId = shelter.Id, People = 1, Status = state == "CheckedIn" ? StayStatus.CheckedIn : StayStatus.Reserved });
            }
            else
            {
                var resource = await db.Set<Resource>().FirstAsync(x => x.OrganisationId == seed.OrganisationId);
                db.Add(new ResourceAllocation { RequestId = request.Id, ResourceId = resource.Id, Quantity = 1, Status = state == "Dispatched" ? AllocationStatus.Dispatched : AllocationStatus.Reserved });
            }
            await db.SaveChangesAsync();
        }
        using var coordinator = await fixture.Login("coordinator");
        Assert.Equal(HttpStatusCode.BadRequest, (await coordinator.PostAsJsonAsync($"/api/v1/requests/{requestId}/reassign", new { organisationId = destination })).StatusCode);
        using var check = fixture.Factory.Services.CreateScope();
        Assert.NotEqual(destination, (await check.ServiceProvider.GetRequiredService<CrisisDbContext>().Set<AssistanceRequest>().FindAsync(requestId))!.OrganisationId);
    }

    [Fact]
    public async Task CitizenCannotReadInternalHistoryNotes()
    {
        Guid requestId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var seed = await db.Set<AssistanceRequest>().FirstAsync(x => x.SubmissionKey == "seed-food");
            var request = new AssistanceRequest { CitizenId = seed.CitizenId, CrisisId = seed.CrisisId, OrganisationId = seed.OrganisationId, Category = AidCategory.FoodWater, Quantity = 1, SubmissionKey = Guid.NewGuid().ToString() };
            db.Add(request); await db.SaveChangesAsync(); requestId = request.Id;
        }
        using var staff = await fixture.Login("case");
        (await staff.PatchAsJsonAsync($"/api/v1/requests/{requestId}/status", new { status = "UnderReview", reason = "Private staff note" })).EnsureSuccessStatusCode();
        (await staff.PostAsJsonAsync($"/api/v1/requests/{requestId}/escalate", new { action = "Escalate", note = "Private escalation reason" })).EnsureSuccessStatusCode();
        using var citizen = await fixture.Login("citizen");
        string citizenDetail = await citizen.GetStringAsync($"/api/v1/requests/{requestId}");
        Assert.DoesNotContain("Private staff note", citizenDetail);
        Assert.DoesNotContain("Private escalation reason", citizenDetail);
        string staffDetail = await staff.GetStringAsync($"/api/v1/requests/{requestId}");
        Assert.Contains("Private staff note", staffDetail);
        Assert.Contains("Private escalation reason", staffDetail);
    }

    [Fact]
    public async Task RevocationInvalidatesSessionsAndKeepsRoleOnlyWhenAnotherMembershipExists()
    {
        var email = $"revocation-{Guid.NewGuid():N}@surakuma.test";
        Guid firstMembership, secondMembership;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var user = new AppUser { UserName = email, Email = email, DisplayName = "Revocation test", LockoutEnabled = true };
            Assert.True((await users.CreateAsync(user, fixture.Password)).Succeeded);
            Assert.True((await users.AddToRoleAsync(user, Roles.CaseManager)).Succeeded);
            var orgs = await db.Set<Organisation>().Take(2).ToListAsync();
            var first = new Membership { UserId = user.Id, OrganisationId = orgs[0].Id, Role = Roles.CaseManager };
            var second = new Membership { UserId = user.Id, OrganisationId = orgs[1].Id, Role = Roles.CaseManager };
            db.AddRange(first, second); await db.SaveChangesAsync(); firstMembership = first.Id; secondMembership = second.Id;
        }
        using var client = fixture.Factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), HandleCookies = false });
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = fixture.Password });
        login.EnsureSuccessStatusCode();
        var token = (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString();
        string cookie = login.Headers.GetValues("Set-Cookie").First().Split(';')[0];
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        client.DefaultRequestHeaders.Add("Cookie", cookie);
        using var admin = await fixture.Login("admin");
        (await admin.DeleteAsync($"/api/v1/admin/memberships/{firstMembership}")).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/v1/auth/refresh", null)).StatusCode);
        var nextLogin = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = fixture.Password });
        nextLogin.EnsureSuccessStatusCode();
        Assert.Contains("CaseManager", await nextLogin.Content.ReadAsStringAsync());
        (await admin.DeleteAsync($"/api/v1/admin/memberships/{secondMembership}")).EnsureSuccessStatusCode();
        var finalLogin = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password = fixture.Password });
        finalLogin.EnsureSuccessStatusCode();
        Assert.DoesNotContain("CaseManager", await finalLogin.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ClosedCaseProblemAppearsInFollowUpAndCanBeResolvedWithAudit()
    {
        Guid id;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var seed = await db.Set<AssistanceRequest>().FirstAsync(x => x.SubmissionKey == "seed-food");
            var request = new AssistanceRequest { CitizenId = seed.CitizenId, CrisisId = seed.CrisisId, OrganisationId = seed.OrganisationId, Category = AidCategory.FoodWater, Quantity = 1, DeliveredQuantity = 1, Status = RequestStatus.Closed, SubmissionKey = Guid.NewGuid().ToString() };
            db.Add(request); await db.SaveChangesAsync(); id = request.Id;
        }
        using var citizen = await fixture.Login("citizen");
        (await citizen.PostAsJsonAsync($"/api/v1/requests/{id}/feedback", new { rating = 1, received = false, problem = true, comment = "Test follow-up" })).EnsureSuccessStatusCode();
        using var staff = await fixture.Login("case");
        Assert.Contains(id.ToString(), await staff.GetStringAsync("/api/v1/requests/escalated"));
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.PostAsJsonAsync($"/api/v1/requests/{id}/escalation/resolve", new { note = "not staff" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.PostAsJsonAsync($"/api/v1/requests/{id}/escalation/resolve", new { note = "" })).StatusCode);
        (await staff.PostAsJsonAsync($"/api/v1/requests/{id}/escalation/resolve", new { note = "Contacted household and resolved issue" })).EnsureSuccessStatusCode();
        Assert.DoesNotContain(id.ToString(), await staff.GetStringAsync("/api/v1/requests/escalated"));
        using var check = fixture.Factory.Services.CreateScope();
        Assert.True(await check.ServiceProvider.GetRequiredService<CrisisDbContext>().Set<AuditEvent>().AnyAsync(x => x.EntityId == id && x.Action == "EscalationResolved"));
    }

    [Fact]
    public async Task ShelterQuantityMustRepresentOneHouseholdIncludingLegacyRecords()
    {
        Guid crisis, org, legacy, shelter, legacyPlacement;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var seed = await db.Set<AssistanceRequest>().FirstAsync(x => x.SubmissionKey == "seed-food");
            crisis = seed.CrisisId; org = seed.OrganisationId!.Value;
            shelter = await db.Set<Shelter>().Where(x => x.OrganisationId == org).Select(x => x.Id).FirstAsync();
            var request = new AssistanceRequest { CitizenId = seed.CitizenId, CrisisId = crisis, OrganisationId = org, Category = AidCategory.Shelter, Quantity = 4, Status = RequestStatus.Approved, SubmissionKey = Guid.NewGuid().ToString() };
            var placement = new ShelterAllocation { RequestId = request.Id, ShelterId = shelter, People = 4, Status = StayStatus.Reserved };
            db.Add(request); db.Add(placement); await db.SaveChangesAsync(); legacy = request.Id; legacyPlacement = placement.Id;
        }
        using var citizen = await fixture.Login("citizen");
        var response = await citizen.PostAsJsonAsync("/api/v1/requests", new { crisisId = crisis, category = "Shelter", priority = "Normal", description = "Fictional household shelter request", locationText = "Test location", householdSize = 4, accessibilityNeeds = "", quantity = 4, submissionKey = Guid.NewGuid().ToString(), synthetic = true });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var staff = await fixture.Login("shelter");
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.PostAsJsonAsync("/api/v1/shelter-allocations", new { requestId = legacy, shelterId = shelter })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await staff.PostAsync($"/api/v1/shelter-allocations/{legacyPlacement}/CheckIn", null)).StatusCode);
        using var check = fixture.Factory.Services.CreateScope();
        var unchanged = await check.ServiceProvider.GetRequiredService<CrisisDbContext>().Set<AssistanceRequest>().FindAsync(legacy);
        Assert.Equal(0, unchanged!.DeliveredQuantity);
    }
}
