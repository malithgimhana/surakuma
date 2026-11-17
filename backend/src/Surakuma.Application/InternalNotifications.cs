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
            && ((n.CrisisId == null && systemAdministrators.Contains(userId))
            || crises.Any(c => c.Id == n.CrisisId && (country == null || c.CountryCode == country)
                && (systemAdministrators.Contains(userId) || grants.Any(m =>
                    m.CountryCode == c.CountryCode && (m.CrisisId == null || m.CrisisId == c.Id)
                    && (m.Role == Roles.CountryAdministrator ||
                        (n.TaskId != null && tasks.Any(t => t.Id == n.TaskId && volunteers.Any(v => v.Id == t.VolunteerId
                                && v.UserId == userId && v.CountryCode == c.CountryCode && v.OrganisationId == m.OrganisationId && m.Role == Roles.Volunteer))
                            || (n.TaskId == null && n.RequestId != null && requests.Any(r => r.Id == n.RequestId && m.Role != Roles.Volunteer
                                    && (r.OrganisationId == m.OrganisationId ||
                                        (m.Role == Roles.Coordinator && assignments.Any(a => a.CrisisId == c.Id && a.UserId == userId)))))
                            || (n.TaskId == null && n.RequestId == null && m.Role == Roles.Coordinator))))))));
    }

    public async Task RequestChanged(AssistanceRequest request, string message, CancellationToken ct)
    {
        var crisis = await store.FindAsync<Crisis>(request.CrisisId, ct) ?? throw new MissingException();
        var assignments = store.Query<CrisisAssignment>();
        var recipients = await store.ListAsync(store.Query<Membership>().Where(m =>
            m.Role != Roles.Citizen && m.Role != Roles.Volunteer
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

    public void TaskAssigned(VolunteerTask task, VolunteerProfile volunteer, AssistanceRequest request)
        => Add([volunteer.UserId], request.CrisisId, request.Id, task.Id, $"Task assigned: {task.Title} ({request.Reference}).");

    public async Task CountryServicesChanged(Country country, string actorId, CancellationToken ct)
    {
        var recipients = await store.ListAsync(store.ActiveSystemAdministratorIds.Where(id => id != actorId), ct);
        Add(recipients, null, null, null, $"Public services settings for {country.Name} were published. See Activity for the change record.");
    }

    private void Add(IEnumerable<string> recipients, Guid? crisisId, Guid? requestId, Guid? taskId, string message)
    {
        var eventId = Guid.NewGuid();
        foreach (var userId in recipients)
            store.Add(new Notification { UserId = userId, EventId = eventId, IsInternal = true,
                CrisisId = crisisId, RequestId = requestId, TaskId = taskId, Message = message[..Math.Min(message.Length, 4000)] });
    }
}
