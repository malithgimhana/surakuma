using Surakuma.Domain;

namespace Surakuma.Application;

public sealed class InternalNotifications(IStore store)
{
    public IQueryable<Notification> Visible(string userId, string? country, string? inboxRole = null)
    {
        var grants = store.Query<Membership>().Where(m => m.UserId == userId && (inboxRole == null || m.Role == inboxRole));
        var crises = store.Query<Crisis>();
        var requests = store.Query<AssistanceRequest>();
        var tasks = store.Query<VolunteerTask>();
        var volunteers = store.Query<VolunteerProfile>();
        var assignments = store.Query<CrisisAssignment>();
        var administrators = store.ActiveSystemAdministratorIds;
        var partners = store.Query<OrganisationCountry>();
        var shares = store.Query<CaseShare>();
        var allocations = store.Query<ResourceAllocation>();
        var resources = store.Query<Resource>();
        var inbox = store.Query<Notification>().Where(n => n.IsInternal && n.UserId == userId);
        var scoped = inbox.Where(n => n.ScopeCountryCode != null && (country == null || n.ScopeCountryCode == country) &&
            (inboxRole == null || n.ScopeRole == inboxRole) &&
            (n.ScopeRole == Roles.Administrator && administrators.Contains(userId) ||
             grants.Any(m => m.Role == n.ScopeRole && m.CountryCode == n.ScopeCountryCode &&
                (m.CrisisId == null || m.CrisisId == n.CrisisId) &&
                (m.Role == Roles.CountryAdministrator && m.CrisisId == null ||
                 m.Role == Roles.Coordinator && n.CrisisId != null && assignments.Any(a => a.CrisisId == n.CrisisId && a.UserId == userId) ||
                 m.Role != Roles.Coordinator && m.Role != Roles.CountryAdministrator && m.OrganisationId != null && m.OrganisationId == n.ScopeOrganisationId &&
                    (n.RequestId == null || m.Role == Roles.Volunteer ||
                        (m.Role == Roles.Partner ? shares.Any(s => s.RequestId == n.RequestId && s.OrganisationId == m.OrganisationId) :
                            requests.Any(r => r.Id == n.RequestId && r.OrganisationId == m.OrganisationId &&
                                (m.Role != Roles.CaseManager || r.AssignedCaseManagerId == userId)))) &&
                    (m.Role != Roles.Volunteer || tasks.Any(t => t.Id == n.TaskId && volunteers.Any(v => v.Id == t.VolunteerId && v.UserId == userId && v.CountryCode == m.CountryCode && v.OrganisationId == m.OrganisationId))) &&
                    (m.Role != Roles.Partner || partners.Any(o => o.OrganisationId == m.OrganisationId && o.CountryCode == m.CountryCode && (o.VerificationState == "Verified" || o.VerificationState == "LegacyActive"))) &&
                    (m.Role != Roles.Logistics || n.AllocationId == null || m.DepotId == null || allocations.Any(a => a.Id == n.AllocationId && resources.Any(r => r.Id == a.ResourceId && r.DepotId == m.DepotId)))))));

        // Older notifications had no scope metadata. Retain only history attributable to an existing assignment or role.
        var legacy = inbox.Where(n => n.ScopeCountryCode == null && (n.ScopeRole == null || n.ScopeRole == inboxRole || inboxRole == null));
        var adminHistory = legacy.Where(n => n.ScopeRole == null && n.RequestId == null && n.TaskId == null &&
            (inboxRole == null || inboxRole == Roles.Administrator) && administrators.Contains(userId) &&
            (n.CrisisId == null || crises.Any(c => c.Id == n.CrisisId && (country == null || c.CountryCode == country))));
        var staffHistory = legacy.Where(n => crises.Any(c => c.Id == n.CrisisId && (country == null || c.CountryCode == country) &&
            grants.Any(m => m.CountryCode == c.CountryCode && (m.CrisisId == null || m.CrisisId == c.Id) &&
                (n.TaskId != null && m.Role == Roles.Volunteer && tasks.Any(t => t.Id == n.TaskId && volunteers.Any(v => v.Id == t.VolunteerId && v.UserId == userId && v.CountryCode == c.CountryCode && v.OrganisationId == m.OrganisationId)) ||
                 n.ScopeRole == Roles.VolunteerCoordinator && m.Role == Roles.VolunteerCoordinator && requests.Any(r => r.Id == n.RequestId && r.OrganisationId == m.OrganisationId) ||
                 n.ScopeRole == null && n.TaskId == null &&
                    (n.RequestId == null && (m.Role == Roles.CountryAdministrator || m.Role == Roles.Coordinator && assignments.Any(a => a.CrisisId == c.Id && a.UserId == userId)) ||
                     m.Role == Roles.CaseManager && requests.Any(r => r.Id == n.RequestId && r.OrganisationId == m.OrganisationId && r.AssignedCaseManagerId == userId) ||
                     m.Role == Roles.Logistics && allocations.Any(a => a.Id == n.AllocationId && resources.Any(r => r.Id == a.ResourceId && r.OrganisationId == m.OrganisationId && (m.DepotId == null || r.DepotId == m.DepotId))))))));
        return scoped.Union(adminHistory).Union(staffHistory);
    }

    public async Task RequestChanged(AssistanceRequest request, string message, CancellationToken ct, bool dispatchUpdate = false,
        CaseMessageDraft? draft = null, Guid? allocationId = null, string? actionRole = null, Guid? depotId = null)
    {
        var crisis = await store.FindAsync<Crisis>(request.CrisisId, ct) ?? throw new MissingException();
        var memberships = store.Query<Membership>();
        var assignments = store.Query<CrisisAssignment>();
        var preferences = store.Query<LogisticsPreferences>();
        var grants = memberships.Where(m => m.CountryCode == crisis.CountryCode && (m.CrisisId == null || m.CrisisId == crisis.Id));
        actionRole ??= dispatchUpdate ? Roles.Logistics : null;
        var manager = request.AssignedCaseManagerId;
        var recipients = await store.ListAsync(grants.Where(m =>
            m.Role == Roles.CaseManager && manager != null && m.UserId == manager && m.OrganisationId == request.OrganisationId &&
                !memberships.Any(other => other.UserId == m.UserId && other.Role == Roles.CaseManager && other.CountryCode != m.CountryCode) ||
            m.Role == Roles.Coordinator && (actionRole == Roles.Coordinator || draft != null) &&
                assignments.Any(a => a.CrisisId == crisis.Id && a.UserId == m.UserId) ||
            actionRole != null && actionRole != Roles.Coordinator && m.Role == actionRole &&
                request.OrganisationId != null && m.OrganisationId == request.OrganisationId && (m.Role != Roles.ShelterAdmin || m.CrisisId == null) &&
                (m.Role != Roles.Logistics || (m.DepotId == null || depotId == null || m.DepotId == depotId) &&
                    !preferences.Any(p => p.UserId == m.UserId && (dispatchUpdate ? !p.DispatchUpdates : !p.AssignmentUpdates))))
            .Select(m => new { m.UserId, m.Role }).Distinct(), ct);

        var eventId = draft?.Id ?? Guid.NewGuid();
        if (actionRole == Roles.Coordinator && !recipients.Any(m => m.Role == Roles.Coordinator))
            await NotifyAdministrators(crisis.CountryCode, $"{request.Reference}: A case needs coordination.", ct, crisis.Id, request.Id);
        foreach (var recipient in recipients.OrderByDescending(m => m.Role == actionRole).DistinctBy(m => m.UserId))
        {
            store.Add(new Notification { UserId = recipient.UserId, EventId = eventId, IsInternal = true, CrisisId = crisis.Id,
                RequestId = request.Id, AllocationId = allocationId, ScopeCountryCode = crisis.CountryCode, ScopeRole = recipient.Role,
                ScopeOrganisationId = request.OrganisationId, CommunicationSource = draft?.Source,
                Message = draft is null ? LimitMessage($"{request.Reference}: {message}") : CaseCommunications.PublishedText(request.Reference, "en", draft),
                SinhalaMessage = draft is null ? "" : CaseCommunications.PublishedText(request.Reference, "si", draft),
                TamilMessage = draft is null ? "" : CaseCommunications.PublishedText(request.Reference, "ta", draft),
                HindiMessage = draft is null ? null : CaseCommunications.PublishedText(request.Reference, "hi", draft),
                NepaliMessage = draft is null ? null : CaseCommunications.PublishedText(request.Reference, "ne", draft) });
        }
    }
    public Task CrisisCreated(Crisis crisis, CancellationToken ct) =>
        NotifyAdministrators(crisis.CountryCode, $"New crisis: {crisis.Name}.", ct, crisis.Id);

    public async Task AlertChanged(Crisis crisis, string message, bool reviewersOnly, CancellationToken ct,
        string actorId, string creatorId)
    {
        var assignments = store.Query<CrisisAssignment>();
        var text = $"Public alerts · {crisis.Name}: {message}";
        if (reviewersOnly)
            await NotifyAdministrators(crisis.CountryCode, text, ct, crisis.Id, excludedUsers: [actorId, creatorId]);
        else
        {
            var coordinators = await store.ListAsync(store.Query<Membership>().Where(m => m.CountryCode == crisis.CountryCode &&
                (m.CrisisId == null || m.CrisisId == crisis.Id) && m.Role == Roles.Coordinator && m.UserId != actorId &&
                assignments.Any(a => a.CrisisId == crisis.Id && a.UserId == m.UserId)).Select(m => m.UserId).Distinct(), ct);
            Add(coordinators, crisis.Id, null, null, text, scopeCountryCode: crisis.CountryCode, scopeRole: Roles.Coordinator);
        }
    }

    public async Task AlertReviewDecided(Crisis crisis, string creatorId, bool approved, CancellationToken ct)
    {
        var role = (await store.ListAsync(store.ActiveSystemAdministratorIds.Where(id => id == creatorId), ct)).Count > 0
            ? Roles.Administrator : null;
        if (role == null)
        {
            var assignments = store.Query<CrisisAssignment>();
            var roles = await store.ListAsync(store.Query<Membership>().Where(m => m.UserId == creatorId && m.CountryCode == crisis.CountryCode &&
                (m.Role == Roles.CountryAdministrator && m.CrisisId == null ||
                 m.Role == Roles.Coordinator && (m.CrisisId == null || m.CrisisId == crisis.Id) &&
                    assignments.Any(a => a.UserId == creatorId && a.CrisisId == crisis.Id))).Select(m => m.Role).Distinct(), ct);
            role = roles.Contains(Roles.CountryAdministrator) ? Roles.CountryAdministrator : roles.FirstOrDefault();
        }
        if (role != null)
            Add([creatorId], crisis.Id, null, null, $"Public alerts · {crisis.Name}: Your alert was {(approved ? "approved for publication" : "returned for changes")}.",
                scopeCountryCode: crisis.CountryCode, scopeRole: role);
    }

    public void TaskAssigned(VolunteerTask task, VolunteerProfile volunteer, AssistanceRequest request)
        => Add([volunteer.UserId], request.CrisisId, request.Id, task.Id, $"Task assigned: {task.Title} ({request.Reference}).",
            volunteer.OrganisationId, volunteer.CountryCode, Roles.Volunteer);

    public void TaskReviewed(VolunteerTask task, VolunteerProfile volunteer, AssistanceRequest request, string action)
        => Add([volunteer.UserId], request.CrisisId, request.Id, task.Id,
            $"{request.Reference}: Your volunteer report was {(action == "Verify" ? "verified" : "returned for correction")}.",
            volunteer.OrganisationId, volunteer.CountryCode, Roles.Volunteer);

    public async Task TaskSubmitted(VolunteerTask task, VolunteerProfile volunteer, AssistanceRequest request, CancellationToken ct)
    {
        var recipients = await store.ListAsync(store.Query<Membership>().Where(m =>
            m.CountryCode == volunteer.CountryCode && (m.CrisisId == null || m.CrisisId == request.CrisisId)
            && m.Role == Roles.VolunteerCoordinator && m.UserId != volunteer.UserId && m.OrganisationId == volunteer.OrganisationId
            && m.OrganisationId == request.OrganisationId).Select(m => m.UserId).Distinct(), ct);
        Add(recipients, request.CrisisId, request.Id, task.Id, $"{request.Reference}: A volunteer report awaits verification.",
            volunteer.OrganisationId, volunteer.CountryCode, Roles.VolunteerCoordinator);
    }

    public async Task CountryServicesChanged(Country country, string actorId, CancellationToken ct)
    {
        var recipients = await store.ListAsync(store.ActiveSystemAdministratorIds.Where(id => id != actorId), ct);
        Add(recipients, null, null, null, $"Public services settings for {country.Name} were published. See Activity for the change record.",
            scopeCountryCode: country.Code, scopeRole: Roles.Administrator);
    }

    public async Task PartnerVerificationRequested(Guid organisationId, string country, string message, string actorId, CancellationToken ct)
    {
        var reviewers = await store.ListAsync(store.ActiveSystemAdministratorIds.Where(id => id != actorId), ct);
        Add(reviewers, null, null, null, message, organisationId, country, Roles.Administrator);
    }

    public async Task PartnerVerificationDecided(Guid organisationId, string country, string message, string actorId, CancellationToken ct)
    {
        var administrators = await store.ListAsync(store.Query<Membership>().Where(m => m.Role == Roles.CountryAdministrator &&
            m.CountryCode == country && m.CrisisId == null && m.UserId != actorId).Select(m => m.UserId).Distinct(), ct);
        Add(administrators, null, null, null, message, organisationId, country, Roles.CountryAdministrator);
    }

    public void DonorFundingChanged(string userId, FundingCampaign campaign, string activity)
        => Add([userId], null, null, null, $"{campaign.Name}: {activity}.", scopeCountryCode: campaign.CountryCode, scopeRole: Roles.Donor);

    public async Task PartnerChanged(Guid organisationId, string country, Guid? crisisId, string message,
        bool includeAdministrators, CancellationToken ct, Guid? requestId = null)
    {
        var recipients = await store.ListAsync(store.Query<Membership>().Where(m => m.CountryCode == country &&
            (m.CrisisId == null || m.CrisisId == crisisId) && m.Role == Roles.Partner && m.OrganisationId == organisationId)
            .Select(m => m.UserId).Distinct(), ct);
        Add(recipients, crisisId, requestId, null, message, organisationId, country, Roles.Partner);
        if (includeAdministrators) await NotifyAdministrators(country, message, ct);
    }

    public async Task LogisticsReceipt(Resource resource, Guid? crisisId, bool hasException, CancellationToken ct)
    {
        var members = store.Query<Membership>().Where(m => m.CountryCode == resource.CountryCode &&
            (m.CrisisId == null || m.CrisisId == crisisId) &&
            m.Role == Roles.Logistics && m.OrganisationId == resource.OrganisationId &&
            (m.DepotId == null || m.DepotId == resource.DepotId))
            .Select(m => m.UserId);
        var recipients = await store.ListAsync(members.Distinct(), ct);
        Add(recipients.Where(id => !store.Query<LogisticsPreferences>().Any(p => p.UserId == id && !p.DispatchUpdates)), crisisId, null, null,
            hasException ? $"A shipment of {resource.Name} has a delivery exception." : $"A shipment of {resource.Name} was confirmed.",
            resource.OrganisationId, resource.CountryCode, Roles.Logistics);
    }

    public async Task SupplySupportChanged(SupplyRequest request, string message, CancellationToken ct)
    {
        var role = request.ShelterId.HasValue ? Roles.ShelterAdmin : Roles.Logistics;
        var recipients = await store.ListAsync(store.Query<Membership>().Where(m => m.Role == role &&
            m.CountryCode == request.CountryCode && m.OrganisationId == request.RequestingOrganisationId &&
            (m.CrisisId == null || m.CrisisId == request.CrisisId)).Select(m => m.UserId).Distinct(), ct);
        Add(role == Roles.Logistics ? recipients.Where(id => !store.Query<LogisticsPreferences>().Any(p => p.UserId == id && !p.SupplyUpdates)) : recipients,
            request.CrisisId, null, null, message, request.RequestingOrganisationId, request.CountryCode, role);
    }

    public async Task StockAlert(Resource resource, CancellationToken ct)
    {
        if (resource.Stock > 0 && (resource.LowStockThreshold == null || resource.Available >= resource.LowStockThreshold)) return;
        var recipients = await store.ListAsync(store.Query<Membership>().Where(m => m.Role == Roles.Logistics &&
            m.CountryCode == resource.CountryCode && m.OrganisationId == resource.OrganisationId && m.CrisisId == null &&
            (m.DepotId == null || m.DepotId == resource.DepotId)).Select(m => m.UserId).Distinct(), ct);
        Add(recipients.Where(id => !store.Query<LogisticsPreferences>().Any(p => p.UserId == id && !p.StockAlerts)),
            null, null, null, resource.Stock == 0 ? $"{resource.Name} is out of stock." : $"{resource.Name} is below its stock threshold.",
            resource.OrganisationId, resource.CountryCode, Roles.Logistics);
    }

    public async Task FundingChanged(FundingCampaign campaign, string activity, CancellationToken ct, bool needsReceipt = false)
    {
        var staff = store.Query<Membership>().Where(m => m.CountryCode == campaign.CountryCode &&
            m.Role == Roles.FundingOfficer && m.OrganisationId == campaign.OrganisationId &&
            (m.CrisisId == null || m.CrisisId == campaign.CrisisId)).Select(m => m.UserId);
        var recipients = await store.ListAsync(staff.Distinct(), ct);
        Add(recipients, campaign.CrisisId, null, null, activity, campaign.OrganisationId, campaign.CountryCode, Roles.FundingOfficer);
        if (needsReceipt && recipients.Count == 0)
            await NotifyAdministrators(campaign.CountryCode, $"{campaign.Name}: A pledge awaits receipt verification.", ct);
    }

    private async Task NotifyAdministrators(string country, string message, CancellationToken ct, Guid? crisisId = null,
        Guid? requestId = null, string[]? excludedUsers = null)
    {
        var system = store.ActiveSystemAdministratorIds;
        var countryAdmins = store.Query<Membership>().Where(m => m.Role == Roles.CountryAdministrator &&
            m.CountryCode == country && m.CrisisId == null && !system.Contains(m.UserId)).Select(m => m.UserId);
        var localRecipients = excludedUsers == null ? countryAdmins : countryAdmins.Where(id => !excludedUsers.Contains(id));
        var systemRecipients = excludedUsers == null ? system : system.Where(id => !excludedUsers.Contains(id));
        Add(await store.ListAsync(localRecipients.Distinct(), ct), crisisId, requestId, null, message, scopeCountryCode: country, scopeRole: Roles.CountryAdministrator);
        Add(await store.ListAsync(systemRecipients, ct), crisisId, requestId, null, message, scopeCountryCode: country, scopeRole: Roles.Administrator);
    }

    private static string LimitMessage(string message) => message[..Math.Min(message.Length, 4000)];

    private void Add(IEnumerable<string> recipients, Guid? crisisId, Guid? requestId, Guid? taskId, string message,
        Guid? scopeOrganisationId = null, string? scopeCountryCode = null, string? scopeRole = null, Guid? allocationId = null)
    {
        var eventId = Guid.NewGuid();
        foreach (var userId in recipients.Distinct())
            store.Add(new Notification { UserId = userId, EventId = eventId, IsInternal = true,
                CrisisId = crisisId, RequestId = requestId, TaskId = taskId, AllocationId = allocationId, ScopeOrganisationId = scopeOrganisationId,
                ScopeCountryCode = scopeCountryCode, ScopeRole = scopeRole, Message = LimitMessage(message) });
    }
}
