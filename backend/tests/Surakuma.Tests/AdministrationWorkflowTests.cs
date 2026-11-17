using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Surakuma.Domain;
using Surakuma.Infrastructure;
namespace Surakuma.Tests;

public sealed class AdministrationWorkflowTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task AdminWorkspaceFiltersActivityQueueAlertsAndReportsBeforeAggregating()
    {
        using var admin = await fixture.Login("admin");
        foreach (var country in new[] { "LK", "NP" })
        {
            using var scope = fixture.Factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var crisisResponse = await admin.PostAsJsonAsync("/api/v1/crises", new { name = "Workspace test " + country, countryCode = country, active = true });
            crisisResponse.EnsureSuccessStatusCode();
            var crisisId = (await crisisResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
            var citizen = await db.Users.SingleAsync(u => u.Email == "citizen@surakuma.test");
            var request = new AssistanceRequest { CrisisId = crisisId, CitizenId = citizen.Id, SubmissionKey = Guid.NewGuid().ToString() };
            db.AddRange(request,
                new OutboxMessage { RequestId = request.Id, UserId = citizen.Id, State = "ScopeTest" + country, Message = "Delivery " + country },
                new AdminProposal { Kind = "GlobalAccess", CountryCode = country, Reason = "Scope test " + country, Payload = JsonSerializer.Serialize(new { UserId = citizen.Id }) },
                new AdminAlert { ConditionKey = "scope-test-" + country, CountryCode = country, Message = "Alert " + country, ResolvedAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();

            var triage = await admin.GetFromJsonAsync<JsonElement>($"/api/v1/requests/triage?countryCode={country}");
            Assert.Contains(triage.EnumerateArray(), item => item.GetProperty("id").GetGuid() == request.Id);
        }

        async Task<string> Read(string path, string country = "LK") =>
            await admin.GetStringAsync($"/api/v1/{path}{(path.Contains('?') ? '&' : '?')}countryCode={country}");

        Assert.Contains("ScopeTestLK", await Read("admin/system"));
        Assert.DoesNotContain("ScopeTestNP", await Read("admin/system"));
        Assert.Contains("Delivery LK", await Read("admin/deliveries?includeTotal=true"));
        Assert.DoesNotContain("Delivery NP", await Read("admin/deliveries?includeTotal=true"));
        Assert.Contains("Delivery NP", await Read("admin/delivery-management?state=ScopeTestNP", "NP"));
        Assert.DoesNotContain("Delivery NP", await Read("admin/delivery-management?state=ScopeTestNP"));
        Assert.Contains("Alert LK", await Read("admin/alerts"));
        Assert.DoesNotContain("Alert NP", await Read("admin/alerts"));
        Assert.Contains("Scope test LK", await Read("admin/approvals"));
        Assert.DoesNotContain("Scope test NP", await Read("admin/approvals"));

        var audit = (await admin.GetFromJsonAsync<JsonElement>("/api/v1/admin/audit?countryCode=LK&includeTotal=true")).GetProperty("items");
        var ids = audit.EnumerateArray().Select(a => a.GetProperty("entityId").GetGuid()).ToArray();
        using var reviewScope = fixture.Factory.Services.CreateScope();
        var reviewDb = reviewScope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var recorded = await reviewDb.Set<Crisis>().Where(c => c.Name.StartsWith("Workspace test ")).ToDictionaryAsync(c => c.CountryCode, c => c.Id);
        Assert.Contains(recorded["LK"], ids);
        Assert.DoesNotContain(recorded["NP"], ids);
        Assert.Contains("\"LK\",\"Sri Lanka\"", await Read("admin/reports/export?scope=country"));
        Assert.DoesNotContain("\"NP\",\"Nepal\"", await Read("admin/reports/export?scope=country"));
    }

    [Fact]
    public async Task TabDashboardsIsolateCountryDataAndRecordAcknowledgementOnlyOnce()
    {
        using var admin = await fixture.Login("admin");
        var (_, localClient) = await Staff(Roles.CountryAdministrator, "NP");
        using var local = localClient;
        using var citizen = await fixture.Login("citizen");
        var marker = Guid.NewGuid().ToString("N");
        var refs = new Dictionary<string, string>();
        var alertIds = new Dictionary<string, Guid>();
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var userId = await db.Users.Where(u => u.Email == "citizen@surakuma.test").Select(u => u.Id).SingleAsync();
            foreach (var code in new[] { "LK", "IN", "NP" })
            {
                var crisis = new Crisis { Name = marker + code, CountryCode = code };
                var request = new AssistanceRequest { CrisisId = crisis.Id, CitizenId = userId, Reference = code + marker[..8], SubmissionKey = marker + code };
                var alert = new AdminAlert { CountryCode = code, ConditionKey = "unassigned:" + request.Id, Message = request.Reference + " assignment delayed" };
                var message = new OutboxMessage { UserId = userId, RequestId = request.Id, State = code == "IN" ? "Sent" : "Failed", Message = marker + code };
                db.AddRange(crisis, request, alert, message, new AuditEvent { Action = "StaffSuspended", CountryCode = code, Detail = marker + code });
                if (code == "IN")
                    db.AddRange(new DeliveryAttempt { EventId = message.Id, Number = 1, State = "Failed" },
                        new Notification { RequestId = request.Id, EventId = message.Id, UserId = userId, Message = marker, Read = false });
                refs.Add(code, request.Reference);
                alertIds.Add(code, alert.Id);
            }
            await db.SaveChangesAsync();
        }

        async Task<JsonElement> Page(HttpClient client, string path) => await client.GetFromJsonAsync<JsonElement>("/api/v1/" + path);
        foreach (var country in refs.Keys)
        {
            var alert = await Page(admin, $"admin/alerts?dashboard=true&search={refs[country]}&countryCode={country}");
            Assert.Equal(1, alert.GetProperty("total").GetInt32());
            Assert.Equal(refs[country], alert.GetProperty("items")[0].GetProperty("request").GetProperty("reference").GetString());
            var audit = await Page(admin, $"admin/audit?includeTotal=true&search={marker}&countryCode={country}");
            Assert.Equal(1, audit.GetProperty("total").GetInt32());
            Assert.Equal(country, audit.GetProperty("items")[0].GetProperty("countryCode").GetString());
        }
        Assert.Equal(3, (await Page(admin, $"admin/audit?includeTotal=true&search={marker}&countryCode=")).GetProperty("total").GetInt32());
        var failed = await Page(admin, $"admin/deliveries?includeTotal=true&dashboard=true&state=Failed&search={marker}&countryCode=");
        Assert.Equal(2, failed.GetProperty("total").GetInt32());
        Assert.All(failed.GetProperty("items").EnumerateArray(), row => Assert.Equal("Failed", row.GetProperty("state").GetString()));
        var recovered = (await Page(admin, $"admin/deliveries?includeTotal=true&dashboard=true&search={marker}&countryCode=IN")).GetProperty("items")[0];
        Assert.True(recovered.GetProperty("recovered").GetBoolean());
        Assert.True(recovered.GetProperty("inAppStored").GetBoolean());
        var window = Uri.EscapeDataString(DateTimeOffset.UtcNow.AddDays(1).ToString("O"));
        Assert.Equal(0, (await Page(admin, $"admin/deliveries?includeTotal=true&search={marker}&from={window}&countryCode=")).GetProperty("total").GetInt32());
        Assert.Equal(0, (await Page(admin, $"admin/audit?includeTotal=true&search={marker}&from={window}&countryCode=")).GetProperty("total").GetInt32());

        var localAlerts = await Page(local, $"admin/alerts?dashboard=true&search={refs["LK"]}&countryCode=");
        Assert.Equal(0, localAlerts.GetProperty("total").GetInt32());
        Assert.Equal(HttpStatusCode.Forbidden, (await local.GetAsync("/api/v1/admin/alerts?dashboard=true&countryCode=IN")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await local.GetAsync("/api/v1/admin/deliveries?dashboard=true&countryCode=")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await local.GetAsync("/api/v1/admin/audit?includeTotal=true&countryCode=")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.GetAsync("/api/v1/admin/alerts?dashboard=true&countryCode=NP")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await local.PostAsync($"/api/v1/admin/alerts/{alertIds["IN"]}/acknowledge", null)).StatusCode);
        var ack = $"/api/v1/admin/alerts/{alertIds["NP"]}/acknowledge";
        Assert.Equal(HttpStatusCode.NoContent, (await local.PostAsync(ack, null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync(ack, null)).StatusCode);
        var acknowledged = await Page(admin, $"admin/alerts?dashboard=true&search={refs["NP"]}&status=Acknowledged&countryCode=NP");
        Assert.Equal(1, acknowledged.GetProperty("total").GetInt32());
        Assert.Equal(JsonValueKind.Null, acknowledged.GetProperty("items")[0].GetProperty("alert").GetProperty("resolvedAt").ValueKind);
        Assert.Equal(1, (await Page(admin, $"admin/audit?includeTotal=true&action=AlertAcknowledged&search={alertIds["NP"]}&countryCode=NP")).GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task UserDirectoryFiltersBeforePagingAndSortsByAccountDate()
    {
        using var admin = await fixture.Login("admin");
        Guid organisationId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            organisationId = await db.Set<OrganisationCountry>().Where(o => o.CountryCode == "LK" && o.VerificationState == "LegacyActive").Select(o => o.OrganisationId).FirstAsync();
        }
        var emailPrefix = "directory-" + Guid.NewGuid().ToString("N");
        for (var index = 0; index <= 10; index++)
        {
            var name = index == 0 ? "Alpha" : $"Zulu {index}";
            var response = await admin.PostAsJsonAsync("/api/v1/admin/users", new
            {
                email = $"{emailPrefix}-{index}@example.test", name, password = fixture.Password,
                organisationId, countryCode = "LK", role = index == 0 ? Roles.CountryAdministrator : Roles.Coordinator
            });
            response.EnsureSuccessStatusCode();
        }
        var url = $"/api/v1/admin/users?countryCode=LK&search={emailPrefix}&includeTotal=true";
        var first = await admin.GetFromJsonAsync<JsonElement>(url);
        var second = await admin.GetFromJsonAsync<JsonElement>(url + "&page=2");
        Assert.Equal(11, first.GetProperty("total").GetInt32());
        Assert.Equal(10, first.GetProperty("items").GetArrayLength());
        Assert.Equal("Zulu 10", first.GetProperty("items")[0].GetProperty("name").GetString());
        Assert.Equal(1, second.GetProperty("items").GetArrayLength());
        Assert.Equal("Alpha", second.GetProperty("items")[0].GetProperty("name").GetString());
        Assert.True(first.GetProperty("items")[0].GetProperty("createdAt").GetDateTimeOffset()
            > second.GetProperty("items")[0].GetProperty("createdAt").GetDateTimeOffset());
        var filtered = await admin.GetFromJsonAsync<JsonElement>(url + "&role=CountryAdministrator");
        Assert.Equal(1, filtered.GetProperty("total").GetInt32());
        Assert.Equal("Alpha", filtered.GetProperty("items")[0].GetProperty("name").GetString());
    }

    async Task<(string Id, HttpClient Client)> Staff(string role, string country = "LK", bool citizen = false)
    {
        using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>(); var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var email = Guid.NewGuid().ToString("N"); var u = new AppUser { UserName = email + "@surakuma.test", Email = email + "@surakuma.test", DisplayName = "Test administrator", IsSystemAdministrator = role == Roles.Administrator };
        Assert.True((await users.CreateAsync(u, fixture.Password)).Succeeded); Assert.True((await users.AddToRoleAsync(u, role)).Succeeded);
        if (citizen) Assert.True((await users.AddToRoleAsync(u, Roles.Citizen)).Succeeded);
        if (!u.IsSystemAdministrator)
            db.Add(new Membership { UserId = u.Id, Role = role, OrganisationId = role == Roles.CountryAdministrator ? null : (await db.Set<Organisation>().FirstAsync()).Id, CountryCode = country });
        await db.SaveChangesAsync();
        return (u.Id, await fixture.Login(email));
    }
    [Fact]
    public async Task CountryAdministratorCannotRevokeTheirOwnGrant()
    {
        var (id, countryAdmin) = await Staff(Roles.CountryAdministrator);
        using var client = countryAdmin;
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var grantId = await db.Set<Membership>().Where(m => m.UserId == id).Select(m => m.Id).SingleAsync();
        var response = await client.DeleteAsync($"/api/v1/admin/memberships/{grantId}");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True(await db.Set<Membership>().AnyAsync(m => m.Id == grantId));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/admin/users?countryCode=LK")).StatusCode);
    }

    [Fact]
    public async Task CountryDirectoryIncludesLocalRequestersAndExcludesForeignAccountsAndGrants()
    {
        var (localId, countryAdmin) = await Staff(Roles.CountryAdministrator);
        var (foreignId, foreignStaff) = await Staff(Roles.Coordinator, "NP");
        using var countryClient = countryAdmin;
        using var foreignClient = foreignStaff;
        using var globalAdmin = await fixture.Login("admin");
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var localGrant = await db.Set<Membership>().SingleAsync(m => m.UserId == localId);
            db.Add(new Membership
            {
                UserId = localId, OrganisationId = localGrant.OrganisationId, CountryCode = "NP",
                Role = Roles.Coordinator
            });
            await db.SaveChangesAsync();
        }

        const string directory = "/api/v1/admin/users?includeTotal=true&pageSize=100&countryCode=";
        var local = (await countryClient.GetFromJsonAsync<JsonElement>(directory + "LK")).GetProperty("items");
        Assert.Contains(local.EnumerateArray(), row => row.GetProperty("email").GetString() == "citizen@surakuma.test");
        Assert.DoesNotContain(local.EnumerateArray(), row => row.GetProperty("id").GetString() == foreignId);
        Assert.All(local.EnumerateArray().SelectMany(row => row.GetProperty("memberships").EnumerateArray()),
            grant => Assert.Equal("LK", grant.GetProperty("countryCode").GetString()));
        Assert.Equal(HttpStatusCode.Forbidden, (await countryClient.GetAsync(directory + "NP")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await countryClient.GetAsync(directory)).StatusCode);

        var globalInSriLanka = (await globalAdmin.GetFromJsonAsync<JsonElement>(directory + "LK")).GetProperty("items");
        Assert.DoesNotContain(globalInSriLanka.EnumerateArray(), row => row.GetProperty("id").GetString() == foreignId);
        var bothCountries = Assert.Single(globalInSriLanka.EnumerateArray(), row => row.GetProperty("id").GetString() == localId);
        Assert.Equal("LK", Assert.Single(bothCountries.GetProperty("memberships").EnumerateArray()).GetProperty("countryCode").GetString());

        var global = (await globalAdmin.GetFromJsonAsync<JsonElement>(directory)).GetProperty("items");
        Assert.Contains(global.EnumerateArray(), row => row.GetProperty("id").GetString() == foreignId);
        var localAdminRow = Assert.Single(global.EnumerateArray(), row => row.GetProperty("id").GetString() == localId);
        Assert.Contains(localAdminRow.GetProperty("memberships").EnumerateArray(),
            grant => grant.GetProperty("countryCode").GetString() == "NP");
    }

    [Fact]
    public async Task SuspensionInvalidatesTokensPreservesCitizenAndWholeAccountDisablesLogin()
    {
        using var admin = await fixture.Login("admin"); var (id, staff) = await Staff(Roles.CaseManager, citizen: true);
        using (staff)
        {
            Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync($"/api/v1/admin/users/{id}/staff-status", new { active = false, reason = "Leave" })).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await staff.GetAsync("/api/v1/auth/me")).StatusCode);
            using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var u = await db.Users.FindAsync(id); using var login = fixture.Client(); var response = await login.PostAsJsonAsync("/api/v1/auth/login", new { email = u!.Email, password = fixture.Password });
            var body = await response.Content.ReadFromJsonAsync<JsonElement>(); Assert.Equal(new[] { "Citizen" }, body.GetProperty("user").GetProperty("roles").EnumerateArray().Select(x => x.GetString()).ToArray());
            Assert.True(await db.Set<Membership>().IgnoreQueryFilters().AnyAsync(m => m.UserId == id && m.Suspended));
            Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync($"/api/v1/admin/users/{id}/account-status", new { active = false, reason = "Compromised" })).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await login.PostAsJsonAsync("/api/v1/auth/login", new { email = u.Email, password = fixture.Password })).StatusCode);
        }
    }
    [Fact]
    public async Task AccountDeletionRequiresGlobalAdminAndConfirmationAndRemovesSignInData()
    {
        using var admin = await fixture.Login("admin");
        var (countryAdminId, countryClient) = await Staff(Roles.CountryAdministrator);
        var (id, accountClient) = await Staff(Roles.Coordinator);
        using var countryAdmin = countryClient;
        using var account = accountClient;
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var email = await db.Users.Where(u => u.Id == id).Select(u => u.Email).SingleAsync();
        db.Add(new Household { UserId = id });
        db.Add(new Notification { UserId = id, EventId = Guid.NewGuid() });
        db.Add(new SecurityEmail { UserId = id, ProtectedToken = "synthetic" });
        await db.SaveChangesAsync();

        var adminId = (await admin.GetFromJsonAsync<JsonElement>("/api/v1/auth/me")).GetProperty("id").GetString()!;
        Assert.Equal(HttpStatusCode.Forbidden, await DeleteAccount(countryAdmin, id));
        Assert.Equal(HttpStatusCode.BadRequest, await DeleteAccount(admin, adminId));
        Assert.Equal(HttpStatusCode.BadRequest, await DeleteAccount(admin, id, "cancel"));
        Assert.Equal(HttpStatusCode.BadRequest, await DeleteAccount(admin, id, reason: " "));
        Assert.True(await db.Users.AnyAsync(u => u.Id == id));

        Assert.Equal(HttpStatusCode.NoContent, await DeleteAccount(admin, id));
        Assert.False(await db.Users.AnyAsync(u => u.Id == id));
        Assert.True(await db.Users.AnyAsync(u => u.Id == countryAdminId));
        Assert.False(await db.UserRoles.AnyAsync(r => r.UserId == id));
        Assert.False(await db.Set<Membership>().IgnoreQueryFilters().AnyAsync(m => m.UserId == id));
        Assert.False(await db.Set<Household>().AnyAsync(h => h.UserId == id));
        Assert.False(await db.Set<Notification>().AnyAsync(n => n.UserId == id));
        Assert.False(await db.Set<SecurityEmail>().AnyAsync(e => e.UserId == id));
        Assert.False(await db.Set<RefreshSession>().AnyAsync(s => s.UserId == id));
        Assert.True(await db.Set<AuditEvent>().AnyAsync(a =>
            a.ActorId == adminId && a.Action == "AccountDeleted" && a.Detail == $"{id}: Duplicate test account"));
        Assert.Equal(HttpStatusCode.Unauthorized, (await account.GetAsync("/api/v1/auth/me")).StatusCode);
        using var freshLogin = fixture.Client();
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await freshLogin.PostAsJsonAsync("/api/v1/auth/login", new { email, password = fixture.Password })).StatusCode);
    }

    [Fact]
    public async Task AccountDeletionPreservesLinkedAssistanceRecords()
    {
        using var admin = await fixture.Login("admin");
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var assistance = await db.Set<AssistanceRequest>().FirstAsync();
        var response = await DeleteAccount(admin, assistance.CitizenId);
        Assert.Equal(HttpStatusCode.BadRequest, response);
        Assert.True(await db.Users.AnyAsync(u => u.Id == assistance.CitizenId));
        Assert.True(await db.Set<AssistanceRequest>().AnyAsync(r => r.Id == assistance.Id));
    }

    private static async Task<HttpStatusCode> DeleteAccount(
        HttpClient client, string id, string confirmation = "DELETE", string reason = "Duplicate test account")
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, $"/api/v1/admin/users/{id}")
        {
            Content = JsonContent.Create(new { confirmation, reason })
        };
        using var response = await client.SendAsync(request);
        return response.StatusCode;
    }

    [Fact]
    public async Task CountryAdministratorPublishesLocalSettingsAndNotifiesSystemAdministrators()
    {
        using var admin = await fixture.Login("admin");
        using var citizen = await fixture.Login("citizen");
        using var publicClient = fixture.Client();
        var (actorId, countryAdmin) = await Staff(Roles.CountryAdministrator, "NP");
        using var actor = countryAdmin;
        var contacts = new[] { new { label = "Test response desk", number = "1234", sourceUrl = "https://example.test/contact" } };
        var settings = new { languages = "en,ne", requiredAlertLanguages = "en,ne", contacts };
        const string notificationText = "Public services settings for Nepal were published.";

        Assert.Equal(HttpStatusCode.Forbidden, (await actor.PutAsJsonAsync("/api/v1/countries/LK/services", settings)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await citizen.PutAsJsonAsync("/api/v1/countries/NP/services", settings)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await actor.GetAsync("/api/v1/admin/approvals")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await actor.PutAsJsonAsync("/api/v1/countries/NP/services", settings)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await actor.PutAsJsonAsync("/api/v1/countries/NP/services", settings)).StatusCode);

        var countries = await publicClient.GetFromJsonAsync<JsonElement>("/api/v1/countries");
        var nepal = countries.EnumerateArray().Single(c => c.GetProperty("code").GetString() == "NP");
        Assert.Equal("en,ne", nepal.GetProperty("requiredAlertLanguages").GetString());
        Assert.Contains("Test response desk", nepal.GetProperty("emergencyContactsJson").GetString());
        var audit = (await admin.GetFromJsonAsync<JsonElement>("/api/v1/admin/audit?countryCode=NP&includeTotal=true")).GetProperty("items");
        var update = Assert.Single(audit.EnumerateArray(), e => e.GetProperty("action").GetString() == "CountryServicesConfigured");
        Assert.Equal(actorId, update.GetProperty("actorId").GetString());
        Assert.Contains("Emergency contacts updated", update.GetProperty("detail").GetString());

        var notifications = await admin.GetFromJsonAsync<JsonElement>("/api/v1/notifications?countryCode=LK&unreadOnly=true");
        var notice = Assert.Single(notifications.EnumerateArray(), n => n.GetProperty("message").GetString()!.Contains(notificationText));
        Assert.DoesNotContain(notificationText, await actor.GetStringAsync("/api/v1/notifications?countryCode=NP"));
        Assert.DoesNotContain(notificationText, await citizen.GetStringAsync("/api/v1/notifications?countryCode=NP"));
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"/api/v1/notifications/{notice.GetProperty("id").GetGuid()}/read?countryCode=LK", null)).StatusCode);
        Assert.DoesNotContain(notificationText, await admin.GetStringAsync("/api/v1/notifications?countryCode=LK&unreadOnly=true"));
    }

    [Fact]
    public async Task SystemAdministratorAccessStillRequiresDifferentAdminAndCannotApplyTwice()
    {
        using var admin = await fixture.Login("admin"); var (_, other) = await Staff(Roles.Administrator);
        var (targetId, targetClient) = await Staff(Roles.CountryAdministrator);
        using var target = targetClient;
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var email = await db.Users.Where(u => u.Id == targetId).Select(u => u.Email).SingleAsync();
        var legacy = new AdminProposal { Kind = "CountryServices", CountryCode = "LK", Reason = "Legacy settings request" };
        db.Add(legacy);
        await db.SaveChangesAsync();
        using (other)
        {
            var response = await admin.PostAsJsonAsync("/api/v1/admin/users", new { email, role = Roles.Administrator, countryCode = "NP" });
            response.EnsureSuccessStatusCode();
            var id = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
            var requests = await other.GetStringAsync("/api/v1/admin/approvals?countryCode=");
            Assert.Contains(id.ToString(), requests);
            Assert.DoesNotContain(legacy.Id.ToString(), requests);
            Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsJsonAsync($"/api/v1/admin/approvals/{legacy.Id}/decision", new { action = "Approve", reason = "Old request" })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/v1/admin/approvals/{id}/decision", new { action = "Approve", reason = "Checked" })).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await other.PostAsJsonAsync($"/api/v1/admin/approvals/{id}/decision", new { action = "Approve", reason = "Checked" })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await other.PostAsJsonAsync($"/api/v1/admin/approvals/{id}/decision", new { action = "Approve", reason = "Again" })).StatusCode);
            Assert.True(await db.ActiveSystemAdministrators.AnyAsync(u => u.Id == targetId));
        }
    }
    [Fact]
    public async Task PendingPartnerCannotReceiveStaffAndCountryAdminCannotVerify()
    {
        using var admin = await fixture.Login("admin"); var (_, national) = await Staff(Roles.CountryAdministrator);
        using (national)
        {
            var created = await admin.PostAsJsonAsync("/api/v1/admin/organisations", new { name = "Pending partner", countryCode = "LK" }); created.EnsureSuccessStatusCode(); var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
            var input = new { email = Guid.NewGuid()+"@surakuma.test", name = "Staff", password = fixture.Password, organisationId = id, countryCode = "LK", role = "CaseManager" };
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/v1/admin/users", input)).StatusCode);
            var verify = new { evidence = "Registration checked https://example.org/registration", decision = "Verified", reason = "Reviewed" };
            Assert.Equal(HttpStatusCode.Forbidden, (await national.PostAsJsonAsync($"/api/v1/admin/organisations/{id}/countries/LK/verification", verify)).StatusCode);
            Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync($"/api/v1/admin/organisations/{id}/countries/LK/verification", verify)).StatusCode);
            Assert.True((await admin.PostAsJsonAsync("/api/v1/admin/users", input)).IsSuccessStatusCode);
        }
    }
    [Fact]
    public async Task ReportsAreScopedAndCsvMatchesSummary()
    {
        var (_, national) = await Staff(Roles.CountryAdministrator);
        using (national)
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await national.GetAsync("/api/v1/admin/reports?scope=country&countryCode=NP")).StatusCode);
            var report = await national.GetFromJsonAsync<JsonElement>("/api/v1/admin/reports?scope=all&countryCode=NP");
            Assert.All(report.GetProperty("countries").EnumerateArray(), r => Assert.Equal("LK", r.GetProperty("countryCode").GetString()));
            var csv = await national.GetStringAsync("/api/v1/admin/reports/export?scope=all"); Assert.Contains("\"LK\"", csv); Assert.DoesNotContain("\"NP\"", csv);
            using var citizen = await fixture.Login("citizen"); Assert.Equal(HttpStatusCode.Forbidden, (await citizen.GetAsync("/api/v1/admin/reports?scope=all")).StatusCode);
        }
    }
    [Fact]
    public async Task RecoveryIsSingleUseAndInvalidatesExistingSession()
    {
        var (id, client) = await Staff(Roles.CaseManager);
        using (client)
        {
            using var scope = fixture.Factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>(); var u = await db.Users.FindAsync(id); using var anonymous = fixture.Client();
            Assert.Equal(HttpStatusCode.Accepted, (await anonymous.PostAsJsonAsync("/api/v1/auth/forgot-password", new { email = u!.Email })).StatusCode);
            var email = await db.Set<SecurityEmail>().SingleAsync(e => e.UserId == id);
            var token = scope.ServiceProvider.GetRequiredService<IDataProtectionProvider>().CreateProtector("Surakuma.PasswordRecovery").Unprotect(email.ProtectedToken);
            var reset = new { email = u.Email, token, password = "Updated!" + Guid.NewGuid().ToString("N") };
            Assert.Equal(HttpStatusCode.NoContent, (await anonymous.PostAsJsonAsync("/api/v1/auth/reset-password", reset)).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await anonymous.PostAsJsonAsync("/api/v1/auth/reset-password", reset)).StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/v1/auth/me")).StatusCode);
        }
    }
    [Fact]
    public async Task ReviewRecoveryRequiresProviderCheckAndAlertsDeduplicate()
    {
        Guid id;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>(); var request = await db.Set<AssistanceRequest>().FirstAsync();
            var m = new OutboxMessage { RequestId = request.Id, UserId = request.CitizenId, State = "Review", Attempts = 1, CycleAttempts = 1 }; db.Add(m); await db.SaveChangesAsync(); id = m.Id;
        }
        using var admin = await fixture.Login("admin");
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/v1/admin/delivery-management/{id}", new { action = "Retry", reason = "Unknown", confirmedNotDelivered = false })).StatusCode);
        var worker = new AdministrationWorker(fixture.Factory.Services.GetRequiredService<IServiceScopeFactory>(), NullLogger<AdministrationWorker>.Instance);
        await worker.Evaluate(default); await worker.Evaluate(default);
        using (var scope = fixture.Factory.Services.CreateScope()) Assert.Equal(1, await scope.ServiceProvider.GetRequiredService<CrisisDbContext>().Set<AdminAlert>().CountAsync(a => a.ConditionKey == "delivery:" + id && a.ResolvedAt == null));
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync($"/api/v1/admin/delivery-management/{id}", new { action = "Retry", reason = "Provider confirmed rejection", confirmedNotDelivered = true })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/v1/admin/delivery-management/{id}", new { action = "Retry", reason = "Duplicate click", confirmedNotDelivered = true })).StatusCode);
        await worker.Evaluate(default);
        using (var scope = fixture.Factory.Services.CreateScope()) Assert.True(await scope.ServiceProvider.GetRequiredService<CrisisDbContext>().Set<AdminAlert>().AnyAsync(a => a.ConditionKey == "delivery:" + id && a.ResolvedAt != null));
    }
    [Fact]
    public async Task ProviderAndAccessAlertsRespectThresholdsAndResolveAfterRecovery()
    {
        var service = "test-provider-" + Guid.NewGuid().ToString("N");
        var actor = Guid.NewGuid().ToString();
        var worker = new AdministrationWorker(fixture.Factory.Services.GetRequiredService<IServiceScopeFactory>(), NullLogger<AdministrationWorker>.Instance);
        using (var scope = fixture.Factory.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            db.AddRange(new ServiceObservation { Service = service }, new ServiceObservation { Service = service });
            for (var i = 0; i < 4; i++) db.Add(new ServiceObservation { Service = "AdministrativeAccess", ActorId = actor });
            await db.SaveChangesAsync();
        }
        await worker.Evaluate(default);
        using (var scope = fixture.Factory.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            Assert.False(await db.Set<AdminAlert>().AnyAsync(a => a.ConditionKey == "service:" + service + ":"));
            Assert.False(await db.Set<AdminAlert>().AnyAsync(a => a.ConditionKey == "service:AdministrativeAccess:" + actor));
            db.Add(new ServiceObservation { Service = service }); db.Add(new ServiceObservation { Service = "AdministrativeAccess", ActorId = actor }); await db.SaveChangesAsync();
        }
        await worker.Evaluate(default);
        using (var scope = fixture.Factory.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            Assert.True(await db.Set<AdminAlert>().AnyAsync(a => a.ConditionKey == "service:" + service + ":" && a.ResolvedAt == null));
            Assert.True(await db.Set<AdminAlert>().AnyAsync(a => a.ConditionKey == "service:AdministrativeAccess:" + actor && a.ResolvedAt == null));
            db.Add(new ServiceObservation { Service = service, Success = true });
            foreach (var entry in await db.Set<ServiceObservation>().Where(o => o.ActorId == actor).ToListAsync()) entry.CreatedAt = DateTimeOffset.UtcNow.AddMinutes(-11);
            await db.SaveChangesAsync();
        }
        await worker.Evaluate(default);
        using (var scope = fixture.Factory.Services.CreateScope()) {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            Assert.True(await db.Set<AdminAlert>().AnyAsync(a => a.ConditionKey == "service:" + service + ":" && a.ResolvedAt != null));
            Assert.True(await db.Set<AdminAlert>().AnyAsync(a => a.ConditionKey == "service:AdministrativeAccess:" + actor && a.ResolvedAt != null));
        }
    }

}
