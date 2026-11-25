using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class VolunteerCoordinatorWorkspaceTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    private const string Roster = "/api/v1/volunteers";
    private const string Tasks = "/api/v1/volunteer-tasks";
    private const string Scope = "countryCode=LK&staffRole=VolunteerCoordinator";

    [Fact]
    public async Task ScopedRosterSupportsVerificationAssignmentProgressAndReportDecisions()
    {
        using var coordinator = await fixture.Login("volunteers");
        using var otherRole = await fixture.Login("coordinator");
        Guid organisation, otherOrganisation, caseId, otherCaseId;
        string accountId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var user = new AppUser { UserName = "shift@surakuma.test", Email = "shift@surakuma.test",
                DisplayName = "Shift Volunteer", EmailConfirmed = true };
            Assert.True((await users.CreateAsync(user, fixture.Password)).Succeeded);
            accountId = user.Id;
            organisation = await db.Set<Membership>().Where(m => m.Role == Roles.VolunteerCoordinator)
                .Select(m => m.OrganisationId!.Value).SingleAsync();
            otherOrganisation = await db.Set<Organisation>().Where(o => o.Id != organisation).Select(o => o.Id).SingleAsync();
            var original = await db.Set<AssistanceRequest>().FirstAsync(r => r.Status == RequestStatus.Approved);
            var request = new AssistanceRequest { CitizenId = original.CitizenId, CrisisId = original.CrisisId, OrganisationId = organisation,
                Category = AidCategory.Medical, Status = RequestStatus.Approved, Quantity = 2, Unit = "kits", SubmissionKey = "shift-workspace",
                Description = "Synthetic request for volunteer work.", LocationText = "Synthetic outreach site", Synthetic = true };
            var outside = new AssistanceRequest { CitizenId = original.CitizenId, CrisisId = original.CrisisId, OrganisationId = otherOrganisation,
                Status = RequestStatus.Approved, Quantity = 1, Unit = "packs", SubmissionKey = "shift-outside", LocationText = "Outside scope",
                Description = "Synthetic request assigned to another organisation.", Synthetic = true };
            db.AddRange(request, outside, new Membership { UserId = accountId, Role = Roles.Volunteer, OrganisationId = organisation });
            await db.SaveChangesAsync();
            caseId = request.Id;
            otherCaseId = outside.Id;
        }

        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.GetAsync(Roster + "?countryCode=NP&staffRole=VolunteerCoordinator")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await otherRole.GetAsync(Roster + "?" + Scope)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.GetAsync($"{Roster}/registered-users?organisationId={otherOrganisation}&{Scope}")).StatusCode);
        var lookup = await coordinator.GetFromJsonAsync<JsonElement>($"{Roster}/registered-users?organisationId={organisation}&search=shift%40surakuma.test&{Scope}");
        Assert.Equal(accountId, Assert.Single(lookup.EnumerateArray()).GetProperty("id").GetString());
        var upcoming = await coordinator.GetFromJsonAsync<List<VolunteerCase>>($"{Tasks}/cases?search=Medical&unassigned=true&{Scope}");
        Assert.Contains(upcoming!, r => r.Id == caseId && r.OutstandingQuantity == 2 && r.Unit == "kits");
        Assert.Empty((await coordinator.GetFromJsonAsync<List<VolunteerCase>>($"{Tasks}/cases?requestId={otherCaseId}&{Scope}"))!);

        var profile = new
        {
            userId = accountId, organisationId = organisation, countryCode = "LK", skills = "Distribution, First Aid",
            availability = "Weekdays 09:00–17:00", available = true, verified = true,
        };
        Assert.Equal(HttpStatusCode.Forbidden, (await otherRole.PostAsJsonAsync(Roster + "?countryCode=LK", profile)).StatusCode);
        var added = await Post(coordinator, Roster + "?" + Scope, profile);
        Assert.False(added.GetProperty("verified").GetBoolean());
        var profileId = added.GetProperty("id").GetGuid();
        var requestInput = new TaskInput(caseId, profileId, "Check collection point", "First Aid, Distribution",
            DateTimeOffset.UtcNow.AddHours(2), Instructions: "Meet at the outreach site and check in with the supervisor.");
        Assert.Equal(HttpStatusCode.BadRequest, (await coordinator.PostAsJsonAsync(Tasks + "?" + Scope, requestInput)).StatusCode);

        using var volunteer = await fixture.Login("shift");
        Assert.Equal(HttpStatusCode.Forbidden, (await otherRole.PostAsync($"{Roster}/{profileId}/verify?countryCode=LK", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await volunteer.PostAsync($"{Roster}/{profileId}/verify", null)).StatusCode);
        Assert.True((await Post(coordinator, $"{Roster}/{profileId}/verify?{Scope}", new { })).GetProperty("verified").GetBoolean());
        Assert.Equal(HttpStatusCode.BadRequest, (await coordinator.PostAsync($"{Roster}/{profileId}/verify?{Scope}", null)).StatusCode);
        lookup = await coordinator.GetFromJsonAsync<JsonElement>($"{Roster}/registered-users?organisationId={organisation}&{Scope}");
        Assert.DoesNotContain(lookup.EnumerateArray(), u => u.GetProperty("id").GetString() == accountId);

        var due = Uri.EscapeDataString(requestInput.DueAt.ToString("O"));
        var candidates = $"{Tasks}/candidates?requestId={caseId}&dueAt={due}&{Scope}";
        var matches = await coordinator.GetFromJsonAsync<List<VolunteerCandidate>>(candidates + "&skill=distribution%2Cfirst%20aid");
        Assert.Contains(matches!, v => v.Id == profileId);
        matches = await coordinator.GetFromJsonAsync<List<VolunteerCandidate>>(candidates + "&skill=distribution%2CLogistics");
        Assert.DoesNotContain(matches!, v => v.Id == profileId);

        Assert.Equal(HttpStatusCode.Forbidden, (await otherRole.PostAsJsonAsync(Tasks + "?countryCode=LK", requestInput)).StatusCode);
        var assigned = await Post(coordinator, Tasks + "?" + Scope, requestInput);
        var taskId = assigned.GetProperty("id").GetGuid();
        Assert.Equal("Assigned", assigned.GetProperty("status").GetString());
        var oversight = await otherRole.GetFromJsonAsync<JsonElement>(Roster + "?countryCode=LK");
        Assert.Contains(oversight.GetProperty("tasks").EnumerateArray(), task => task.GetProperty("id").GetGuid() == taskId);
        Assert.Equal(requestInput.Instructions, assigned.GetProperty("instructions").GetString());
        var feedPath = Tasks + "/mine";
        Assert.Equal(HttpStatusCode.Unauthorized, (await fixture.Client().GetAsync(feedPath)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await coordinator.GetAsync(feedPath)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await volunteer.GetAsync(feedPath + "?countryCode=NP")).StatusCode);
        var ownFeed = await volunteer.GetFromJsonAsync<JsonElement>(feedPath + $"?volunteerId={Guid.NewGuid()}&{Scope}");
        var mine = Assert.Single(ownFeed.GetProperty("assignments").EnumerateArray());
        Assert.Equal(taskId, mine.GetProperty("task").GetProperty("id").GetGuid());
        Assert.Equal("Synthetic outreach site", mine.GetProperty("locationText").GetString());
        Assert.Equal("Medical", mine.GetProperty("category").GetString());
        Assert.False(string.IsNullOrWhiteSpace(mine.GetProperty("crisis").GetString()));
        Assert.False(mine.TryGetProperty("description", out _));
        using var otherVolunteer = await fixture.Login("volunteer");
        var otherFeed = await otherVolunteer.GetFromJsonAsync<JsonElement>(feedPath + $"?volunteerId={profileId}");
        Assert.DoesNotContain(otherFeed.GetProperty("assignments").EnumerateArray(),
            entry => entry.GetProperty("task").GetProperty("id").GetGuid() == taskId);
        Assert.Equal(HttpStatusCode.BadRequest, (await coordinator.PostAsJsonAsync(Tasks + "?" + Scope, requestInput)).StatusCode);
        matches = await coordinator.GetFromJsonAsync<List<VolunteerCandidate>>(candidates);
        Assert.DoesNotContain(matches!, v => v.Id == profileId);

        var dashboard = await coordinator.GetFromJsonAsync<JsonElement>(Roster + "?" + Scope);
        Assert.Equal(0, dashboard.GetProperty("metrics").GetProperty("deployments").GetInt32());
        Assert.DoesNotContain(dashboard.GetProperty("available").EnumerateArray(), v => v.GetGuid() == profileId);
        Assert.Equal("Synthetic outreach site", dashboard.GetProperty("cases").GetProperty(caseId.ToString()).GetProperty("locationText").GetString());
        Assert.Contains((await volunteer.GetFromJsonAsync<JsonElement>("/api/v1/notifications?countryCode=LK")).EnumerateArray(),
            n => n.GetProperty("taskId").ValueKind == JsonValueKind.String && n.GetProperty("taskId").GetGuid() == taskId);

        var self = $"{Tasks}/{taskId}";
        var scopedTask = $"{self}?{Scope}";
        await Post(volunteer, self, new TaskUpdateInput("Accept"));
        await Post(volunteer, self, new TaskUpdateInput("Start"));
        await Post(volunteer, self, new TaskUpdateInput("Progress", "Checked in with the supervisor."));
        dashboard = await coordinator.GetFromJsonAsync<JsonElement>(Roster + "?" + Scope);
        Assert.Equal(1, dashboard.GetProperty("metrics").GetProperty("deployments").GetInt32());
        Assert.Contains(dashboard.GetProperty("history").EnumerateArray(), e => e.GetProperty("action").GetString() == "Progress");
        var report = new TaskUpdateInput("Complete", WorkDescription: "Checked the collection point.", Outcome: "Operational status confirmed.");
        await Post(volunteer, self, report);
        ownFeed = await volunteer.GetFromJsonAsync<JsonElement>(feedPath);
        Assert.Equal("AwaitingVerification", Assert.Single(ownFeed.GetProperty("assignments").EnumerateArray())
            .GetProperty("task").GetProperty("status").GetString());
        Assert.Equal(HttpStatusCode.Forbidden, (await volunteer.PostAsJsonAsync(self,
            new TaskUpdateInput("Verify", "Attempt to verify my own report."))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await otherRole.PostAsJsonAsync(self + "?countryCode=LK",
            new TaskUpdateInput("Verify", "Coordinator cannot verify this report."))).StatusCode);
        var reviewQueue = await coordinator.GetFromJsonAsync<JsonElement>("/api/v1/notifications?" + Scope);
        Assert.Contains(reviewQueue.EnumerateArray(), n => n.GetProperty("scopeRole").GetString() == Roles.VolunteerCoordinator);
        Assert.Equal(HttpStatusCode.BadRequest, (await coordinator.PostAsJsonAsync(scopedTask, new TaskUpdateInput("Return", " "))).StatusCode);
        await Post(coordinator, scopedTask, new TaskUpdateInput("Return", "Confirm who inspected the site."));
        await Post(volunteer, self, report with { Note = "Supervisor verified the inspection." });
        var completion = await Post(coordinator, scopedTask, new TaskUpdateInput("Verify", "Reviewed the inspection and supervisor confirmation."));
        Assert.Equal("Completed", completion.GetProperty("status").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await coordinator.PostAsJsonAsync(scopedTask, new TaskUpdateInput("Verify", "Duplicate decision."))).StatusCode);
        dashboard = await coordinator.GetFromJsonAsync<JsonElement>(Roster + "?" + Scope);
        Assert.Contains(dashboard.GetProperty("available").EnumerateArray(), p => p.GetGuid() == profileId);
        Assert.Contains(dashboard.GetProperty("activity").EnumerateArray(), e => e.GetProperty("action").GetString() == "VolunteerVerified");
        var history = dashboard.GetProperty("history").EnumerateArray().Where(e => e.GetProperty("taskId").GetGuid() == taskId).ToArray();
        Assert.Equal(new[] { "Assign", "Accept", "Start", "Progress", "Complete", "Return", "Complete", "Verify" },
            history.Select(e => e.GetProperty("action").GetString()));
        Assert.False(string.IsNullOrWhiteSpace(history[^1].GetProperty("actorId").GetString()));

        using var verifyScope = fixture.Factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        Assert.Equal(RequestStatus.Approved, (await verifyDb.Set<AssistanceRequest>().FindAsync(caseId))!.Status);
    }

    [Fact]
    public async Task LegacyAssignmentBlocksOverlappingWorkAndBecomesOverdueAfterItsDueDate()
    {
        using var coordinator = await fixture.Login("volunteers");
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var task = await db.Set<VolunteerTask>().SingleAsync(t => t.StartsAt == null);
        Assert.Null(task.StartsAt);
        var original = (await db.Set<AssistanceRequest>().FindAsync(task.RequestId))!;
        var next = new AssistanceRequest
        {
            CitizenId = original.CitizenId, CrisisId = original.CrisisId, OrganisationId = original.OrganisationId,
            Category = original.Category, Status = RequestStatus.Approved, Quantity = 1, Unit = original.Unit,
            SubmissionKey = "legacy-assignment-overlap", Description = "Synthetic second assignment for conflict checking.",
            LocationText = original.LocationText, Synthetic = true
        };
        db.Add(next);
        await db.SaveChangesAsync();

        var newTask = new TaskInput(next.Id, task.VolunteerId, "Collect supplies", task.RequiredSkill,
            DateTimeOffset.UtcNow.AddHours(1));
        var due = Uri.EscapeDataString(newTask.DueAt.ToString("O"));
        var candidates = $"{Tasks}/candidates?requestId={next.Id}&dueAt={due}&{Scope}";
        var dashboard = await coordinator.GetFromJsonAsync<JsonElement>($"{Roster}?{Scope}");
        Assert.Contains(dashboard.GetProperty("committed").EnumerateArray(), p => p.GetGuid() == task.VolunteerId);
        Assert.DoesNotContain(dashboard.GetProperty("available").EnumerateArray(), p => p.GetGuid() == task.VolunteerId);
        Assert.DoesNotContain((await coordinator.GetFromJsonAsync<List<VolunteerCandidate>>(candidates))!, v => v.Id == task.VolunteerId);
        using var rejected = await coordinator.PostAsJsonAsync($"{Tasks}?{Scope}", newTask);
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        Assert.Contains("overlaps this scheduled window", await rejected.Content.ReadAsStringAsync());

        task.CreatedAt = DateTimeOffset.UtcNow.AddHours(-2);
        task.DueAt = DateTimeOffset.UtcNow.AddHours(-1);
        await db.SaveChangesAsync();

        dashboard = await coordinator.GetFromJsonAsync<JsonElement>($"{Roster}?{Scope}");
        Assert.Contains(dashboard.GetProperty("overdue").EnumerateArray(), t => t.GetGuid() == task.Id);
        Assert.Contains(dashboard.GetProperty("available").EnumerateArray(), p => p.GetGuid() == task.VolunteerId);
        Assert.Contains((await coordinator.GetFromJsonAsync<List<VolunteerCandidate>>(candidates))!, v => v.Id == task.VolunteerId);
    }

    private static async Task<JsonElement> Post(HttpClient client, string path, object input)
    {
        using var response = await client.PostAsJsonAsync(path, input);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }
}
