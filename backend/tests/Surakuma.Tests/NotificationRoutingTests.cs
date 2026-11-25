using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;
using Record = Surakuma.Domain.Record;

namespace Surakuma.Tests;

public sealed class NotificationRoutingTests
{
    [Fact]
    public void CitizenEmailExcludesInternalMixedAndUnassignedAccounts()
    {
        Assert.True(NotificationChannels.ReceivesCitizenEmail([Roles.Citizen]));
        Assert.False(NotificationChannels.ReceivesCitizenEmail([]));
        foreach (var role in Roles.All.Where(role => role != Roles.Citizen))
        {
            Assert.False(NotificationChannels.ReceivesCitizenEmail([role]));
            Assert.True(NotificationChannels.ReceivesCitizenEmail([Roles.Citizen, role]));
        }
    }
    private sealed class Store : IStore
    {
        public List<Record> Rows { get; } = [];
        public List<string> Administrators { get; } = [];
        public IQueryable<string> ActiveSystemAdministratorIds => Administrators.AsQueryable();
        public IQueryable<T> Query<T>() where T : Record => Rows.OfType<T>().AsQueryable();
        public Task<List<T>> ListAsync<T>(IQueryable<T> query, CancellationToken ct = default) => Task.FromResult(query.ToList());
        public Task<T?> FindAsync<T>(Guid id, CancellationToken ct = default) where T : Record => Task.FromResult(Query<T>().SingleOrDefault(x => x.Id == id));
        public void Add<T>(T entity) where T : Record => Rows.Add(entity);
        public void Remove<T>(T entity) where T : Record => Rows.Remove(entity);
        public Task SaveAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task<T> TransactionAsync<T>(Func<Task<T>> operation, CancellationToken ct = default) => operation();
        public Task<T> RoutingTransactionAsync<T>(Func<Task<T>> operation, CancellationToken ct = default) => operation();
        public Task<T> FeedbackTransactionAsync<T>(Guid requestId, Func<Task<T>> operation, CancellationToken ct = default) => operation();
    }

    [Fact]
    public async Task CaseEventsNotifyAuthorizedInternalUsersOnceAndRespectRevokedAccess()
    {
        var store = new Store();
        var crisis = new Crisis { CountryCode = "NP" };
        var request = new AssistanceRequest { CrisisId = crisis.Id, OrganisationId = Guid.NewGuid(), CitizenId = "citizen", AssignedCaseManagerId = "owner" };
        var depot = Guid.NewGuid();
        var local = new Membership { UserId = "local", Role = Roles.Logistics, CountryCode = "NP", OrganisationId = request.OrganisationId.Value, DepotId = depot };
        store.Rows.AddRange([crisis, request, local,
            new Membership { UserId = "owner", Role = Roles.CaseManager, CountryCode = "NP", OrganisationId = local.OrganisationId },
            new Membership { UserId = "peer", Role = Roles.CaseManager, CountryCode = "NP", OrganisationId = local.OrganisationId },
            new Membership { UserId = "shelter", Role = Roles.ShelterAdmin, CountryCode = "NP", OrganisationId = local.OrganisationId },
            new Membership { UserId = "other-depot", Role = Roles.Logistics, CountryCode = "NP", OrganisationId = local.OrganisationId, DepotId = Guid.NewGuid() },
            new Membership { UserId = "owner", Role = Roles.Partner, CountryCode = "NP", OrganisationId = local.OrganisationId },
            new Membership { UserId = "foreign", Role = Roles.Logistics, CountryCode = "LK", OrganisationId = local.OrganisationId },
            new Membership { UserId = "other-crisis", Role = Roles.Coordinator, CountryCode = "NP", CrisisId = Guid.NewGuid(), OrganisationId = local.OrganisationId },
            new Membership { UserId = "citizen", Role = Roles.Citizen, CountryCode = "NP", OrganisationId = local.OrganisationId }]);
        store.Administrators.Add("admin");
        var notifications = new InternalNotifications(store);
        await notifications.RequestChanged(request, "Request verified.", default);
        var verification = Assert.Single(store.Query<Notification>());
        Assert.Equal("owner", verification.UserId);
        Assert.Equal(Roles.CaseManager, verification.ScopeRole);
        Assert.Empty(notifications.Visible("owner", "NP", Roles.Partner));
        await notifications.RequestChanged(request, "Shipment confirmed.", default, dispatchUpdate: true, depotId: depot);
        Assert.Equal(new[] { "local", "owner", "owner" }, store.Query<Notification>().Select(n => n.UserId).Order().ToArray());
        Assert.Empty(store.Query<OutboxMessage>());
        Assert.Single(notifications.Visible("local", "NP"));
        Assert.Empty(notifications.Visible("local", "LK"));
        request.AssignedCaseManagerId = "peer";
        Assert.Empty(notifications.Visible("owner", "NP"));
        store.Rows.RemoveAll(r => r is Membership m && m.UserId == "local");
        Assert.Empty(notifications.Visible("local", "NP"));
        Assert.Empty(notifications.Visible("admin", "NP"));
    }

    [Fact]
    public void VolunteerAssignmentIsVisibleOnlyWithCurrentVolunteerGrant()
    {
        var store = new Store();
        var crisis = new Crisis();
        var request = new AssistanceRequest { CrisisId = crisis.Id };
        var volunteer = new VolunteerProfile { UserId = "volunteer", OrganisationId = Guid.NewGuid() };
        var task = new VolunteerTask { VolunteerId = volunteer.Id, RequestId = request.Id, Title = "Medical assistance" };
        var grant = new Membership { UserId = volunteer.UserId, OrganisationId = volunteer.OrganisationId, Role = Roles.Volunteer };
        store.Rows.AddRange([crisis, request, volunteer, task, grant,
            new Notification { UserId = volunteer.UserId, RequestId = request.Id, Message = "Old citizen notification" }]);
        var notifications = new InternalNotifications(store);
        notifications.TaskAssigned(task, volunteer, request);
        Assert.Equal(task.Id, Assert.Single(notifications.Visible(volunteer.UserId, "LK")).TaskId);
        Assert.Empty(notifications.Visible("someone-else", "LK"));
        store.Rows.Remove(grant);
        Assert.Empty(notifications.Visible(volunteer.UserId, "LK"));
    }

    [Fact]
    public async Task PartnerAssignmentDisappearsWhenTheSharedCaseIsRevoked()
    {
        var store = new Store();
        var organisation = Guid.NewGuid();
        var crisis = new Crisis { CountryCode = "LK" };
        var share = new CaseShare { RequestId = Guid.NewGuid(), OrganisationId = organisation };
        store.Rows.AddRange([crisis, share,
            new OrganisationCountry { OrganisationId = organisation, CountryCode = "LK", VerificationState = "Verified" },
            new Membership { UserId = "partner", Role = Roles.Partner, CountryCode = "LK", OrganisationId = organisation },
            new Membership { UserId = "other-partner", Role = Roles.Partner, CountryCode = "LK", OrganisationId = Guid.NewGuid() }]);
        var notifications = new InternalNotifications(store);
        await notifications.PartnerChanged(organisation, "LK", crisis.Id, "New partner assignment.", false, default, requestId: share.RequestId);
        Assert.Equal("partner", Assert.Single(store.Query<Notification>()).UserId);
        Assert.Single(notifications.Visible("partner", "LK", Roles.Partner));
        store.Rows.Remove(share);
        Assert.Empty(notifications.Visible("partner", "LK", Roles.Partner));
    }

    [Fact]
    public async Task AlertReviewGoesToIndependentAdministratorsAndDecisionReturnsToTheAuthor()
    {
        var store = new Store();
        var crisis = new Crisis { CountryCode = "LK" };
        store.Rows.AddRange([crisis,
            new Membership { UserId = "author", Role = Roles.Coordinator, CountryCode = "LK" },
            new CrisisAssignment { UserId = "author", CrisisId = crisis.Id },
            new Membership { UserId = "reviewer", Role = Roles.CountryAdministrator, CountryCode = "LK" },
            new Membership { UserId = "foreign", Role = Roles.CountryAdministrator, CountryCode = "NP" }]);
        store.Administrators.Add("publisher");
        var notifications = new InternalNotifications(store);
        await notifications.AlertChanged(crisis, "Independent review is required.", true, default, "publisher", "author");
        Assert.Equal("reviewer", Assert.Single(store.Query<Notification>()).UserId);
        await notifications.AlertReviewDecided(crisis, "author", approved: true, default);
        Assert.Contains("approved for publication", Assert.Single(notifications.Visible("author", "LK", Roles.Coordinator)).Message);
    }

    [Fact]
    public async Task NewCrisesNotifyAdministratorsWhoCanAssignCoordinators()
    {
        var store = new Store();
        var crisis = new Crisis { CountryCode = "IN" };
        store.Rows.AddRange([crisis,
            new Membership { UserId = "india", CountryCode = "IN", Role = Roles.CountryAdministrator },
            new Membership { UserId = "nepal", CountryCode = "NP", Role = Roles.CountryAdministrator },
            new Membership { UserId = "coordinator", CountryCode = "IN", Role = Roles.Coordinator },
            new Membership { UserId = "citizen", CountryCode = "IN", Role = Roles.Citizen }]);
        var notifications = new InternalNotifications(store);
        await notifications.CrisisCreated(crisis, default);
        Assert.Equal("india", Assert.Single(store.Query<Notification>()).UserId);
    }

    [Fact]
    public void ScopedInboxTranslatesToSqlWithoutExecutingDatabaseQueries()
    {
        using var db = new CrisisDbContext(new DbContextOptionsBuilder<CrisisDbContext>()
            .UseSqlServer("Server=localhost;Database=Unused;Trusted_Connection=True;TrustServerCertificate=True").Options);
        var sql = new InternalNotifications(new EfStore(db)).Visible("staff", "NP").ToQueryString();
        Assert.Contains("IsInternal", sql);
        Assert.Contains("Membership", sql);
        Assert.Contains("VolunteerTask", sql);
    }
}

public sealed class NotificationBackfillIntegrationTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task UpgradeNotifiesAdministratorsAboutPreviouslySavedPendingEvidenceOnce()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var migrator = db.GetService<IMigrator>();
        await migrator.MigrateAsync("20261122120000_StaffInvitationEmail");
        var partner = new Organisation { Name = "Partner awaiting review before the upgrade" };
        var unreviewed = new OrganisationCountry { OrganisationId = partner.Id, CountryCode = "LK", Evidence = "Registration certificate checked." };
        var emptyPartner = new Organisation { Name = "Partner without evidence" };
        db.AddRange(partner, unreviewed, emptyPartner, new OrganisationCountry { OrganisationId = emptyPartner.Id, CountryCode = "LK" });
        await db.SaveChangesAsync();

        await migrator.MigrateAsync();
        await migrator.MigrateAsync();
        using var admin = await fixture.Login("admin");
        var inbox = await admin.GetFromJsonAsync<Notification[]>("/api/v1/notifications?countryCode=LK") ?? [];
        var review = Assert.Single(inbox, n => n.ScopeOrganisationId == partner.Id);
        Assert.Equal(unreviewed.Id, review.EventId);
        Assert.Contains("Verification evidence was submitted", review.Message);
        Assert.DoesNotContain(inbox, n => n.ScopeOrganisationId == emptyPartner.Id);
    }
}

public sealed class MixedRoleNotificationIntegrationTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task MixedRoleInboxCountAndReadActionsStayInTheirWorkspace()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var request = await db.Set<AssistanceRequest>().SingleAsync(r => r.SubmissionKey == "seed-food");
        var user = await users.FindByIdAsync(request.CitizenId);
        Assert.True((await users.AddToRoleAsync(user!, Roles.Logistics)).Succeeded);
        db.Add(new Membership { UserId = request.CitizenId, Role = Roles.Logistics, OrganisationId = request.OrganisationId, CountryCode = "LK" });
        var citizenNotice = new Notification { UserId = request.CitizenId, RequestId = request.Id, EventId = Guid.NewGuid() };
        var shipmentNotice = new Notification { UserId = request.CitizenId, EventId = Guid.NewGuid(), IsInternal = true,
            ScopeRole = Roles.Logistics, ScopeCountryCode = "LK", ScopeOrganisationId = request.OrganisationId };
        db.AddRange(citizenNotice, shipmentNotice);
        await db.SaveChangesAsync();

        using var client = await fixture.Login("citizen");
        const string citizenScope = "?countryCode=LK&inboxRole=Citizen";
        const string logisticsScope = "?countryCode=LK&inboxRole=Logistics";
        const string inbox = "/api/v1/notifications";
        Assert.Equal(citizenNotice.Id, Assert.Single((await client.GetFromJsonAsync<Notification[]>(inbox + citizenScope))!).Id);
        Assert.Equal(shipmentNotice.Id, Assert.Single((await client.GetFromJsonAsync<Notification[]>(inbox + logisticsScope))!).Id);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync(inbox + "?countryCode=LK&inboxRole=Administrator")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync($"{inbox}/{shipmentNotice.Id}/read" + citizenScope, null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync(inbox + "/read-all" + citizenScope, null)).StatusCode);
        Assert.Equal(0, (await client.GetFromJsonAsync<JsonElement>(inbox + "/unread-count" + citizenScope)).GetProperty("count").GetInt32());
        Assert.Equal(1, (await client.GetFromJsonAsync<JsonElement>(inbox + "/unread-count" + logisticsScope)).GetProperty("count").GetInt32());
    }
}

public sealed class NotificationInboxIntegrationTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task ReadAllClearsTheCurrentInboxBeyondTheListLimit()
    {
        using var scope = fixture.Factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var request = await db.Set<AssistanceRequest>().SingleAsync(r => r.SubmissionKey == "seed-food");
        var nepal = new Crisis { CountryCode = "NP", Name = "Nepal test crisis" };
        var nepalRequest = new AssistanceRequest { CitizenId = request.CitizenId, CrisisId = nepal.Id, SubmissionKey = "inbox-np" };
        var adminId = await db.Users.Where(u => u.UserName == "admin@surakuma.test").Select(u => u.Id).SingleAsync();
        db.AddRange(nepal, nepalRequest);
        db.AddRange(Enumerable.Range(0, 101).Select(_ => new Notification
        {
            UserId = request.CitizenId,
            RequestId = request.Id,
            EventId = Guid.NewGuid()
        }));
        db.AddRange(
            new Notification { UserId = request.CitizenId, RequestId = nepalRequest.Id, EventId = Guid.NewGuid() },
            new Notification { UserId = adminId, IsInternal = true, CrisisId = request.CrisisId, EventId = Guid.NewGuid() });
        await db.SaveChangesAsync();

        const string readAll = "/api/v1/notifications/read-all?countryCode=LK";
        using var anonymous = fixture.Client();
        using var citizen = await fixture.Login("citizen");
        using var admin = await fixture.Login("admin");
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsync(readAll, null)).StatusCode);
        Assert.Equal(101, await UnreadCount(citizen, "LK"));
        Assert.Equal(HttpStatusCode.NoContent, (await citizen.PostAsync(readAll, null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await citizen.PostAsync(readAll, null)).StatusCode);
        Assert.Equal(0, await UnreadCount(citizen, "LK"));
        const string inbox = "/api/v1/notifications?countryCode=LK";
        Assert.Empty(await citizen.GetFromJsonAsync<Notification[]>(inbox + "&unreadOnly=true") ?? []);
        var history = await citizen.GetFromJsonAsync<Notification[]>(inbox);
        Assert.Equal(100, history!.Length);
        Assert.All(history, item => Assert.True(item.Read));

        var olderUnread = new Notification
        {
            UserId = request.CitizenId,
            RequestId = request.Id,
            EventId = Guid.NewGuid(),
            CreatedAt = DateTimeOffset.UtcNow.AddDays(-1)
        };
        db.Add(olderUnread);
        await db.SaveChangesAsync();
        var unreadInbox = await citizen.GetFromJsonAsync<Notification[]>(inbox + "&unreadOnly=true");
        Assert.Equal(olderUnread.Id, Assert.Single(unreadInbox!).Id);

        Assert.Equal(1, await UnreadCount(citizen, "NP"));
        Assert.Equal(1, await UnreadCount(admin, "LK"));
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync(readAll, null)).StatusCode);
        Assert.Equal(0, await UnreadCount(admin, "LK"));
    }

    private static async Task<int> UnreadCount(HttpClient client, string country)
    {
        var result = await client.GetFromJsonAsync<JsonElement>($"/api/v1/notifications/unread-count?countryCode={country}");
        return result.GetProperty("count").GetInt32();
    }
}
