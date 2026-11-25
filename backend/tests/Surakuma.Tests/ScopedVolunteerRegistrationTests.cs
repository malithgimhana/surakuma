using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class ScopedVolunteerRegistrationTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task CoordinatorsRegisterForOneDispatchWhileCountryAdminsBuildReusableRosters()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var seed = await db.Set<AssistanceRequest>().SingleAsync(r => r.SubmissionKey == "seed-food");
        var organisation = seed.OrganisationId!.Value;
        var district = new AdministrativeDivision { CountryCode = "LK", Name = "Volunteer test district", LevelName = "District" };
        var centre = new Depot { CountryCode = "LK", OrganisationId = organisation, Name = "Volunteer test centre", Location = "Kelaniya" };
        var water = new Resource { CountryCode = "LK", OrganisationId = organisation, DepotId = centre.Id, Name = "Drinking water",
            Category = AidCategory.FoodWater, Unit = "l", Stock = 20 };
        var handover = new AssistanceRequest { CitizenId = seed.CitizenId, OrganisationId = organisation, CrisisId = seed.CrisisId,
            Category = AidCategory.FoodWater, Quantity = 4, Unit = "l", Status = RequestStatus.InProgress,
            RequiresCentreHandover = true, AdministrativeDivisionId = district.Id, SubmissionKey = Guid.NewGuid().ToString() };
        CaseDispatch Shipment() => new() { RequestId = handover.Id, CentreId = centre.Id, ReceivedAt = DateTimeOffset.UtcNow };
        var first = Shipment();
        var second = Shipment();
        ResourceAllocation Item(CaseDispatch dispatch) => new() { RequestId = handover.Id, CaseDispatchId = dispatch.Id,
            ResourceId = water.Id, Quantity = 2, RequestQuantity = 2, CentreReceivedQuantity = 2, Status = AllocationStatus.Dispatched };
        db.AddRange(district, centre, water, handover, first, second, Item(first), Item(second));
        await db.SaveChangesAsync();

        using var coordinator = await fixture.Login("volunteers");
        using var logistics = await fixture.Login("logistics");
        using var admin = await fixture.Login("admin");
        const string workspace = "?countryCode=LK&staffRole=VolunteerCoordinator";
        var fields = new { skills = "Distribution", available = true };
        var registration = new { requestId = handover.Id, caseDispatchId = first.Id, name = "Task Volunteer",
            email = "task-volunteer@surakuma.test", password = fixture.Password, profile = fields };
        const string endpoint = "/api/v1/volunteers/task-registration";
        var eligibleCases = await coordinator.GetFromJsonAsync<JsonElement>($"/api/v1/volunteer-tasks/cases{workspace}&requestId={handover.Id}");
        var eligibleCase = Assert.Single(eligibleCases.EnumerateArray());
        Assert.Equal(district.Id, eligibleCase.GetProperty("administrativeDivisionId").GetGuid());
        Assert.Equal(HttpStatusCode.Forbidden, (await logistics.PostAsJsonAsync(endpoint, registration)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await coordinator.PostAsJsonAsync(endpoint + workspace,
            registration with { requestId = seed.Id })).StatusCode);
        using var created = await coordinator.PostAsJsonAsync(endpoint + workspace, registration);
        Assert.True(created.IsSuccessStatusCode, await created.Content.ReadAsStringAsync());
        var scoped = await created.Content.ReadFromJsonAsync<JsonElement>();
        var scopedProfile = scoped.GetProperty("id").GetGuid();
        Assert.False(scoped.GetProperty("verified").GetBoolean());
        Assert.Equal(handover.Id, scoped.GetProperty("taskRequestId").GetGuid());
        Assert.Equal(first.Id, scoped.GetProperty("taskDispatchId").GetGuid());
        Assert.Equal(district.Id, scoped.GetProperty("serviceRegionId").GetGuid());
        Assert.Equal("", scoped.GetProperty("availability").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await coordinator.PostAsJsonAsync(endpoint + workspace, registration)).StatusCode);
        Assert.Equal(1, await db.Set<VolunteerProfile>().CountAsync(v => v.TaskDispatchId == first.Id));
        using var edited = await coordinator.PostAsJsonAsync("/api/v1/volunteers" + workspace, scoped);
        Assert.True(edited.IsSuccessStatusCode, await edited.Content.ReadAsStringAsync());
        (await coordinator.PostAsync($"/api/v1/volunteers/{scopedProfile}/verify{workspace}", null)).EnsureSuccessStatusCode();
        using var signup = fixture.Client();
        const string citizenEmail = "existing-citizen@surakuma.test";
        (await signup.PostAsJsonAsync("/api/v1/auth/register", new { email = citizenEmail, password = fixture.Password, name = "Existing Citizen" }))
            .EnsureSuccessStatusCode();
        var existing = new { registration.requestId, caseDispatchId = second.Id, email = citizenEmail, profile = fields, useExistingAccount = true };
        using var linked = await coordinator.PostAsJsonAsync(endpoint + workspace, existing);
        Assert.True(linked.IsSuccessStatusCode, await linked.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.BadRequest, (await coordinator.PostAsJsonAsync(endpoint + workspace,
            existing with { email = "admin@surakuma.test" })).StatusCode);
        using var existingVolunteer = await fixture.Login("existing-citizen");
        var roles = (await existingVolunteer.GetFromJsonAsync<JsonElement>("/api/v1/auth/me")).GetProperty("roles").EnumerateArray();
        Assert.Contains(roles, role => role.GetString() == "Citizen");
        Assert.Contains(roles, role => role.GetString() == "Volunteer");

        (await admin.PostAsJsonAsync("/api/v1/admin/users", new { name = "Local Country Administrator", email = "local-country@surakuma.test",
            password = fixture.Password, role = "CountryAdministrator", countryCode = "LK" })).EnsureSuccessStatusCode();
        using var country = await fixture.Login("local-country");
        var localAccount = new { name = "Local Roster Volunteer", email = "local-roster@surakuma.test",
            password = fixture.Password, role = "Volunteer", countryCode = "LK", organisationId = organisation,
            volunteerProfile = new { fields.skills, availability = "Daily", fields.available } };
        Assert.Equal(HttpStatusCode.Forbidden, (await country.PostAsJsonAsync("/api/v1/admin/users",
            localAccount with { countryCode = "IN" })).StatusCode);
        using var localResponse = await country.PostAsJsonAsync("/api/v1/admin/users", localAccount);
        Assert.True(localResponse.IsSuccessStatusCode, await localResponse.Content.ReadAsStringAsync());
        var localUserId = (await localResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        var local = await db.Set<VolunteerProfile>().AsNoTracking().SingleAsync(v => v.UserId == localUserId);
        Assert.Null(local.TaskRequestId);
        Assert.Null((await db.Set<Membership>().AsNoTracking().SingleAsync(m => m.UserId == localUserId && m.Role == Roles.Volunteer)).CrisisId);
        (await coordinator.PostAsync($"/api/v1/volunteers/{local.Id}/verify{workspace}", null)).EnsureSuccessStatusCode();

        async Task<Guid[]> Candidates(Guid requestId, Guid? dispatch)
        {
            var due = Uri.EscapeDataString(DateTimeOffset.UtcNow.AddHours(2).ToString("o"));
            var list = await coordinator.GetFromJsonAsync<JsonElement>($"/api/v1/volunteer-tasks/candidates{workspace}&requestId={requestId}&dueAt={due}" +
                (dispatch.HasValue ? $"&dispatchId={dispatch}" : ""));
            return list.EnumerateArray().Select(v => v.GetProperty("id").GetGuid()).ToArray();
        }
        var firstCandidates = await Candidates(handover.Id, first.Id);
        Assert.Contains(scopedProfile, firstCandidates);
        Assert.Contains(local.Id, firstCandidates);
        var secondCandidates = await Candidates(handover.Id, second.Id);
        Assert.DoesNotContain(scopedProfile, secondCandidates);
        Assert.Contains(local.Id, secondCandidates);
        var otherCase = await Candidates(seed.Id, null);
        Assert.DoesNotContain(scopedProfile, otherCase);
        Assert.Contains(local.Id, otherCase);

        var assignment = new { requestId = handover.Id, caseDispatchId = second.Id, volunteerId = scopedProfile,
            title = "Handover drinking water", requiredSkill = "Distribution", dueAt = DateTimeOffset.UtcNow.AddHours(2) };
        Assert.Equal(HttpStatusCode.BadRequest, (await coordinator.PostAsJsonAsync("/api/v1/volunteer-tasks" + workspace, assignment)).StatusCode);
        (await coordinator.PostAsJsonAsync("/api/v1/volunteer-tasks" + workspace,
            assignment with { caseDispatchId = first.Id })).EnsureSuccessStatusCode();
        using var taskVolunteer = await fixture.Login("task-volunteer");
        var ownProfile = await taskVolunteer.GetFromJsonAsync<JsonElement>("/api/v1/auth/profile");
        var volunteerDetails = ownProfile.GetProperty("volunteer");
        Assert.True(volunteerDetails.GetProperty("verified").GetBoolean());
        Assert.Equal(handover.Id, volunteerDetails.GetProperty("taskRequestId").GetGuid());
        Assert.Equal(handover.Reference, volunteerDetails.GetProperty("caseReference").GetString());
        Assert.Equal(first.Reference, volunteerDetails.GetProperty("dispatchReference").GetString());
        var ownTasks = await taskVolunteer.GetFromJsonAsync<JsonElement>("/api/v1/volunteer-tasks/mine");
        var ownAssignment = Assert.Single(ownTasks.GetProperty("assignments").EnumerateArray());
        Assert.Equal(first.Id, ownAssignment.GetProperty("task").GetProperty("caseDispatchId").GetGuid());
    }
}
