using Surakuma.Domain;
using VolunteerTaskStatus = Surakuma.Domain.TaskStatus;

namespace Surakuma.Application;

public sealed class Operations(IStore store, AccessService access, IAiProvider ai, IAllocationPolicy allocationPolicy, IAllocationStrategy allocationStrategy)
{
    private static readonly string[] CaseRoles = [Roles.CaseManager, Roles.Coordinator];
    private static readonly string[] LogisticsRoles = [Roles.Logistics, Roles.Coordinator];
    private static readonly string[] ShelterRoles = [Roles.ShelterAdmin, Roles.Coordinator];
    private static readonly string[] VolunteerRoles = [Roles.VolunteerCoordinator, Roles.Coordinator];
    private static readonly RequestStatus[] ActiveFulfilment = [RequestStatus.Approved, RequestStatus.InProgress, RequestStatus.PartiallyFulfilled];
    private static readonly VolunteerTaskStatus[] OpenTasks = [VolunteerTaskStatus.Assigned, VolunteerTaskStatus.Accepted, VolunteerTaskStatus.InProgress, VolunteerTaskStatus.AwaitingVerification, VolunteerTaskStatus.Returned];
    private static readonly VolunteerTaskStatus[] ScheduledTasks = [VolunteerTaskStatus.Assigned, VolunteerTaskStatus.Accepted, VolunteerTaskStatus.InProgress];

    public void Audit(string action, Record record, string detail = "", string? countryCode = null) =>
        store.Add(new AuditEvent
        {
            ActorId = access.UserId, Action = action, EntityId = record.Id, EntityType = record.GetType().Name, Detail = detail,
            CountryCode = countryCode ?? (record switch
            {
                Country country => country.Code,
                Crisis crisis => crisis.CountryCode,
                Resource resource => resource.CountryCode,
                Shelter shelter => shelter.CountryCode,
                Membership membership => membership.CountryCode,
                VolunteerProfile volunteer => volunteer.CountryCode,
                OrganisationCountry partner => partner.CountryCode,
                AdminProposal proposal => proposal.CountryCode,
                AdminAlert alert => alert.CountryCode,
                _ => null,
            }),
        });
    private readonly InternalNotifications notifications = new(store);

    private async Task RecordChange(AssistanceRequest r, string note, CancellationToken ct, RequestStatus? previousStatus = null, string? historyStatus = null)
    {
        store.Add(new RequestHistory { RequestId = r.Id, ActorId = access.UserId, Status = historyStatus ?? r.Status.ToString(), Note = note });
        if (previousStatus != r.Status)
            store.Add(new OutboxMessage { UserId = r.CitizenId, RequestId = r.Id, Message = CitizenMessages.Status(r.Reference, r.Status, "en"), SinhalaMessage = CitizenMessages.Status(r.Reference, r.Status, "si"), TamilMessage = CitizenMessages.Status(r.Reference, r.Status, "ta") });
        await notifications.RequestChanged(r, note, ct);
        Audit("CaseChanged", r, note, await CrisisCountry(r.CrisisId, ct));
    }
    private async Task<string> CrisisCountry(Guid id, CancellationToken ct) =>
        (await store.FindAsync<Crisis>(id, ct) ?? throw new MissingException()).CountryCode;

    public async Task<PublicLookups> PublicData(CancellationToken ct, string countryCode = "LK") => new(
        await store.ListAsync(store.Query<Crisis>().Where(x => x.Active && x.CountryCode == countryCode).OrderBy(x => x.Name).Select(x => new PublicLookup(x.Id, x.Name)), ct),
        await store.ListAsync(store.Query<Organisation>().Where(o => store.Query<OrganisationCountry>().Any(c => c.OrganisationId == o.Id && c.CountryCode == countryCode && (c.VerificationState == "Verified" || c.VerificationState == "LegacyActive"))).OrderBy(x => x.Name).Select(x => new PublicLookup(x.Id, x.Name)), ct));
    public async Task<List<PublicAlert>> Alerts(CancellationToken ct, string countryCode = "LK") =>
        await store.ListAsync(store.Query<PublicAlert>().Where(x => x.Published &&
            (x.WorkflowState == null || x.WorkflowState == "LegacyPublished" || x.WorkflowState == "Published" || x.WorkflowState == "EmergencyPublished") &&
            x.ExpiresAt > DateTimeOffset.UtcNow &&
            store.Query<Crisis>().Any(c => c.Id == x.CrisisId && c.CountryCode == countryCode))
            .OrderByDescending(x => x.PublishedAt ?? x.CreatedAt), ct);
    public Task<List<PublicShelter>> PublicShelters(CancellationToken ct, string countryCode = "LK") => store.ListAsync(store.Query<Shelter>()
        .Where(x => x.CountryCode == countryCode && store.Query<OrganisationCountry>().Any(link =>
            link.OrganisationId == x.OrganisationId && link.CountryCode == countryCode))
        .OrderBy(x => x.Name).Select(x => new PublicShelter(x.Id, x.Name, x.Address, x.Latitude, x.Longitude, x.Capacity, x.Reserved, x.Occupancy, x.Capacity - x.Reserved - x.Occupancy, x.Accessible, x.Open, x.Facilities, x.UpdatedAt)), ct);
    public async Task<List<Shelter>> StaffShelters(CancellationToken ct)
    {
        return await store.ListAsync((await access.Located<Shelter>(ct, roles: ShelterRoles)).OrderBy(x => x.Name), ct);
    }
    public Task<AssistanceRequest> Submit(CreateRequestInput input, CancellationToken ct) => store.RoutingTransactionAsync(async () =>
    {
        QuantityUnits.ValidateWhole(input.Quantity, "items");
        if (input.Category == AidCategory.Shelter && input.Quantity != 1)
            throw new RuleException("A shelter request covers one household placement. Submit a separate request for another household.");
        if (!Enum.IsDefined(input.Category) || !Enum.IsDefined(input.Priority))
            throw new RuleException("Invalid category or priority.");
        if (input.Latitude is < -90 or > 90 || input.Longitude is < -180 or > 180 || input.Latitude.HasValue != input.Longitude.HasValue)
            throw new RuleException("Invalid location coordinates.");
        var crisis = await store.FindAsync<Crisis>(input.CrisisId, ct) ?? throw new RuleException("Choose a valid crisis event.");
        if (!crisis.Active)
            throw new RuleException("Choose an active crisis.");
        var existing = await store.ListAsync(store.Query<AssistanceRequest>().Where(x => x.CitizenId == access.UserId && x.SubmissionKey == input.SubmissionKey), ct);
        if (existing.Count > 0)
            return existing[0];
        var centre = crisis.PrimaryOrganisationId;
        if (centre.HasValue && !await access.PartnerEligible(centre.Value, crisis.CountryCode, ct)) centre = null;
        var r = new AssistanceRequest
        {
            CitizenId = access.UserId,
            CrisisId = input.CrisisId,
            OrganisationId = centre,
            AssignmentStatus = centre.HasValue ? AssignmentStatus.AutoAssigned : AssignmentStatus.Unassigned,
            AssignedCaseManagerId = centre.HasValue ? await ChooseCaseManager(centre.Value, crisis.Id, ct) : null,
            RequestedForSomeoneElse = input.RequestedForSomeoneElse,
            RequesterRelationship = input.RequestedForSomeoneElse ? (input.RequesterRelationship ?? "").Trim() : "",
            RequesterContact = input.RequestedForSomeoneElse ? (input.RequesterContact ?? "").Trim() : "",
            Category = input.Category,
            Priority = input.Priority,
            Description = input.Description.Trim(),
            LocationText = input.LocationText.Trim(),
            Latitude = input.Latitude,
            Longitude = input.Longitude,
            HouseholdSize = input.HouseholdSize,
            AccessibilityNeeds = input.AccessibilityNeeds,
            Quantity = input.Quantity,
            SubmissionKey = input.SubmissionKey,
            Synthetic = input.Synthetic
        };
        store.Add(r);
        if (r.OrganisationId.HasValue)
            Audit("RequestAssigned", r, $"Automatic centre {r.OrganisationId.Value}; case manager {r.AssignedCaseManagerId ?? "unassigned"}", crisis.CountryCode);
        await RecordChange(r, "Request received. A staff member will review it.", ct);
        return r;
    }, ct);
    private async Task<string?> ChooseCaseManager(Guid organisationId, Guid crisisId, CancellationToken ct)
    {
        var country = (await store.FindAsync<Crisis>(crisisId, ct))!.CountryCode;
        var managers = (await store.ListAsync(store.Query<Membership>().Where(x => x.OrganisationId == organisationId && x.Role == Roles.CaseManager && x.CountryCode == country && (x.CrisisId == null || x.CrisisId == crisisId) && x.AvailableForAssignment), ct)).Select(x => x.UserId).Distinct().ToArray();
        if (managers.Length == 0) return null;
        var active = await store.ListAsync(store.Query<AssistanceRequest>().Where(x => x.OrganisationId == organisationId && x.AssignedCaseManagerId != null && managers.Contains(x.AssignedCaseManagerId) && x.Status != RequestStatus.Fulfilled && x.Status != RequestStatus.Closed && x.Status != RequestStatus.Rejected && x.Status != RequestStatus.Cancelled), ct);
        return managers.OrderBy(id => active.Count(x => x.AssignedCaseManagerId == id)).ThenBy(id => id, StringComparer.Ordinal).First();
    }
    public async Task<Page<AssistanceRequest>> Requests(bool mine, string? status, string? search, int page,
        CancellationToken ct, bool assignedToMe = false, string? view = null, Guid? crisisId = null, string? staffRole = null)
    {
        var q = await access.Visible(ct);
        if (staffRole is not null)
        {
            if (staffRole is not (Roles.CaseManager or Roles.Coordinator or Roles.Logistics)) throw new AccessDeniedException();
            q = await access.StaffCases(staffRole, ct);
        }
        if (mine)
            q = q.Where(x => x.CitizenId == access.UserId);
        if (assignedToMe)
            q = q.Where(x => x.AssignedCaseManagerId == access.UserId);
        if (view is "open" or "overdue")
            q = q.Where(x => !CaseReporting.Ended.Contains(x.Status));
        if (view == "overdue")
        {
            var overdueBefore = CaseReporting.OverdueBefore(DateTimeOffset.UtcNow);
            q = q.Where(x => x.CreatedAt < overdueBefore);
        }
        q = view switch
        {
            "critical" => q.Where(r => r.Priority == Priority.Critical && !CaseReporting.Ended.Contains(r.Status)),
            "unassigned" => q.Where(r => (r.OrganisationId == null || r.AssignedCaseManagerId == null) && !CaseReporting.Ended.Contains(r.Status)),
            "assigned" => q.Where(r => r.AssignedCaseManagerId != null && !CaseReporting.Ended.Contains(r.Status)),
            "escalated" => q.Where(r => r.Escalated),
            "pending-ai" => q.Where(r => !CaseReporting.Ended.Contains(r.Status) &&
                store.Query<Recommendation>().Any(a => a.RequestId == r.Id && (a.ReviewState == "Pending" || a.ReviewState == "Defer"))),
            "fulfilment" => q.Where(r => ActiveFulfilment.Contains(r.Status)),
            "shortages" => ShortageCases(q),
            _ => q,
        };
        if (crisisId != null)
            q = q.Where(x => x.CrisisId == crisisId);
        if (Enum.TryParse<RequestStatus>(status, out var state))
            q = q.Where(x => x.Status == state);
        if (!string.IsNullOrWhiteSpace(search))
            q = q.Where(x => x.Reference.Contains(search) || x.Description.Contains(search) || x.LocationText.Contains(search));
        int total = (await store.ListAsync(q.GroupBy(_ => 1).Select(group => group.Count()), ct)).SingleOrDefault();
        page = Math.Max(1, page);
        return new(await store.ListAsync(q.OrderByDescending(x => x.CreatedAt).Skip((page - 1) * 20).Take(20), ct), total, page, 20);
    }

    public IQueryable<AssistanceRequest> ShortageCases(IQueryable<AssistanceRequest> cases)
    {
        var allocations = store.Query<ResourceAllocation>().Where(a => a.Status == AllocationStatus.Reserved || a.Status == AllocationStatus.Dispatched);
        var resources = store.Query<Resource>().Where(s => s.TransportAvailable);
        return from request in cases
               join crisis in store.Query<Crisis>() on request.CrisisId equals crisis.Id
               let uncommitted = request.Quantity - request.DeliveredQuantity -
                   (allocations.Where(a => a.RequestId == request.Id).Sum(a => (decimal?)a.Quantity) ?? 0)
               where ActiveFulfilment.Contains(request.Status) && request.Category != AidCategory.Shelter &&
                   uncommitted > 0 && !resources.Any(s => s.CountryCode == crisis.CountryCode && s.OrganisationId == request.OrganisationId &&
                       s.Category == request.Category && s.Stock - s.Reserved >= uncommitted)
               select request;
    }
    public async Task<List<AssistanceRequest>> Triage(CancellationToken ct, Guid? crisisId = null)
    {
        var queue = (await access.Visible(ct)).Where(x => (x.OrganisationId == null || x.AssignedCaseManagerId == null)
            && !CaseReporting.Ended.Contains(x.Status) && (crisisId == null || x.CrisisId == crisisId));
        var memberships = await access.Memberships(ct);
        if (await access.IsAdmin(ct))
            return await store.ListAsync(queue.OrderBy(x => x.CreatedAt), ct);
        if (!memberships.Any(x => x.Role == Roles.Coordinator || x.Role == Roles.CountryAdministrator))
            throw new AccessDeniedException();
        var crises = (await store.ListAsync(store.Query<CrisisAssignment>().Where(x => x.UserId == access.UserId), ct)).Select(x => x.CrisisId).ToArray();
        return await store.ListAsync(queue.Where(x => crises.Contains(x.CrisisId) || store.Query<Membership>().Any(m =>
            m.UserId == access.UserId && m.Role == Roles.CountryAdministrator &&
            store.Query<Crisis>().Any(c => c.Id == x.CrisisId && c.CountryCode == m.CountryCode))).OrderBy(x => x.CreatedAt), ct);
    }
    public Task<AssistanceRequest> Reassign(Guid id, Guid organisationId, CancellationToken ct) => store.RoutingTransactionAsync(async () =>
    {
        var request = await store.FindAsync<AssistanceRequest>(id, ct) ?? throw new MissingException();
        if (!await access.IsAdmin(ct) && !await access.Coordinates(request.CrisisId, ct))
            throw new AccessDeniedException();
        if (await store.FindAsync<Organisation>(organisationId, ct) is null)
            throw new RuleException("Organisation not found.");
        if (request.OrganisationId != organisationId &&
            ((await store.ListAsync(store.Query<ResourceAllocation>().Where(x => x.RequestId == id && (x.Status == AllocationStatus.Reserved || x.Status == AllocationStatus.Dispatched)), ct)).Count > 0 ||
             (await store.ListAsync(store.Query<ShelterAllocation>().Where(x => x.RequestId == id && (x.Status == StayStatus.Reserved || x.Status == StayStatus.CheckedIn)), ct)).Count > 0))
            throw new RuleException("Complete or cancel active resource allocations and shelter placements before changing the organisation.");
        if (!(await store.ListAsync(store.Query<OrganisationCountry>().Where(x => (x.VerificationState == "Verified" || x.VerificationState == "LegacyActive") && x.OrganisationId == organisationId && store.Query<Crisis>().Any(c => c.Id == request.CrisisId && c.CountryCode == x.CountryCode)), ct)).Any()) throw new RuleException("Centre does not operate in this country.");
        var previous = request.OrganisationId;
        var previousManager = request.AssignedCaseManagerId;
        request.OrganisationId = organisationId;
        request.AssignedCaseManagerId = await ChooseCaseManager(organisationId, request.CrisisId, ct);
        request.AssignmentStatus = AssignmentStatus.Reassigned;
        Audit("RequestReassigned", request, $"Centre {previous?.ToString() ?? "unassigned"} to {organisationId}; case manager {previousManager ?? "unassigned"} to {request.AssignedCaseManagerId ?? "unassigned"}", await CrisisCountry(request.CrisisId, ct));
        await notifications.RequestChanged(request, "Case assignment updated.", ct);
        return request;
    }, ct);
    public Task<AssistanceRequest> AssignManager(Guid id, string userId, CancellationToken ct) => store.RoutingTransactionAsync(async () =>
    {
        var request = await store.FindAsync<AssistanceRequest>(id, ct) ?? throw new MissingException();
        if (!await access.IsAdmin(ct) && !await access.Coordinates(request.CrisisId, ct)) throw new AccessDeniedException();
        if (!request.OrganisationId.HasValue || (await store.ListAsync(store.Query<Membership>().Where(x => x.OrganisationId == request.OrganisationId && x.Role == Roles.CaseManager && x.UserId == userId && (x.CrisisId == null || x.CrisisId == request.CrisisId) && store.Query<Crisis>().Any(c => c.Id == request.CrisisId && c.CountryCode == x.CountryCode)), ct)).Count == 0) throw new RuleException("Choose a case manager at the assigned centre.");
        var previous = request.AssignedCaseManagerId;
        request.AssignedCaseManagerId = userId;
        Audit("CaseManagerAssigned", request, $"From {previous ?? "unassigned"} to {userId}", await CrisisCountry(request.CrisisId, ct));
        await notifications.RequestChanged(request, "Case assignment updated.", ct);
        return request;
    }, ct);
    public async Task<object> Detail(Guid id, CancellationToken ct)
    {
        var r = await access.Request(id, ct: ct);
        var histories = await store.ListAsync(store.Query<RequestHistory>().Where(x => x.RequestId == id).OrderBy(x => x.CreatedAt), ct);
        var attachments = await store.ListAsync(store.Query<Attachment>().Where(x => x.RequestId == id).Select(x => new { x.Id, x.OriginalName, x.ContentType, x.Size }), ct);
        var allocations = await store.ListAsync(store.Query<ResourceAllocation>().Where(x => x.RequestId == id).Select(a => new
        {
            a.Id, a.RequestId, a.ResourceId, a.Quantity, a.Status, a.ApprovedBy, a.CreatedAt, a.UpdatedAt, a.Version,
            ConfirmedQuantity = store.Query<DeliveryConfirmation>().Where(d => d.AllocationId == a.Id)
                .Select(d => (decimal?)d.ConfirmedQuantity).FirstOrDefault(),
        }), ct);
        var placements = await store.ListAsync(store.Query<ShelterAllocation>().Where(x => x.RequestId == id), ct);
        var feedback = await store.ListAsync(store.Query<Feedback>().Where(x => x.RequestId == id).OrderByDescending(x => x.CreatedAt), ct);
        var visible = await access.Visible(ct);
        var consolidations = await store.ListAsync(
            from link in store.Query<CaseConsolidation>()
            join original in visible on link.OriginalRequestId equals original.Id
            join primary in visible on link.PrimaryRequestId equals primary.Id
            where original.Id == id || primary.Id == id
            select new { OriginalId = original.Id, OriginalReference = original.Reference, PrimaryId = primary.Id,
                PrimaryReference = primary.Reference, link.CreatedAt }, ct);
        return new
        {
            Request = r,
            History = histories.Select(h => new { h.Id, h.CreatedAt, h.Status, Note = r.CitizenId == access.UserId ? CitizenHistoryNote(r.Reference, h.Status) : h.Note, ActorId = r.CitizenId == access.UserId ? "" : h.ActorId }),
            Attachments = attachments,
            Allocations = allocations,
            Placements = placements,
            Feedback = feedback,
            Consolidations = consolidations
        };
    }

    public Task<CaseConsolidation> Consolidate(Guid id, ConsolidateCaseInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var original = await access.Request(id, CaseRoles, ct);
        var primary = await access.Request(input.PrimaryRequestId, CaseRoles, ct);
        var reason = input.Reason.Trim();
        if (reason.Length == 0) throw new RuleException("Record why these cases represent the same request.");
        if (primary.Id == original.Id || original.CrisisId != primary.CrisisId || original.OrganisationId != primary.OrganisationId ||
            original.CitizenId != primary.CitizenId || original.Category != primary.Category || original.Quantity != primary.Quantity ||
            original.HouseholdSize != primary.HouseholdSize || original.RequestedForSomeoneElse || primary.RequestedForSomeoneElse)
            throw new RuleException("Consolidate only equivalent requests by the same citizen within the same crisis and response organisation. Cases filed for another person require separate review.");
        var links = store.Query<CaseConsolidation>();
        if ((await store.ListAsync(links.Where(x => x.OriginalRequestId == id || x.PrimaryRequestId == id ||
            x.OriginalRequestId == primary.Id).Take(1), ct)).Count > 0)
            throw new RuleException("These cases already have a consolidation relationship that prevents this action.");
        if (primary.Status is RequestStatus.Rejected or RequestStatus.Cancelled or RequestStatus.Closed or RequestStatus.Fulfilled ||
            original.DeliveredQuantity > 0 || original.Escalated ||
            (await store.ListAsync(store.Query<ResourceAllocation>().Where(x => x.RequestId == id && x.Status != AllocationStatus.Cancelled).Take(1), ct)).Count > 0 ||
            (await store.ListAsync(store.Query<ShelterAllocation>().Where(x => x.RequestId == id && x.Status != StayStatus.Cancelled).Take(1), ct)).Count > 0 ||
            (await store.ListAsync(store.Query<VolunteerTask>().Where(x => x.RequestId == id && x.Status != VolunteerTaskStatus.Declined).Take(1), ct)).Count > 0 ||
            (await store.ListAsync(store.Query<CaseShare>().Where(x => x.RequestId == id).Take(1), ct)).Count > 0 ||
            (await store.ListAsync(store.Query<DonationAllocation>().Where(x => x.RequestId == id).Take(1), ct)).Count > 0 ||
            (await store.ListAsync(store.Query<SupplyRequest>().Where(x => x.CaseId == id && !x.Cancelled).Take(1), ct)).Count > 0)
            throw new RuleException("Resolve conflicting commitments or escalations before consolidating this case. Prior fulfilment must remain on the original case.");
        var previous = original.Status;
        original.Transition(RequestStatus.Cancelled, reason);
        var link = new CaseConsolidation { OriginalRequestId = id, PrimaryRequestId = primary.Id, Reason = reason, ActorId = access.UserId };
        store.Add(link);
        await RecordChange(original, $"Consolidated into {primary.Reference}. {reason}", ct, previous);
        await RecordChange(primary, $"Maintains active response for {original.Reference}. {reason}", ct, primary.Status);
        Audit("CasesConsolidated", link, $"{original.Reference} → {primary.Reference}", await CrisisCountry(original.CrisisId, ct));
        return link;
    }, ct);
    private static string CitizenHistoryNote(string reference, string status) =>
        Enum.TryParse<RequestStatus>(status, out var state) && Enum.IsDefined(state)
            ? CitizenMessages.Status(reference, state, "en")
            : "Your request has been updated.";
    public async Task<AssistanceRequest> ChangeStatus(Guid id, StatusInput input, CancellationToken ct)
    {
        var r = await access.Request(id, CaseRoles, ct);
        if (input.Status is RequestStatus.InProgress or RequestStatus.PartiallyFulfilled or RequestStatus.Fulfilled)
            throw new RuleException("Delivery status is updated by allocations and delivery records.");
        if (input.Status == RequestStatus.Cancelled)
        {
            if ((await store.ListAsync(store.Query<ResourceAllocation>().Where(x => x.RequestId == id && x.Status != AllocationStatus.Cancelled), ct)).Count > 0 ||
                (await store.ListAsync(store.Query<ShelterAllocation>().Where(x => x.RequestId == id && x.Status != StayStatus.Cancelled), ct)).Count > 0)
                throw new RuleException("Release allocations before cancelling this case.");
        }
        var previousStatus = r.Status;
        r.Transition(input.Status, input.Reason);
        await RecordChange(r, input.Reason.Length > 0 ? input.Reason : $"Case moved to {r.Status}.", ct, previousStatus);
        await store.SaveAsync(ct);
        return r;
    }
    public Task Escalate(Guid id, string reason, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var r = await access.Request(id, CaseRoles, ct);
        if (string.IsNullOrWhiteSpace(reason))
            throw new RuleException("Explain why escalation is needed.");
        if (r.Escalated) return r;
        r.Escalated = true;
        await RecordChange(r, "Case escalated: " + reason, ct, r.Status, "Escalated");
        return r;
    }, ct);
    public async Task<List<AssistanceRequest>> EscalatedRequests(CancellationToken ct)
    {
        var memberships = await access.Memberships(ct);
        var caseOrgs = memberships.Where(x => CaseRoles.Contains(x.Role)).Select(x => x.OrganisationId).ToArray();
        var crises = memberships.Any(x => x.Role == Roles.Coordinator)
            ? (await store.ListAsync(store.Query<CrisisAssignment>().Where(x => x.UserId == access.UserId), ct)).Select(x => x.CrisisId).ToArray() : [];
        var global = await access.IsAdmin(ct);
        var countries = memberships.Where(m => m.Role == Roles.CountryAdministrator).Select(m => m.CountryCode).ToArray();
        if (!global && caseOrgs.Length == 0 && countries.Length == 0) throw new AccessDeniedException();
        return await store.ListAsync((await access.Visible(ct)).Where(x => x.Escalated && (global ||
            (x.OrganisationId.HasValue && caseOrgs.Contains(x.OrganisationId)) || crises.Contains(x.CrisisId)
            || store.Query<Crisis>().Any(c => c.Id == x.CrisisId && countries.Contains(c.CountryCode)))).OrderBy(x => x.UpdatedAt), ct);
    }
    public async Task ResolveEscalation(Guid id, string reason, CancellationToken ct)
    {
        var r = await access.Request(id, CaseRoles, ct);
        if (!r.Escalated) throw new RuleException("This case has no open escalation.");
        if (string.IsNullOrWhiteSpace(reason)) throw new RuleException("Explain how the escalation was resolved.");
        r.Escalated = false;
        Audit("EscalationResolved", r, reason.Trim(), await CrisisCountry(r.CrisisId, ct));
        await store.SaveAsync(ct);
    }
    public async Task Share(Guid id, Guid orgId, CancellationToken ct)
    {
        await access.Request(id, [Roles.Coordinator], ct);
        throw new RuleException("Assign the request to the organisation instead of sharing access.");
    }
    public async Task<object> AiDetail(Guid id, CancellationToken ct)
    {
        await access.Request(id, CaseRoles, ct);
        var visibleIds = (await access.Visible(ct)).Select(x => x.Id);
        return new
        {
            Recommendations = await store.ListAsync(store.Query<Recommendation>().Where(x => x.RequestId == id).OrderByDescending(x => x.CreatedAt), ct),
            Decisions = await store.ListAsync(store.Query<HumanDecision>().Where(x => x.RequestId == id).OrderByDescending(x => x.CreatedAt), ct),
            Duplicates = await store.ListAsync(store.Query<PotentialDuplicate>().Where(x => x.RequestId == id && visibleIds.Contains(x.CandidateId)), ct)
        };
    }
    public async Task<Recommendation> GenerateAi(Guid id, CancellationToken ct)
    {
        var r = await access.Request(id, CaseRoles, ct);
        var result = await ai.RecommendAsync(r, ct);
        var recommendation = new Recommendation { RequestId = id, Category = result.Category, Priority = result.Priority, Explanation = result.Explanation, Provider = result.Provider, Model = result.Model, Fallback = result.Fallback };
        store.Add(recommendation);
        var since = r.CreatedAt.AddDays(-2);
        var candidates = await store.ListAsync((await access.Visible(ct)).Where(x => x.Id != id && x.CrisisId == r.CrisisId && x.Category == r.Category && x.CreatedAt >= since).OrderByDescending(x => x.CreatedAt).Take(100), ct);
        var existing = (await store.ListAsync(store.Query<PotentialDuplicate>().Where(x => x.RequestId == id), ct)).Select(x => x.CandidateId).ToHashSet();
        foreach (var candidate in candidates)
        {
            double similarity = Similarity(r.Description, candidate.Description);
            if (similarity >= 0.35 && !existing.Contains(candidate.Id))
                store.Add(new PotentialDuplicate { RequestId = id, CandidateId = candidate.Id, Similarity = similarity, Reason = "Text token overlap within the same crisis/category and recent time window; staff verification required." });
        }
        Audit("AiGenerated", recommendation, result.Provider, await CrisisCountry(r.CrisisId, ct));
        await store.SaveAsync(ct);
        return recommendation;
    }
    public static double Similarity(string left, string right)
    {
        var a = left.ToLowerInvariant().Split([' ', ',', '.', '!', '?', '\n'], StringSplitOptions.RemoveEmptyEntries).ToHashSet();
        var b = right.ToLowerInvariant().Split([' ', ',', '.', '!', '?', '\n'], StringSplitOptions.RemoveEmptyEntries).ToHashSet();
        return a.Count == 0 && b.Count == 0 ? 0 : (double)a.Intersect(b).Count() / a.Union(b).Count();
    }
    public Task<Recommendation> Decide(Guid id, DecisionInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var r = await access.Request(id, CaseRoles, ct);
        var recommendation = await store.FindAsync<Recommendation>(input.RecommendationId, ct) ?? throw new MissingException();
        if (recommendation.RequestId != id || recommendation.ReviewState is not ("Pending" or "Defer"))
            throw new RuleException("This recommendation has already been decided or belongs to another case.");
        if (!new[] { "Approve", "Modify", "Reject", "Defer" }.Contains(input.Action))
            throw new RuleException("Invalid decision action.");
        if (input.Action is "Modify" or "Reject" && string.IsNullOrWhiteSpace(input.Reason))
            throw new RuleException("A reason is required.");
        if (r.Status is RequestStatus.Fulfilled or RequestStatus.Closed or RequestStatus.Cancelled or RequestStatus.Rejected)
            throw new RuleException("This case is no longer open.");
        if (input.Action is "Approve" or "Modify")
        {
            r.Priority = input.Action == "Modify" ? input.FinalPriority ?? throw new RuleException("Choose a final priority.") : recommendation.Priority;
            var category = input.Action == "Modify" ? input.FinalCategory ?? r.Category : recommendation.Category;
            if (category == AidCategory.Shelter && r.Quantity != 1)
                throw new RuleException("A shelter request must represent one household placement. Create a separate shelter request instead.");
            if (category != r.Category && r.Status is RequestStatus.InProgress or RequestStatus.PartiallyFulfilled)
                throw new RuleException("Do not reclassify a case after allocation or delivery has begun. Review its existing commitments first.");
            r.Category = category;
        }
        recommendation.ReviewState = input.Action;
        store.Add(new HumanDecision { RecommendationId = recommendation.Id, RequestId = id, ActorId = access.UserId, Action = input.Action, Reason = input.Reason, FinalPriority = r.Priority });
        Audit("AiDecision", recommendation, input.Action + ": " + input.Reason, await CrisisCountry(r.CrisisId, ct));
        return recommendation;
    }, ct);
    public async Task ReviewDuplicate(Guid id, Guid duplicateId, string action, CancellationToken ct)
    {
        var request = await access.Request(id, CaseRoles, ct);
        var d = await store.FindAsync<PotentialDuplicate>(duplicateId, ct) ?? throw new MissingException();
        if (d.RequestId != id)
            throw new MissingException();
        await access.Request(d.CandidateId, CaseRoles, ct);
        if (action is not ("Distinct" or "Confirmed"))
            throw new RuleException("Choose Distinct or Confirmed.");
        d.State = action;
        Audit("DuplicateReviewed", d, action, await CrisisCountry(request.CrisisId, ct));
        await store.SaveAsync(ct);
    }
    public async Task<Guid[]> OrgScope(CancellationToken ct)
    {
        var memberships = await access.Memberships(ct);
        var own = memberships.Where(x => x.OrganisationId.HasValue && x.Role is not Roles.Citizen and not Roles.Volunteer and not Roles.FundingOfficer).Select(x => x.OrganisationId!.Value);
        var crisisOrgs = memberships.Any(m => m.Role == Roles.Coordinator)
            ? await store.ListAsync((await access.Visible(ct)).Where(x => x.OrganisationId.HasValue).Select(x => x.OrganisationId!.Value).Distinct(), ct)
            : [];
        return own.Concat(crisisOrgs).Distinct().ToArray();
    }
    public async Task<List<Resource>> Resources(CancellationToken ct)
    {
        return await store.ListAsync((await access.Located<Resource>(ct, roles: LogisticsRoles)).OrderBy(x => x.Name), ct);
    }
    public Task<Resource> AddResource(ResourceInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        await access.RequireLocation(input.OrganisationId, input.CountryCode, LogisticsRoles, ct);
        CountryLocations.Validate(input.CountryCode, input.Latitude, input.Longitude);
        if (input.AdministrativeDivisionId is { } divisionId &&
            (await store.FindAsync<AdministrativeDivision>(divisionId, ct))?.CountryCode != input.CountryCode)
            throw new RuleException("Choose an administrative division in the resource country.");
        if (string.IsNullOrWhiteSpace(input.LocationText)) throw new RuleException("Enter a resource location.");
        var name = input.Name.Trim();
        var unit = input.Unit.Trim();
        if (name.Length == 0 || unit.Length == 0 || unit.Length > 40) throw new RuleException("Enter a resource name and unit.");
        QuantityUnits.ValidateInventory(input.Stock, unit);
        if (input.LowStockThreshold is { } threshold) QuantityUnits.ValidateInventory(threshold, unit);
        if (input.DepotId is { } depotId)
        {
            var depot = await store.FindAsync<Depot>(depotId, ct) ?? throw new MissingException();
            if (depot.CountryCode != input.CountryCode || depot.OrganisationId != input.OrganisationId)
                throw new AccessDeniedException();
            await access.RequirePartner(depot.OrganisationId, depot.CountryCode, ct);
        }
        var code = string.IsNullOrWhiteSpace(input.Code) ? null : input.Code.Trim();
        if (input.OperationId == Guid.Empty) throw new RuleException("Provide a unique resource reference.");
        if (input.OperationId is { } operationId && await store.FindAsync<Resource>(operationId, ct) is { } existing)
        {
            if (existing.CountryCode != input.CountryCode || existing.OrganisationId != input.OrganisationId) throw new AccessDeniedException();
            if (existing.DepotId != input.DepotId || existing.Name != name || existing.Code != code ||
                existing.Unit != unit || existing.Category != input.Category)
                throw new RuleException("This resource registration reference has already been used.");
            return existing;
        }
        var r = new Resource { Id = input.OperationId ?? Guid.NewGuid(), CountryCode = input.CountryCode, AdministrativeDivisionId = input.AdministrativeDivisionId, OrganisationId = input.OrganisationId, DepotId = input.DepotId, Code = code, LowStockThreshold = input.LowStockThreshold, Name = name, Category = input.Category, Unit = unit, Stock = input.Stock, LocationText = input.LocationText, Latitude = input.Latitude, Longitude = input.Longitude, Suitability = input.Suitability, TransportAvailable = input.TransportAvailable };
        store.Add(r);
        store.Add(new StockMovement { ResourceId = r.Id, OperationId = r.Id, Quantity = r.Stock, Kind = "Opening", ActorId = access.UserId, Destination = r.LocationText, Note = "Resource registered." });
        Audit("ResourceCreated", r);
        return r;
    }, ct);
    public async Task Replenish(Guid id, MovementInput input, CancellationToken ct)
    {
        var r = await store.FindAsync<Resource>(id, ct) ?? throw new MissingException();
        await access.RequireLocation(r.OrganisationId, r.CountryCode, LogisticsRoles, ct);
        QuantityUnits.ValidateInventory(input.Quantity, r.Unit);
        r.ChangePhysical(input.Quantity);
        var movement = new StockMovement { ResourceId = id, Quantity = input.Quantity, Kind = "Replenishment", ActorId = access.UserId, Note = input.Note, Destination = r.LocationText };
        movement.OperationId = movement.Id;
        store.Add(movement);
        Audit("StockReplenished", r, input.Note);
        await store.SaveAsync(ct);
    }
    public async Task<List<StockMovement>> StockHistory(Guid id, CancellationToken ct)
    {
        var r = await store.FindAsync<Resource>(id, ct) ?? throw new MissingException();
        await access.RequireLocation(r.OrganisationId, r.CountryCode, LogisticsRoles, ct);
        return await store.ListAsync(store.Query<StockMovement>().Where(x => x.ResourceId == id).OrderByDescending(x => x.CreatedAt), ct);
    }
    public async Task<List<Resource>> CaseResources(Guid requestId, CancellationToken ct)
    {
        var request = await access.Request(requestId, LogisticsRoles, ct);
        var crisis = await store.FindAsync<Crisis>(request.CrisisId, ct) ?? throw new MissingException();
        return await store.ListAsync((await access.Located<Resource>(ct, request.CrisisId, LogisticsRoles)).Where(x => x.CountryCode == crisis.CountryCode && x.Category == request.Category && store.Query<OrganisationCountry>().Any(o => o.OrganisationId == x.OrganisationId && o.CountryCode == x.CountryCode && (o.VerificationState == "Verified" || o.VerificationState == "LegacyActive"))), ct);
    }
    public async Task<List<Shelter>> CaseShelters(Guid requestId, CancellationToken ct)
    {
        var request = await access.Request(requestId, ShelterRoles, ct);
        var crisis = await store.FindAsync<Crisis>(request.CrisisId, ct) ?? throw new MissingException();
        return await store.ListAsync((await access.Located<Shelter>(ct, request.CrisisId, ShelterRoles)).Where(x => x.CountryCode == crisis.CountryCode && store.Query<OrganisationCountry>().Any(o => o.OrganisationId == x.OrganisationId && o.CountryCode == x.CountryCode && (o.VerificationState == "Verified" || o.VerificationState == "LegacyActive"))), ct);
    }
    public async Task<List<ShelterCandidate>> ShelterRecommendations(Guid requestId, CancellationToken ct)
    {
        var request = await access.Request(requestId, ShelterRoles, ct);
        var shelters = await CaseShelters(requestId, ct);
        return shelters.Where(s => s.Open && s.Available >= request.HouseholdSize &&
            (string.IsNullOrWhiteSpace(request.AccessibilityNeeds) || s.Accessible))
            .Select(s =>
            {
                double? distance = request.Latitude.HasValue && request.Longitude.HasValue
                    ? Math.Round(RankedAllocationStrategy.Distance(request.Latitude.Value, request.Longitude.Value, s.Latitude, s.Longitude), 1)
                    : null;
                return new ShelterCandidate(s.Id, s.Name, s.Available, s.Accessible, distance,
                    $"Capacity for {request.HouseholdSize} people. " +
                    (distance.HasValue ? $"{distance:0.0} km straight-line distance. " : "Request location unavailable. ") +
                    "Check facilities, accessibility needs, transport and arrival conditions before reserving.");
            }).OrderBy(s => s.DistanceKm ?? double.MaxValue).ThenByDescending(s => s.Accessible)
            .ThenByDescending(s => s.Available).ThenBy(s => s.Id).ToList();
    }
    public async Task<AllocationRecommendations> AllocationRecommendations(Guid requestId, CancellationToken ct)
    {
        var request = await access.Request(requestId, LogisticsRoles, ct);
        var crisis = await store.FindAsync<Crisis>(request.CrisisId, ct) ?? throw new MissingException();
        var orgs = (await access.Memberships(ct)).Where(x => LogisticsRoles.Contains(x.Role)).Select(x => x.OrganisationId).Distinct().ToArray();
        var resources = await store.ListAsync((await access.Located<Resource>(ct, request.CrisisId, LogisticsRoles)).Where(x => x.Category == request.Category && x.CountryCode == crisis.CountryCode && store.Query<OrganisationCountry>().Any(o => o.OrganisationId == x.OrganisationId && o.CountryCode == x.CountryCode && (o.VerificationState == "Verified" || o.VerificationState == "LegacyActive"))), ct);
        var cases = await store.ListAsync((await access.Visible(ct)).Where(x => x.OrganisationId == request.OrganisationId && x.CrisisId == request.CrisisId && x.Category == request.Category && (x.Status == RequestStatus.Approved || x.Status == RequestStatus.InProgress || x.Status == RequestStatus.PartiallyFulfilled)), ct);
        if (!cases.Any(x => x.Id == request.Id)) cases.Add(request);
        var ids = cases.Select(x => x.Id).ToArray();
        var commitments = await store.ListAsync(store.Query<ResourceAllocation>().Where(x => ids.Contains(x.RequestId) &&
            (x.Status == AllocationStatus.Reserved || x.Status == AllocationStatus.Dispatched)), ct);
        var approvals = await store.ListAsync(store.Query<RequestHistory>().Where(x => ids.Contains(x.RequestId) && x.Status == "Approved"), ct);
        var demand = cases.Select(x => new AllocationDemand(x, commitments.Where(a => a.RequestId == x.Id).Sum(a => a.Quantity), approvals.Where(h => h.RequestId == x.Id).Select(h => (DateTimeOffset?)h.CreatedAt).Min() ?? x.CreatedAt)).ToList();
        return allocationStrategy.Recommend(request, demand.Single(x => x.Request.Id == request.Id).Committed, resources, demand);
    }
    public async Task IgnoreAllocationRecommendation(Guid requestId, Guid resourceId, CancellationToken ct)
    {
        var request = await access.Request(requestId, LogisticsRoles, ct);
        var recommendations = await AllocationRecommendations(requestId, ct);
        if (recommendations.Candidates.FirstOrDefault(x => x.TransportAvailable)?.ResourceId != resourceId) throw new RuleException("The recommendation has changed; refresh it first.");
        Audit("AllocationRecommendationIgnored", request, $"Recommended resource {resourceId}; staff chose to ignore it.", await CrisisCountry(request.CrisisId, ct));
        await store.SaveAsync(ct);
    }
    public Task<ResourceAllocation> Allocate(AllocateInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var r = await access.Request(input.RequestId, LogisticsRoles, ct);
        var resource = await store.FindAsync<Resource>(input.ResourceId, ct) ?? throw new MissingException();
        await access.RequireLocation(resource.OrganisationId, resource.CountryCode, LogisticsRoles, ct, r.CrisisId);
        var crisis = await store.FindAsync<Crisis>(r.CrisisId, ct) ?? throw new MissingException();
        if (resource.CountryCode != crisis.CountryCode)
            throw new RuleException("A resource must be in the same country as the crisis.");
        if (r.Status is not (RequestStatus.Approved or RequestStatus.InProgress or RequestStatus.PartiallyFulfilled))
            throw new RuleException("Verify and approve this case before allocating aid.");
        var committed = (await store.ListAsync(store.Query<ResourceAllocation>().Where(x => x.RequestId == r.Id &&
            (x.Status == AllocationStatus.Reserved || x.Status == AllocationStatus.Dispatched)), ct)).Sum(x => x.Quantity);
        if (input.RecommendedResourceId.HasValue)
        {
            var current = await AllocationRecommendations(r.Id, ct);
            if (current.Candidates.FirstOrDefault(x => x.TransportAvailable)?.ResourceId != input.RecommendedResourceId.Value)
                throw new RuleException("The recommendation has changed; refresh it before reserving.");
        }
        QuantityUnits.ValidateWhole(input.Quantity, resource.Unit);
        await access.RequirePartner(resource.OrganisationId, resource.CountryCode, ct);
        allocationPolicy.Validate(r, resource, input.Quantity, committed);
        resource.Reserve(input.Quantity);
        var previousStatus = r.Status;
        var allocation = new ResourceAllocation { RequestId = r.Id, ResourceId = resource.Id, Quantity = input.Quantity, ApprovedBy = access.UserId };
        store.Add(allocation);
        store.Add(new StockMovement { ResourceId = resource.Id, OperationId = allocation.Id, RequestId = r.Id, CrisisId = r.CrisisId, Quantity = input.Quantity, Kind = "Reserved", ActorId = access.UserId, Origin = resource.LocationText, Destination = r.Reference, Note = "Reserved for the authorised request." });
        if (r.Status == RequestStatus.Approved)
            r.Transition(RequestStatus.InProgress);
        await RecordChange(r, $"{input.Quantity} {resource.Unit} reserved; remaining needs stay open.", ct, previousStatus);
        Audit("ResourceReserved", allocation, countryCode: resource.CountryCode);
        if (input.RecommendedResourceId.HasValue)
        {
            var suggested = await store.FindAsync<Resource>(input.RecommendedResourceId.Value, ct) ?? throw new RuleException("Recommended resource not found.");
            await access.RequireLocation(suggested.OrganisationId, suggested.CountryCode, LogisticsRoles, ct, r.CrisisId);
            if (suggested.Category != r.Category) throw new RuleException("Recommended resource category does not match the request.");
            Audit(input.ResourceId == suggested.Id ? "AllocationRecommendationAccepted" : "AllocationRecommendationIgnored", r, $"Recommended resource {suggested.Id}; reserved resource {resource.Id}; quantity {input.Quantity}.", resource.CountryCode);
        }
        return allocation;
    }, ct);
    public Task<ResourceAllocation> UpdateAllocation(Guid id, string action, CancellationToken ct, string? reason = null, DeliveryInput? delivery = null) => store.TransactionAsync(async () =>
    {
        var a = await store.FindAsync<ResourceAllocation>(id, ct) ?? throw new MissingException();
        var r = await access.Request(a.RequestId, LogisticsRoles, ct);
        var resource = await store.FindAsync<Resource>(a.ResourceId, ct) ?? throw new MissingException();
        await access.RequireLocation(resource.OrganisationId, resource.CountryCode, LogisticsRoles, ct, r.CrisisId);
        if (resource.CountryCode != await CrisisCountry(r.CrisisId, ct)) throw new AccessDeniedException();
        if (action == "Deliver" && a.Status is AllocationStatus.Delivered or AllocationStatus.DeliveryException)
            return a;
        if (reason != null && (action, a.Status) is ("Dispatch", AllocationStatus.Dispatched) or
            ("Cancel", AllocationStatus.Cancelled))
            return a;
        var previousStatus = r.Status;
        var quantity = a.Quantity;
        DeliveryConfirmation? receipt = null;
        if (action == "Dispatch" && a.Status == AllocationStatus.Reserved)
        {
            resource.Dispatch(a.Quantity);
            a.Status = AllocationStatus.Dispatched;
        }
        else if (action == "Deliver" && a.Status == AllocationStatus.Dispatched)
        {
            receipt = DeliveryReceipts.Create(delivery, a.Quantity, resource.Unit, a.UpdatedAt, access.UserId);
            receipt.AllocationId = a.Id;
            quantity = receipt.ConfirmedQuantity;
            if (quantity > 0) r.Deliver(quantity);
            store.Add(receipt);
            a.Status = quantity > 0 ? AllocationStatus.Delivered : AllocationStatus.DeliveryException;
        }
        else if (action == "Cancel" && a.Status == AllocationStatus.Reserved)
        {
            resource.Release(a.Quantity);
            a.Status = AllocationStatus.Cancelled;
        }
        else
            throw new RuleException("Invalid allocation action. Dispatched aid cannot be silently returned to stock.");
        store.Add(new StockMovement { ResourceId = resource.Id, OperationId = a.Id, RequestId = r.Id, CrisisId = r.CrisisId, Quantity = quantity, Kind = a.Status == AllocationStatus.DeliveryException ? "DeliveryException" : action, ActorId = access.UserId, Origin = resource.LocationText, Destination = r.Reference, Note = reason ?? "Stock movement for the authorised request." });
        var message = receipt is null ? $"Aid allocation: {action}." :
            quantity == 0 ? "Delivery attempt recorded. No aid was received and the case remains open." :
            receipt.ExceptionDetail.Length > 0 ? $"Delivery confirmed for {quantity} {resource.Unit}. A delivery exception was recorded." :
            $"Delivery confirmed for {quantity} {resource.Unit}.";
        await RecordChange(r, message, ct, previousStatus);
        Audit("Allocation" + action, a, reason ?? "", resource.CountryCode);
        if (receipt?.ExceptionDetail.Length > 0) Audit("DeliveryException", a, "See the delivery confirmation for details.", resource.CountryCode);
        return a;
    }, ct);

    public async Task<DeliveryConfirmation> AllocationReceipt(Guid id, CancellationToken ct)
    {
        var allocation = await store.FindAsync<ResourceAllocation>(id, ct) ?? throw new MissingException();
        var request = await access.Request(allocation.RequestId, LogisticsRoles, ct);
        var resource = await store.FindAsync<Resource>(allocation.ResourceId, ct) ?? throw new MissingException();
        await access.RequireLocation(resource.OrganisationId, resource.CountryCode, LogisticsRoles, ct, request.CrisisId);
        return (await store.ListAsync(store.Query<DeliveryConfirmation>().Where(x => x.AllocationId == id), ct)).SingleOrDefault()
            ?? throw new MissingException();
    }
    public Task<Shelter> SaveShelter(Guid? id, ShelterInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        if (access.SelectedCountry is { } selected && selected != input.CountryCode)
            throw new AccessDeniedException();
        await access.RequireLocation(input.OrganisationId, input.CountryCode, ShelterRoles, ct);
        if (input.AdministrativeDivisionId is Guid divisionId &&
            (await store.FindAsync<AdministrativeDivision>(divisionId, ct))?.CountryCode != input.CountryCode)
            throw new RuleException("Choose an administrative division in the shelter country.");
        var shelter = id.HasValue ? await store.FindAsync<Shelter>(id.Value, ct) ?? throw new MissingException() : new Shelter { CountryCode = input.CountryCode, AdministrativeDivisionId = input.AdministrativeDivisionId, OrganisationId = input.OrganisationId };
        if (shelter.OrganisationId != input.OrganisationId || shelter.CountryCode != input.CountryCode)
            throw new AccessDeniedException();
        if (input.Capacity < shelter.Occupancy + shelter.Reserved)
            throw new RuleException("Capacity cannot be below active reservations and occupancy.");
        if (!id.HasValue) await access.RequirePartner(input.OrganisationId, input.CountryCode, ct);
        var oldCapacity = shelter.Capacity;
        var wasOpen = shelter.Open;
        shelter.Name = input.Name;
        shelter.AdministrativeDivisionId = input.AdministrativeDivisionId;
        shelter.Address = input.Address;
        shelter.Latitude = input.Latitude;
        shelter.Longitude = input.Longitude;
        shelter.Capacity = input.Capacity;
        shelter.Accessible = input.Accessible;
        shelter.Open = input.Open;
        shelter.Facilities = input.Facilities;
        shelter.UpdatedAt = DateTimeOffset.UtcNow;
        if (!id.HasValue)
            store.Add(shelter);
        Audit(id.HasValue ? "ShelterUpdated" : "ShelterCreated", shelter);
        if (id.HasValue && oldCapacity != shelter.Capacity)
            Audit("ShelterCapacityChanged", shelter, $"{oldCapacity} → {shelter.Capacity} spaces");
        if (id.HasValue && wasOpen != shelter.Open)
            Audit("ShelterStatusChanged", shelter, shelter.Open ? "Open" : "Closed");
        return shelter;
    }, ct);
    public Task<ShelterAllocation> Place(ShelterPlaceInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var r = await access.Request(input.RequestId, ShelterRoles, ct);
        if (r.Category != AidCategory.Shelter || r.Status is not (RequestStatus.Approved or RequestStatus.InProgress))
            throw new RuleException("Choose an approved shelter request.");
        if (r.Quantity != 1 || r.DeliveredQuantity != 0)
            throw new RuleException("This shelter request must represent one outstanding household placement. Review the request before reserving.");
        if ((await store.ListAsync(store.Query<ShelterAllocation>().Where(x => x.RequestId == r.Id && x.Status != StayStatus.Cancelled && x.Status != StayStatus.Departed), ct)).Count > 0)
            throw new RuleException("This household already has an active placement.");
        var shelter = await store.FindAsync<Shelter>(input.ShelterId, ct) ?? throw new MissingException();
        await access.RequireLocation(shelter.OrganisationId, shelter.CountryCode, ShelterRoles, ct, r.CrisisId);
        var crisis = await store.FindAsync<Crisis>(r.CrisisId, ct) ?? throw new MissingException();
        if (shelter.CountryCode != crisis.CountryCode)
            throw new RuleException("A shelter must be in the same country as the crisis.");
        if (r.AccessibilityNeeds.Length > 0 && !shelter.Accessible)
            throw new RuleException("This household requires an accessible shelter.");
        var previousStatus = r.Status;
        await access.RequirePartner(shelter.OrganisationId, shelter.CountryCode, ct);
        shelter.Reserve(r.HouseholdSize);
        var placement = new ShelterAllocation { RequestId = r.Id, ShelterId = shelter.Id, People = r.HouseholdSize, ApprovedBy = access.UserId };
        store.Add(placement);
        if (r.Status == RequestStatus.Approved)
            r.Transition(RequestStatus.InProgress);
        await RecordChange(r, "Shelter spaces reserved; check-in is still required.", ct, previousStatus);
        Audit("ShelterReserved", placement, countryCode: shelter.CountryCode);
        return placement;
    }, ct);
    public Task<ShelterAllocation> UpdateStay(Guid id, string action, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var stay = await store.FindAsync<ShelterAllocation>(id, ct) ?? throw new MissingException();
        var r = await store.FindAsync<AssistanceRequest>(stay.RequestId, ct) ?? throw new MissingException();
        var shelter = await store.FindAsync<Shelter>(stay.ShelterId, ct) ?? throw new MissingException();
        await access.RequireLocation(shelter.OrganisationId, shelter.CountryCode, ShelterRoles, ct, r.CrisisId);
        if (shelter.CountryCode != await CrisisCountry(r.CrisisId, ct)) throw new AccessDeniedException();
        var previousStatus = r.Status;
        if (action == "CheckIn" && stay.Status == StayStatus.Reserved)
        {
            if (r.Category != AidCategory.Shelter || r.Quantity != 1 || r.DeliveredQuantity != 0)
                throw new RuleException("This shelter request must represent one outstanding household placement. Review the request before check-in.");
            shelter.CheckIn(stay.People);
            stay.Status = StayStatus.CheckedIn;
            r.Deliver(1);
        }
        else if (action == "Depart" && stay.Status == StayStatus.CheckedIn)
        {
            shelter.Release(stay.People, true);
            stay.Status = StayStatus.Departed;
        }
        else if (action == "Cancel" && stay.Status == StayStatus.Reserved)
        {
            shelter.Release(stay.People, false);
            stay.Status = StayStatus.Cancelled;
        }
        else
            throw new RuleException("Invalid shelter action.");
        await RecordChange(r, "Shelter placement: " + action, ct, previousStatus);
        Audit("Shelter" + action, stay, countryCode: shelter.CountryCode);
        return stay;
    }, ct);
    public async Task<VolunteerRoster> Volunteers(CancellationToken ct, string? scopeRole = null)
    {
        var global = scopeRole == null && await access.IsAdmin(ct);
        var grants = store.Query<Membership>().Where(m => m.UserId == access.UserId);
        if (scopeRole != null) grants = grants.Where(m => m.Role == scopeRole);
        var q = store.Query<VolunteerProfile>().Where(x => access.SelectedCountry == null || x.CountryCode == access.SelectedCountry)
            .Where(x => global || grants.Any(m => m.CountryCode == x.CountryCode &&
                (m.Role == Roles.CountryAdministrator || m.OrganisationId == x.OrganisationId &&
                    (VolunteerRoles.Contains(m.Role) || x.UserId == access.UserId && m.Role == Roles.Volunteer))));
        var profiles = await store.ListAsync(q, ct);
        var tasks = await store.ListAsync((from task in store.Query<VolunteerTask>()
            join volunteer in q on task.VolunteerId equals volunteer.Id
            join request in store.Query<AssistanceRequest>() on task.RequestId equals request.Id
            join crisis in store.Query<Crisis>() on request.CrisisId equals crisis.Id
            where crisis.CountryCode == volunteer.CountryCode && (global || grants.Any(m =>
                m.CountryCode == crisis.CountryCode && (m.CrisisId == null || m.CrisisId == crisis.Id) &&
                (m.Role == Roles.CountryAdministrator || m.OrganisationId == volunteer.OrganisationId &&
                    (VolunteerRoles.Contains(m.Role) && (m.OrganisationId == request.OrganisationId ||
                        m.Role == Roles.Coordinator && store.Query<CrisisAssignment>().Any(a => a.CrisisId == crisis.Id && a.UserId == access.UserId))
                     || m.Role == Roles.Volunteer && volunteer.UserId == access.UserId))))
            orderby task.DueAt
            select task), ct);
        var ids = tasks.Select(t => t.Id).ToArray();
        var history = await store.ListAsync(store.Query<VolunteerTaskEvent>().Where(e => ids.Contains(e.TaskId)).OrderBy(e => e.CreatedAt), ct);
        return new(profiles, tasks, history);
    }
    public async Task<VolunteerProfile> SaveVolunteer(VolunteerProfile input, CancellationToken ct)
    {
        await access.RequireLocation(input.OrganisationId, input.CountryCode, VolunteerRoles, ct);
        if ((await store.ListAsync(store.Query<Membership>().Where(x => x.UserId == input.UserId && x.OrganisationId == input.OrganisationId && x.CountryCode == input.CountryCode && x.CrisisId == null && x.Role == Roles.Volunteer), ct)).Count == 0)
            throw new RuleException("An administrator must create a volunteer membership in this organisation first.");
        var existing = (await store.ListAsync(store.Query<VolunteerProfile>().Where(x => x.UserId == input.UserId), ct)).SingleOrDefault();
        if (existing is not null && (existing.OrganisationId != input.OrganisationId || existing.CountryCode != input.CountryCode))
            throw new AccessDeniedException();
        var v = existing ?? new VolunteerProfile { CountryCode = input.CountryCode, UserId = input.UserId, OrganisationId = input.OrganisationId };
        v.Skills = input.Skills;
        v.Availability = input.Availability;
        v.Verified = input.Verified;
        v.Available = input.Available;
        if (existing is null)
            store.Add(v);
        Audit("VolunteerSaved", v);
        await store.SaveAsync(ct);
        return v;
    }
    public async Task<List<VolunteerCase>> VolunteerCases(string? search, CancellationToken ct)
    {
        var cases = (await access.Visible(ct)).Where(r => r.OrganisationId != null &&
            ActiveFulfilment.Contains(r.Status) && r.DeliveredQuantity < r.Quantity &&
            store.Query<OrganisationCountry>().Any(o => o.OrganisationId == r.OrganisationId &&
                (o.VerificationState == "Verified" || o.VerificationState == "LegacyActive") &&
                store.Query<Crisis>().Any(c => c.Id == r.CrisisId && c.CountryCode == o.CountryCode)));
        if (!await access.IsAdmin(ct))
        {
            var grants = store.Query<Membership>().Where(m => m.UserId == access.UserId &&
                (VolunteerRoles.Contains(m.Role) || m.Role == Roles.CountryAdministrator));
            cases = cases.Where(r => grants.Any(m => (m.CrisisId == null || m.CrisisId == r.CrisisId)
                && (m.OrganisationId == r.OrganisationId || m.Role == Roles.CountryAdministrator)
                && store.Query<Crisis>().Any(c => c.Id == r.CrisisId && c.CountryCode == m.CountryCode)));
        }
        if (!string.IsNullOrWhiteSpace(search))
            cases = cases.Where(r => r.Reference.Contains(search) || r.LocationText.Contains(search) || r.Description.Contains(search));
        return await store.ListAsync(cases.OrderByDescending(r => r.CreatedAt).Take(20)
            .Select(r => new VolunteerCase(r.Id, r.Reference, r.LocationText, r.OrganisationId!.Value)), ct);
    }

    public async Task<List<VolunteerCandidate>> VolunteerRecommendations(Guid requestId, DateTimeOffset startsAt, DateTimeOffset dueAt, string? requiredSkill, CancellationToken ct)
    {
        var request = await access.Request(requestId, VolunteerRoles, ct);
        var country = await CrisisCountry(request.CrisisId, ct);
        if (!request.OrganisationId.HasValue || !ActiveFulfilment.Contains(request.Status) || request.DeliveredQuantity >= request.Quantity) return [];
        await access.RequireLocation(request.OrganisationId.Value, country, VolunteerRoles, ct, request.CrisisId);
        await access.RequirePartner(request.OrganisationId.Value, country, ct);
        ValidateWindow(startsAt, dueAt);
        var memberships = store.Query<Membership>().Where(m => m.Role == Roles.Volunteer && m.OrganisationId == request.OrganisationId &&
            m.CountryCode == country && (m.CrisisId == null || m.CrisisId == request.CrisisId));
        var eligible = await store.ListAsync(store.Query<VolunteerProfile>().Where(v => v.Verified && v.Available &&
            v.OrganisationId == request.OrganisationId && v.CountryCode == country && memberships.Any(m => m.UserId == v.UserId)), ct);
        var skill = requiredSkill?.Trim() ?? "";
        var candidates = new List<VolunteerCandidate>();
        foreach (var v in eligible.Where(v => HasSkill(v, skill)))
        {
            var commitments = await OpenVolunteerCommitments(v.UserId, ct);
            if (commitments.Any(t => t.VolunteerId == v.Id && t.RequestId == request.Id || Overlaps(t, startsAt, dueAt))) continue;
            // Only count the scoped profile's own commitments in the display.
            candidates.Add(new(v.Id, v.Skills, v.Availability, commitments.Count(t => t.VolunteerId == v.Id),
                "Verified, marked available and free of recorded conflicts in this window. Confirm actual travel and availability before assigning."));
        }
        return candidates.OrderBy(c => c.OpenCommitments).ThenBy(c => c.Id).ToList();
    }

    public Task<VolunteerTask> AssignTask(TaskInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var request = await access.Request(input.RequestId, VolunteerRoles, ct);
        if (!ActiveFulfilment.Contains(request.Status) || request.DeliveredQuantity >= request.Quantity)
            throw new RuleException("Assign tasks only to approved or active cases with outstanding assistance.");
        var v = await store.FindAsync<VolunteerProfile>(input.VolunteerId, ct) ?? throw new MissingException();
        await access.RequireLocation(v.OrganisationId, v.CountryCode, VolunteerRoles, ct, request.CrisisId);
        if ((await store.FindAsync<Crisis>(request.CrisisId, ct))?.CountryCode != v.CountryCode) throw new RuleException("Volunteer and crisis countries must match.");
        if (v.OrganisationId != request.OrganisationId) throw new RuleException("Choose a volunteer from the organisation assigned to this case.");
        await access.RequirePartner(v.OrganisationId, v.CountryCode, ct);
        if (!v.Verified || !v.Available) throw new RuleException("Choose a verified, available volunteer.");
        if ((await store.ListAsync(store.Query<Membership>().Where(m => m.UserId == v.UserId && m.Role == Roles.Volunteer
            && m.OrganisationId == v.OrganisationId && m.CountryCode == v.CountryCode && (m.CrisisId == null || m.CrisisId == request.CrisisId)), ct)).Count == 0)
            throw new RuleException("This volunteer no longer has a membership for the case.");
        var skill = (input.RequiredSkill ?? "").Trim();
        if (!HasSkill(v, skill))
            throw new RuleException("The volunteer does not have the required skill.");
        var startsAt = input.StartsAt ?? DateTimeOffset.UtcNow;
        ValidateWindow(startsAt, input.DueAt);
        var commitments = await OpenVolunteerCommitments(v.UserId, ct);
        if (commitments.Any(t => t.VolunteerId == v.Id && t.RequestId == request.Id))
            throw new RuleException("This volunteer already has an open assignment for this case.");
        if (commitments.Any(t => Overlaps(t, startsAt, input.DueAt)))
            throw new RuleException("The volunteer has another assignment that overlaps this scheduled window.");
        var task = new VolunteerTask { RequestId = input.RequestId, VolunteerId = v.Id, Title = input.Title.Trim(),
            RequiredSkill = skill, StartsAt = startsAt, DueAt = input.DueAt };
        store.Add(task);
        store.Add(new VolunteerTaskEvent { TaskId = task.Id, Action = "Assign", ActorId = access.UserId });
        Audit("VolunteerAssigned", task, countryCode: v.CountryCode);
        notifications.TaskAssigned(task, v, request);
        await notifications.RequestChanged(request, $"Task assigned: {task.Title}.", ct);
        return task;
    }, ct);
    private Task<List<VolunteerTask>> OpenVolunteerCommitments(string userId, CancellationToken ct)
    {
        var profiles = store.Query<VolunteerProfile>().Where(v => v.UserId == userId);
        return store.ListAsync(store.Query<VolunteerTask>().Where(t => OpenTasks.Contains(t.Status) && profiles.Any(v => v.Id == t.VolunteerId)), ct);
    }
    private static bool HasSkill(VolunteerProfile volunteer, string skill) =>
        skill.Length == 0 || volunteer.Skills.Split(',', StringSplitOptions.TrimEntries).Contains(skill, StringComparer.OrdinalIgnoreCase);
    private static bool Overlaps(VolunteerTask task, DateTimeOffset startsAt, DateTimeOffset dueAt)
    {
        var windowStart = task.StartsAt;
        if (!windowStart.HasValue && task.Status == VolunteerTaskStatus.InProgress) windowStart = task.CreatedAt;
        return ScheduledTasks.Contains(task.Status) && windowStart < dueAt && startsAt < task.DueAt;
    }
    private static void ValidateWindow(DateTimeOffset startsAt, DateTimeOffset dueAt)
    {
        if (dueAt <= DateTimeOffset.UtcNow || startsAt >= dueAt) throw new RuleException("Choose a future due date after the start.");
    }
    public Task<VolunteerTask> UpdateTask(Guid id, TaskUpdateInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var task = await store.FindAsync<VolunteerTask>(id, ct) ?? throw new MissingException();
        var v = await store.FindAsync<VolunteerProfile>(task.VolunteerId, ct) ?? throw new MissingException();
        var request = await store.FindAsync<AssistanceRequest>(task.RequestId, ct) ?? throw new MissingException();
        var country = await CrisisCountry(request.CrisisId, ct);
        if (v.CountryCode != country || access.SelectedCountry is { } selected && selected != country)
            throw new AccessDeniedException();
        var note = input.Note?.Trim() ?? "";
        var description = input.WorkDescription?.Trim() ?? "";
        var outcome = input.Outcome?.Trim() ?? "";
        if (input.Action is "Verify" or "Return")
        {
            await access.RequireLocation(v.OrganisationId, v.CountryCode, VolunteerRoles, ct, request.CrisisId);
            await access.Request(task.RequestId, VolunteerRoles, ct);
            if (v.UserId == access.UserId) throw new AccessDeniedException();
            if (task.Status != VolunteerTaskStatus.AwaitingVerification)
                throw new RuleException("Task is not ready for verification.");
            if (note.Length < 5) throw new RuleException("Record the reason for returning or verifying this report.");
            if (input.Action == "Verify" && (await store.ListAsync(store.Query<VolunteerTaskEvent>()
                .Where(e => e.TaskId == id && e.Action == "Complete").Take(1), ct)).Count == 0)
                throw new RuleException("Return this task to request a completion report before verifying.");
            task.Status = input.Action == "Verify" ? VolunteerTaskStatus.Completed : VolunteerTaskStatus.Returned;
            notifications.TaskReviewed(task, v, request, input.Action);
        }
        else
        {
            if (v.UserId != access.UserId || !v.Verified)
                throw new AccessDeniedException();
            await access.RequireLocation(v.OrganisationId, v.CountryCode, [Roles.Volunteer], ct, request.CrisisId);
            if (input.Action == "Start" && task.Status == VolunteerTaskStatus.Accepted)
            {
                if (task.StartsAt > DateTimeOffset.UtcNow) throw new RuleException("The scheduled assignment has not started.");
                if ((await OpenVolunteerCommitments(v.UserId, ct)).Any(t => t.Id != id && t.Status == VolunteerTaskStatus.InProgress))
                    throw new RuleException("Complete the current in-progress assignment before starting another.");
            }
            if (input.Action == "Complete" && (description.Length < 10 || outcome.Length < 10))
                throw new RuleException("Describe the work and actual outcome in at least 10 characters each.");
            task.Status = (input.Action, task.Status) switch
            {
                ("Accept", VolunteerTaskStatus.Assigned) => VolunteerTaskStatus.Accepted,
                ("Decline", VolunteerTaskStatus.Assigned) => VolunteerTaskStatus.Declined,
                ("Start", VolunteerTaskStatus.Accepted) => VolunteerTaskStatus.InProgress,
                ("Complete", VolunteerTaskStatus.InProgress or VolunteerTaskStatus.Returned) => VolunteerTaskStatus.AwaitingVerification,
                _ => throw new RuleException("Invalid task action.")
            };
        }
        task.Note = note;
        store.Add(new VolunteerTaskEvent
        {
            TaskId = id, ActorId = access.UserId, Action = input.Action, Note = note,
            WorkDescription = input.Action == "Complete" ? description : "",
            Outcome = input.Action == "Complete" ? outcome : "",
            PeopleAssisted = input.Action == "Complete" ? input.PeopleAssisted : null,
            Issues = input.Action == "Complete" ? input.Issues?.Trim() ?? "" : "",
        });
        Audit("VolunteerTask" + input.Action, task, countryCode: country);
        if (input.Action == "Complete") await notifications.TaskSubmitted(v, request, ct);
        return task;
    }, ct);
    public async Task Feedback(Guid id, FeedbackInput input, CancellationToken ct)
    {
        var r = await access.Request(id, ct: ct);
        if (r.CitizenId != access.UserId || r.Status is not (RequestStatus.PartiallyFulfilled or RequestStatus.Fulfilled or RequestStatus.Closed))
            throw new AccessDeniedException();
        store.Add(new Feedback { RequestId = id, UserId = access.UserId, Rating = input.Rating, Received = input.Received, Problem = input.Problem, Comment = input.Comment });
        if (input.Problem)
            r.Escalated = true;
        Audit("FeedbackRecorded", r, countryCode: await CrisisCountry(r.CrisisId, ct));
        await store.SaveAsync(ct);
    }
    public async Task<object> Metrics(CancellationToken ct)
    {
        var cases = await access.Visible(ct);
        var ids = cases.Select(x => x.Id);
        var orgs = await OrgScope(ct);
        var cutoff = DateTimeOffset.UtcNow.AddHours(-24);
        var statuses = await store.ListAsync(cases.GroupBy(x => x.Status).Select(g => new { Status = g.Key, Count = g.Count() }), ct);
        var caseTotals = (await store.ListAsync(cases.GroupBy(x => 1).Select(g => new {
            Escalated = g.Count(x => x.Escalated),
            Overdue = g.Count(x => x.CreatedAt < cutoff && x.Status != RequestStatus.Closed && x.Status != RequestStatus.Fulfilled && x.Status != RequestStatus.Cancelled && x.Status != RequestStatus.Rejected)
        }), ct)).SingleOrDefault();
        var shelterTotals = (await store.ListAsync((await access.Located<Shelter>(ct)).GroupBy(x => 1).Select(g => new { Occupancy = g.Sum(x => x.Occupancy), Reserved = g.Sum(x => x.Reserved), Capacity = g.Sum(x => x.Capacity) }), ct)).SingleOrDefault();
        var resourceTotals = (await store.ListAsync((await access.Located<Resource>(ct)).GroupBy(x => 1).Select(g => new { Reserved = g.Sum(x => x.Reserved), Stock = g.Sum(x => x.Stock) }), ct)).SingleOrDefault();
        var stockByUnit = await store.ListAsync((await access.Located<Resource>(ct)).GroupBy(x => new { x.Category, x.Unit }).Select(g => new { g.Key.Category, g.Key.Unit, Stock = g.Sum(x => x.Stock), Reserved = g.Sum(x => x.Reserved) }), ct);
        var decisionCounts = await store.ListAsync(store.Query<HumanDecision>().Where(x => ids.Contains(x.RequestId)).GroupBy(x => x.Action).Select(g => new { Action = g.Key, Count = g.Count() }), ct);
        int decisions = decisionCounts.Sum(x => x.Count);
        int approved = decisionCounts.Where(x => x.Action == "Approve").Sum(x => x.Count);
        int modified = decisionCounts.Where(x => x.Action == "Modify").Sum(x => x.Count);
        int rejected = decisionCounts.Where(x => x.Action == "Reject").Sum(x => x.Count);
        int deferred = decisionCounts.Where(x => x.Action == "Defer").Sum(x => x.Count);
        // SQL finds each first review; only the paired timestamps are transferred for the precise average.
        var firstReviews = await store.ListAsync(
            from history in store.Query<RequestHistory>()
            join request in cases on history.RequestId equals request.Id
            where history.Status == "UnderReview"
            group history by new { request.Id, request.CreatedAt } into reviews
            select new { reviews.Key.CreatedAt, FirstReview = reviews.Min(x => x.CreatedAt) }, ct);
        var shortages = await store.ListAsync(cases.Where(x => x.Status == RequestStatus.Approved || x.Status == RequestStatus.PartiallyFulfilled).Select(x => new { x.Id, x.Reference, x.Priority, Outstanding = x.Quantity - x.DeliveredQuantity, x.Category }), ct);
        return new
        {
            OpenCases = statuses.Where(x => x.Status is not (RequestStatus.Closed or RequestStatus.Fulfilled or RequestStatus.Rejected or RequestStatus.Cancelled)).Sum(x => x.Count),
            ResolvedCases = statuses.Where(x => x.Status is RequestStatus.Closed or RequestStatus.Fulfilled).Sum(x => x.Count),
            OverdueCases = caseTotals?.Overdue ?? 0,
            EscalatedCases = caseTotals?.Escalated ?? 0,
            AverageResponseHours = firstReviews.Count == 0 ? (double?)null : Math.Round(firstReviews.Average(x => (x.FirstReview - x.CreatedAt).TotalHours), 1),
            ShelterOccupancy = shelterTotals?.Occupancy ?? 0,
            ShelterReserved = shelterTotals?.Reserved ?? 0,
            ShelterCapacity = shelterTotals?.Capacity ?? 0,
            StockByUnit = stockByUnit,
            ResourceReserved = resourceTotals?.Reserved ?? 0,
            ResourceStock = resourceTotals?.Stock ?? 0,
            AiOverrideFrequency = AiDecisionMetrics.OverrideFrequency(modified, rejected, decisions),
            AiApprovedCount = approved, AiModifiedCount = modified, AiRejectedCount = rejected, AiDeferredCount = deferred,
            ByStatus = statuses.Select(x => new { Status = x.Status.ToString(), x.Count }),
            Shortages = shortages
        };
    }
}
