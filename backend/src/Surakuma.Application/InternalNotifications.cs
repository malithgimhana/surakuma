using Surakuma.Domain;

namespace Surakuma.Application;

public sealed class InternalNotifications(IStore store)
{
    public IQueryable<Notification> Visible(string userId, string? country)
    {
        var grants = store.Query<Membership>().Where(m => m.UserId == userId && m.Role != Roles.Citizen);
        var crises = store.Query<Crisis>();
        var requests = store.Query<AssistanceRequest>();
        var tasks = store.Query<VolunteerTask>();
        var volunteers = store.Query<VolunteerProfile>();
        var assignments = store.Query<CrisisAssignment>();
        var systemAdministrators = store.ActiveSystemAdministratorIds;
        return store.Query<Notification>().Where(n => n.IsInternal && n.UserId == userId
            && ((n.ScopeOrganisationId != null && n.ScopeCountryCode != null
                && (country == null || n.ScopeCountryCode == country)
                && (systemAdministrators.Contains(userId) || grants.Any(m => m.CountryCode == n.ScopeCountryCode &&
                    (m.Role == Roles.CountryAdministrator && m.CrisisId == null ||
                     m.Role == n.ScopeRole && m.OrganisationId == n.ScopeOrganisationId &&
                     (m.CrisisId == null || m.CrisisId == n.CrisisId) &&
                     (m.Role != Roles.Partner || store.Query<OrganisationCountry>().Any(o => o.OrganisationId == m.OrganisationId &&
                         o.CountryCode == m.CountryCode && (o.VerificationState == "Verified" || o.VerificationState == "LegacyActive")))))))
            || (n.ScopeOrganisationId == null && n.CrisisId == null && systemAdministrators.Contains(userId))
            || n.ScopeOrganisationId == null && crises.Any(c => c.Id == n.CrisisId && (country == null || c.CountryCode == country)
                && (systemAdministrators.Contains(userId) || grants.Any(m =>
                    m.CountryCode == c.CountryCode && (m.CrisisId == null || m.CrisisId == c.Id)
                    && (m.Role == Roles.CountryAdministrator ||
                        (n.TaskId != null && tasks.Any(t => t.Id == n.TaskId && volunteers.Any(v => v.Id == t.VolunteerId
                                && v.UserId == userId && v.CountryCode == c.CountryCode && v.OrganisationId == m.OrganisationId && m.Role == Roles.Volunteer))
                            || (n.TaskId == null && n.RequestId != null && requests.Any(r => r.Id == n.RequestId && m.Role != Roles.Volunteer && m.Role != Roles.Partner
                                    && (r.OrganisationId == m.OrganisationId ||
                                        (m.Role == Roles.Coordinator && assignments.Any(a => a.CrisisId == c.Id && a.UserId == userId)))))
                            || (n.TaskId == null && n.RequestId == null && m.Role == Roles.Coordinator))))))));
    }

    public async Task RequestChanged(AssistanceRequest request, string message, CancellationToken ct)
    {
        var crisis = await store.FindAsync<Crisis>(request.CrisisId, ct) ?? throw new MissingException();
        var assignments = store.Query<CrisisAssignment>();
        var recipients = await store.ListAsync(store.Query<Membership>().Where(m =>
            m.Role != Roles.Citizen && m.Role != Roles.Volunteer && m.Role != Roles.Partner
            && m.CountryCode == crisis.CountryCode && (m.CrisisId == null || m.CrisisId == crisis.Id)
            && (m.Role == Roles.CountryAdministrator || m.OrganisationId == request.OrganisationId
                || (m.Role == Roles.Coordinator && assignments.Any(a => a.CrisisId == crisis.Id && a.UserId == m.UserId))))
            .Select(m => m.UserId).Union(store.ActiveSystemAdministratorIds), ct);
        Add(recipients, crisis.Id, request.Id, null, $"{request.Reference}: {message}");
    }

    public async Task CrisisCreated(Crisis crisis, CancellationToken ct)
    {
        var recipients = await store.ListAsync(store.Query<Membership>().Where(m =>
            m.CountryCode == crisis.CountryCode
            && (m.CrisisId == null || m.CrisisId == crisis.Id)
            && (m.Role == Roles.CountryAdministrator || m.Role == Roles.Coordinator))
            .Select(m => m.UserId).Union(store.ActiveSystemAdministratorIds), ct);
        Add(recipients, crisis.Id, null, null, $"New crisis: {crisis.Name}.");
    }

    public async Task AlertChanged(Crisis crisis, string message, bool reviewersOnly, CancellationToken ct)
    {
        var assignments = store.Query<CrisisAssignment>();
        var recipients = await store.ListAsync(store.Query<Membership>().Where(m => m.CountryCode == crisis.CountryCode &&
            (m.CrisisId == null || m.CrisisId == crisis.Id) &&
            (m.Role == Roles.CountryAdministrator || !reviewersOnly && m.Role == Roles.Coordinator &&
                assignments.Any(a => a.CrisisId == crisis.Id && a.UserId == m.UserId)))
            .Select(m => m.UserId).Union(store.ActiveSystemAdministratorIds), ct);
        Add(recipients, crisis.Id, null, null, $"Public alerts · {crisis.Name}: {message}");
    }

    public void TaskAssigned(VolunteerTask task, VolunteerProfile volunteer, AssistanceRequest request)
        => Add([volunteer.UserId], request.CrisisId, request.Id, task.Id, $"Task assigned: {task.Title} ({request.Reference}).");

    public void TaskReviewed(VolunteerTask task, VolunteerProfile volunteer, AssistanceRequest request, string action)
        => Add([volunteer.UserId], request.CrisisId, request.Id, task.Id,
            $"{request.Reference}: Your volunteer report was {(action == "Verify" ? "verified" : "returned for correction")}.");

    public async Task TaskSubmitted(VolunteerProfile volunteer, AssistanceRequest request, CancellationToken ct)
    {
        var assignments = store.Query<CrisisAssignment>();
        var recipients = await store.ListAsync(store.Query<Membership>().Where(m =>
            m.CountryCode == volunteer.CountryCode && (m.CrisisId == null || m.CrisisId == request.CrisisId)
            && (m.Role == Roles.CountryAdministrator || m.OrganisationId == volunteer.OrganisationId
                && (m.Role == Roles.VolunteerCoordinator && m.OrganisationId == request.OrganisationId ||
                    m.Role == Roles.Coordinator && (m.OrganisationId == request.OrganisationId ||
                        assignments.Any(a => a.CrisisId == request.CrisisId && a.UserId == m.UserId)))))
            .Select(m => m.UserId).Union(store.ActiveSystemAdministratorIds), ct);
        Add(recipients, request.CrisisId, request.Id, null, $"{request.Reference}: A volunteer report awaits verification.", scopeRole: Roles.VolunteerCoordinator);
    }

    public async Task CountryServicesChanged(Country country, string actorId, CancellationToken ct)
    {
        var recipients = await store.ListAsync(store.ActiveSystemAdministratorIds.Where(id => id != actorId), ct);
        Add(recipients, null, null, null, $"Public services settings for {country.Name} were published. See Activity for the change record.");
    }

    public async Task PartnerChanged(Guid organisationId, string country, Guid? crisisId, string message,
        bool includeAdministrators, CancellationToken ct)
    {
        var members = store.Query<Membership>().Where(m => m.CountryCode == country &&
            (m.CrisisId == null || m.CrisisId == crisisId) && (m.Role == Roles.Partner && m.OrganisationId == organisationId ||
            includeAdministrators && m.Role == Roles.CountryAdministrator)).Select(m => m.UserId);
        var recipients = await store.ListAsync(includeAdministrators ? members.Union(store.ActiveSystemAdministratorIds) : members.Distinct(), ct);
        Add(recipients, crisisId, null, null, message, organisationId, country, Roles.Partner);
    }

    public async Task LogisticsReceipt(Resource resource, Guid? crisisId, bool hasException, CancellationToken ct)
    {
        var members = store.Query<Membership>().Where(m => m.CountryCode == resource.CountryCode &&
            (m.CrisisId == null || m.CrisisId == crisisId) &&
            (m.Role == Roles.CountryAdministrator || m.Role == Roles.Logistics && m.OrganisationId == resource.OrganisationId))
            .Select(m => m.UserId);
        var recipients = await store.ListAsync(members.Union(store.ActiveSystemAdministratorIds), ct);
        Add(recipients, crisisId, null, null,
            hasException ? $"A shipment of {resource.Name} has a delivery exception." : $"A shipment of {resource.Name} was confirmed.",
            resource.OrganisationId, resource.CountryCode, Roles.Logistics);
    }

    private void Add(IEnumerable<string> recipients, Guid? crisisId, Guid? requestId, Guid? taskId, string message,
        Guid? scopeOrganisationId = null, string? scopeCountryCode = null, string? scopeRole = null)
    {
        var eventId = Guid.NewGuid();
        foreach (var userId in recipients.Distinct())
            store.Add(new Notification { UserId = userId, EventId = eventId, IsInternal = true,
                CrisisId = crisisId, RequestId = requestId, TaskId = taskId, ScopeOrganisationId = scopeOrganisationId,
                ScopeCountryCode = scopeCountryCode, ScopeRole = scopeRole, Message = message[..Math.Min(message.Length, 4000)] });
    }
}
