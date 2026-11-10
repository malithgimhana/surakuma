using Surakuma.Domain;
using VolunteerTaskStatus = Surakuma.Domain.TaskStatus;

namespace Surakuma.Application;

public sealed class Operations(IStore store, AccessService access, IAiProvider ai, IAllocationPolicy allocationPolicy, IAllocationStrategy allocationStrategy)
{
    private static readonly string[] CaseRoles = [Roles.CaseManager, Roles.Coordinator];
    private static readonly string[] LogisticsRoles = [Roles.Logistics, Roles.Coordinator];
    private static readonly string[] ShelterRoles = [Roles.ShelterAdmin, Roles.Coordinator];
    private static readonly string[] VolunteerRoles = [Roles.VolunteerCoordinator, Roles.Coordinator];

    public void Audit(string action, Record record, string detail = "") => store.Add(new AuditEvent { ActorId = access.UserId, Action = action, EntityId = record.Id, EntityType = record.GetType().Name, Detail = detail });
    private void RecordChange(AssistanceRequest r, string note, string? historyStatus = null)
    {
        store.Add(new RequestHistory { RequestId = r.Id, ActorId = access.UserId, Status = historyStatus ?? r.Status.ToString(), Note = note });
        store.Add(new OutboxMessage { UserId = r.CitizenId, RequestId = r.Id, Message = CitizenMessages.Status(r.Reference, r.Status, "en"), SinhalaMessage = CitizenMessages.Status(r.Reference, r.Status, "si"), TamilMessage = CitizenMessages.Status(r.Reference, r.Status, "ta") });
        Audit("CaseChanged", r, note);
    }
    public async Task<PublicLookups> PublicData(CancellationToken ct) => new(
        await store.ListAsync(store.Query<Crisis>().Where(x => x.Active).OrderBy(x => x.Name).Select(x => new PublicLookup(x.Id, x.Name)), ct),
        await store.ListAsync(store.Query<Organisation>().OrderBy(x => x.Name).Select(x => new PublicLookup(x.Id, x.Name)), ct));
    public async Task<List<PublicAlert>> Alerts(CancellationToken ct) => await store.ListAsync(store.Query<PublicAlert>().Where(x => x.Published && x.ExpiresAt > DateTimeOffset.UtcNow).OrderByDescending(x => x.CreatedAt), ct);
    public Task<List<PublicShelter>> PublicShelters(CancellationToken ct) => store.ListAsync(store.Query<Shelter>().OrderBy(x => x.Name).Select(x => new PublicShelter(x.Id, x.Name, x.Address, x.Latitude, x.Longitude, x.Capacity, x.Reserved, x.Occupancy, x.Capacity - x.Reserved - x.Occupancy, x.Accessible, x.Open, x.Facilities, x.UpdatedAt)), ct);
    public async Task<List<Shelter>> StaffShelters(CancellationToken ct)
    {
        var orgs = await OrgScope(ct);
        return await store.ListAsync(store.Query<Shelter>().Where(x => orgs.Contains(x.OrganisationId)).OrderBy(x => x.Name), ct);
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
        var r = new AssistanceRequest
        {
            CitizenId = access.UserId,
            CrisisId = input.CrisisId,
            OrganisationId = crisis.PrimaryOrganisationId,
            AssignmentStatus = crisis.PrimaryOrganisationId.HasValue ? AssignmentStatus.AutoAssigned : AssignmentStatus.Unassigned,
            AssignedCaseManagerId = crisis.PrimaryOrganisationId.HasValue ? await ChooseCaseManager(crisis.PrimaryOrganisationId.Value, ct) : null,
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
            Audit("RequestAssigned", r, $"Automatic centre {r.OrganisationId.Value}; case manager {r.AssignedCaseManagerId ?? "unassigned"}");
        RecordChange(r, "Request received. A staff member will review it.");
        return r;
    }, ct);
    private async Task<string?> ChooseCaseManager(Guid organisationId, CancellationToken ct)
    {
        var managers = (await store.ListAsync(store.Query<Membership>().Where(x => x.OrganisationId == organisationId && x.Role == Roles.CaseManager && x.AvailableForAssignment), ct)).Select(x => x.UserId).Distinct().ToArray();
        if (managers.Length == 0) return null;
        var active = await store.ListAsync(store.Query<AssistanceRequest>().Where(x => x.OrganisationId == organisationId && x.AssignedCaseManagerId != null && managers.Contains(x.AssignedCaseManagerId) && x.Status != RequestStatus.Fulfilled && x.Status != RequestStatus.Closed && x.Status != RequestStatus.Rejected && x.Status != RequestStatus.Cancelled), ct);
        return managers.OrderBy(id => active.Count(x => x.AssignedCaseManagerId == id)).ThenBy(id => id, StringComparer.Ordinal).First();
    }
    public async Task<Page<AssistanceRequest>> Requests(bool mine, string? status, string? search, int page, CancellationToken ct, bool assignedToMe = false)
    {
        var q = await access.Visible(ct);
        if (mine)
            q = q.Where(x => x.CitizenId == access.UserId);
        if (assignedToMe)
            q = q.Where(x => x.AssignedCaseManagerId == access.UserId);
        if (Enum.TryParse<RequestStatus>(status, out var state))
            q = q.Where(x => x.Status == state);
        if (!string.IsNullOrWhiteSpace(search))
            q = q.Where(x => x.Reference.Contains(search) || x.Description.Contains(search) || x.LocationText.Contains(search));
        int total = (await store.ListAsync(q.Select(x => x.Id), ct)).Count;
        page = Math.Max(1, page);
        return new(await store.ListAsync(q.OrderByDescending(x => x.CreatedAt).Skip((page - 1) * 20).Take(20), ct), total, page, 20);
    }
    public async Task<List<AssistanceRequest>> Triage(CancellationToken ct)
    {
        var memberships = await access.Memberships(ct);
        if (memberships.Any(x => x.Role == Roles.Administrator))
            return await store.ListAsync(store.Query<AssistanceRequest>().Where(x => (x.OrganisationId == null || x.AssignedCaseManagerId == null) && x.Status != RequestStatus.Closed && x.Status != RequestStatus.Fulfilled && x.Status != RequestStatus.Cancelled && x.Status != RequestStatus.Rejected).OrderBy(x => x.CreatedAt), ct);
        if (!memberships.Any(x => x.Role == Roles.Coordinator))
            throw new AccessDeniedException();
        var crises = (await store.ListAsync(store.Query<CrisisAssignment>().Where(x => x.UserId == access.UserId), ct)).Select(x => x.CrisisId).ToArray();
        return await store.ListAsync(store.Query<AssistanceRequest>().Where(x => (x.OrganisationId == null || x.AssignedCaseManagerId == null) && crises.Contains(x.CrisisId) && x.Status != RequestStatus.Closed && x.Status != RequestStatus.Fulfilled && x.Status != RequestStatus.Cancelled && x.Status != RequestStatus.Rejected).OrderBy(x => x.CreatedAt), ct);
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
        var previous = request.OrganisationId;
        var previousManager = request.AssignedCaseManagerId;
        request.OrganisationId = organisationId;
        request.AssignedCaseManagerId = await ChooseCaseManager(organisationId, ct);
        request.AssignmentStatus = AssignmentStatus.Reassigned;
        Audit("RequestReassigned", request, $"Centre {previous?.ToString() ?? "unassigned"} to {organisationId}; case manager {previousManager ?? "unassigned"} to {request.AssignedCaseManagerId ?? "unassigned"}");
        return request;
    }, ct);
    public Task<AssistanceRequest> AssignManager(Guid id, string userId, CancellationToken ct) => store.RoutingTransactionAsync(async () =>
    {
        var request = await store.FindAsync<AssistanceRequest>(id, ct) ?? throw new MissingException();
        if (!await access.IsAdmin(ct) && !await access.Coordinates(request.CrisisId, ct)) throw new AccessDeniedException();
        if (!request.OrganisationId.HasValue || (await store.ListAsync(store.Query<Membership>().Where(x => x.OrganisationId == request.OrganisationId && x.Role == Roles.CaseManager && x.UserId == userId), ct)).Count == 0) throw new RuleException("Choose a case manager at the assigned centre.");
        var previous = request.AssignedCaseManagerId;
        request.AssignedCaseManagerId = userId;
        Audit("CaseManagerAssigned", request, $"From {previous ?? "unassigned"} to {userId}");
        return request;
    }, ct);
    public async Task<object> Detail(Guid id, CancellationToken ct)
    {
        var r = await access.Request(id, ct: ct);
        var histories = await store.ListAsync(store.Query<RequestHistory>().Where(x => x.RequestId == id).OrderBy(x => x.CreatedAt), ct);
        var attachments = await store.ListAsync(store.Query<Attachment>().Where(x => x.RequestId == id).Select(x => new { x.Id, x.OriginalName, x.ContentType, x.Size }), ct);
        var allocations = await store.ListAsync(store.Query<ResourceAllocation>().Where(x => x.RequestId == id), ct);
        var placements = await store.ListAsync(store.Query<ShelterAllocation>().Where(x => x.RequestId == id), ct);
        var feedback = await store.ListAsync(store.Query<Feedback>().Where(x => x.RequestId == id).OrderByDescending(x => x.CreatedAt), ct);
        return new
        {
            Request = r,
            History = histories.Select(h => new { h.Id, h.CreatedAt, h.Status, Note = r.CitizenId == access.UserId ? CitizenHistoryNote(r.Reference, h.Status) : h.Note, ActorId = r.CitizenId == access.UserId ? "" : h.ActorId }),
            Attachments = attachments,
            Allocations = allocations,
            Placements = placements,
            Feedback = feedback
        };
    }
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
        r.Transition(input.Status, input.Reason);
        RecordChange(r, input.Reason.Length > 0 ? input.Reason : $"Case moved to {r.Status}.");
        await store.SaveAsync(ct);
        return r;
    }
    public async Task Escalate(Guid id, string reason, CancellationToken ct)
    {
        var r = await access.Request(id, CaseRoles, ct);
        if (string.IsNullOrWhiteSpace(reason))
            throw new RuleException("Explain why escalation is needed.");
        r.Escalated = true;
        RecordChange(r, "Case escalated: " + reason, "Escalated");
        await store.SaveAsync(ct);
    }
    public async Task<List<AssistanceRequest>> EscalatedRequests(CancellationToken ct)
    {
        var memberships = await access.Memberships(ct);
        var caseOrgs = memberships.Where(x => CaseRoles.Contains(x.Role)).Select(x => x.OrganisationId).ToArray();
        var crises = memberships.Any(x => x.Role == Roles.Coordinator)
            ? (await store.ListAsync(store.Query<CrisisAssignment>().Where(x => x.UserId == access.UserId), ct)).Select(x => x.CrisisId).ToArray() : [];
        if (caseOrgs.Length == 0) throw new AccessDeniedException();
        return await store.ListAsync(store.Query<AssistanceRequest>().Where(x => x.Escalated && ((x.OrganisationId.HasValue && caseOrgs.Contains(x.OrganisationId.Value)) || crises.Contains(x.CrisisId))).OrderBy(x => x.UpdatedAt), ct);
    }
    public async Task ResolveEscalation(Guid id, string reason, CancellationToken ct)
    {
        var r = await access.Request(id, CaseRoles, ct);
        if (!r.Escalated) throw new RuleException("This case has no open escalation.");
        if (string.IsNullOrWhiteSpace(reason)) throw new RuleException("Explain how the escalation was resolved.");
        r.Escalated = false;
        Audit("EscalationResolved", r, reason.Trim());
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
        Audit("AiGenerated", recommendation, result.Provider);
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
        Audit("AiDecision", recommendation, input.Action + ": " + input.Reason);
        return recommendation;
    }, ct);
    public async Task ReviewDuplicate(Guid id, Guid duplicateId, string action, CancellationToken ct)
    {
        await access.Request(id, CaseRoles, ct);
        var d = await store.FindAsync<PotentialDuplicate>(duplicateId, ct) ?? throw new MissingException();
        if (d.RequestId != id)
            throw new MissingException();
        await access.Request(d.CandidateId, CaseRoles, ct);
        if (action is not ("Distinct" or "Confirmed"))
            throw new RuleException("Choose Distinct or Confirmed.");
        d.State = action;
        Audit("DuplicateReviewed", d, action);
        await store.SaveAsync(ct);
    }
    public async Task<Guid[]> OrgScope(CancellationToken ct)
    {
        var memberships = await access.Memberships(ct);
        var own = memberships.Where(x => x.Role is not Roles.Citizen and not Roles.Volunteer and not Roles.Administrator).Select(x => x.OrganisationId);
        var crisisOrgs = memberships.Any(m => m.Role == Roles.Coordinator)
            ? await store.ListAsync((await access.Visible(ct)).Where(x => x.OrganisationId.HasValue).Select(x => x.OrganisationId!.Value).Distinct(), ct)
            : [];
        return own.Concat(crisisOrgs).Distinct().ToArray();
    }
    public async Task<List<Resource>> Resources(CancellationToken ct)
    {
        var orgs = await OrgScope(ct);
        return await store.ListAsync(store.Query<Resource>().Where(x => orgs.Contains(x.OrganisationId)).OrderBy(x => x.Name), ct);
    }
    public async Task<Resource> AddResource(ResourceInput input, CancellationToken ct)
    {
        await access.RequireOrg(input.OrganisationId, LogisticsRoles, ct);
        QuantityUnits.ValidateWhole(input.Stock, input.Unit);
        var r = new Resource { OrganisationId = input.OrganisationId, Name = input.Name, Category = input.Category, Unit = input.Unit, Stock = input.Stock, LocationText = input.LocationText, Latitude = input.Latitude, Longitude = input.Longitude, Suitability = input.Suitability, TransportAvailable = input.TransportAvailable };
        store.Add(r);
        store.Add(new StockMovement { ResourceId = r.Id, Quantity = r.Stock, Kind = "Opening", ActorId = access.UserId });
        Audit("ResourceCreated", r);
        await store.SaveAsync(ct);
        return r;
    }
    public async Task Replenish(Guid id, MovementInput input, CancellationToken ct)
    {
        var r = await store.FindAsync<Resource>(id, ct) ?? throw new MissingException();
        await access.RequireOrg(r.OrganisationId, LogisticsRoles, ct);
        QuantityUnits.ValidateWhole(input.Quantity, r.Unit);
        r.Stock += input.Quantity;
        store.Add(new StockMovement { ResourceId = id, Quantity = input.Quantity, Kind = "Replenishment", ActorId = access.UserId, Note = input.Note });
        Audit("StockReplenished", r, input.Note);
        await store.SaveAsync(ct);
    }
    public async Task<List<StockMovement>> StockHistory(Guid id, CancellationToken ct)
    {
        var r = await store.FindAsync<Resource>(id, ct) ?? throw new MissingException();
        await access.RequireOrg(r.OrganisationId, LogisticsRoles, ct);
        return await store.ListAsync(store.Query<StockMovement>().Where(x => x.ResourceId == id).OrderByDescending(x => x.CreatedAt), ct);
    }
    public async Task<AllocationRecommendations> AllocationRecommendations(Guid requestId, CancellationToken ct)
    {
        var request = await access.Request(requestId, LogisticsRoles, ct);
        var crisis = await store.FindAsync<Crisis>(request.CrisisId, ct) ?? throw new MissingException();
        var orgs = (await access.Memberships(ct)).Where(x => LogisticsRoles.Contains(x.Role)).Select(x => x.OrganisationId).Distinct().ToArray();
        var resources = await store.ListAsync(store.Query<Resource>().Where(x => orgs.Contains(x.OrganisationId) && x.Category == request.Category && x.CountryCode == crisis.CountryCode), ct);
        var cases = await store.ListAsync((await access.Visible(ct)).Where(x => x.OrganisationId == request.OrganisationId && x.CrisisId == request.CrisisId && x.Category == request.Category && (x.Status == RequestStatus.Approved || x.Status == RequestStatus.InProgress || x.Status == RequestStatus.PartiallyFulfilled)), ct);
        if (!cases.Any(x => x.Id == request.Id)) cases.Add(request);
        var ids = cases.Select(x => x.Id).ToArray();
        var commitments = await store.ListAsync(store.Query<ResourceAllocation>().Where(x => ids.Contains(x.RequestId) && x.Status != AllocationStatus.Cancelled && x.Status != AllocationStatus.Delivered), ct);
        var approvals = await store.ListAsync(store.Query<RequestHistory>().Where(x => ids.Contains(x.RequestId) && x.Status == "Approved"), ct);
        var demand = cases.Select(x => new AllocationDemand(x, commitments.Where(a => a.RequestId == x.Id).Sum(a => a.Quantity), approvals.Where(h => h.RequestId == x.Id).Select(h => (DateTimeOffset?)h.CreatedAt).Min() ?? x.CreatedAt)).ToList();
        return allocationStrategy.Recommend(request, demand.Single(x => x.Request.Id == request.Id).Committed, resources, demand);
    }
    public async Task IgnoreAllocationRecommendation(Guid requestId, Guid resourceId, CancellationToken ct)
    {
        var request = await access.Request(requestId, LogisticsRoles, ct);
        var recommendations = await AllocationRecommendations(requestId, ct);
        if (recommendations.Candidates.FirstOrDefault(x => x.TransportAvailable)?.ResourceId != resourceId) throw new RuleException("The recommendation has changed; refresh it first.");
        Audit("AllocationRecommendationIgnored", request, $"Recommended resource {resourceId}; staff chose to ignore it.");
        await store.SaveAsync(ct);
    }
    public Task<ResourceAllocation> Allocate(AllocateInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var r = await access.Request(input.RequestId, LogisticsRoles, ct);
        var resource = await store.FindAsync<Resource>(input.ResourceId, ct) ?? throw new MissingException();
        await access.RequireOrg(resource.OrganisationId, LogisticsRoles, ct);
        var crisis = await store.FindAsync<Crisis>(r.CrisisId, ct) ?? throw new MissingException();
        if (resource.CountryCode != crisis.CountryCode)
            throw new RuleException("A resource must be in the same country as the crisis.");
        if (r.Status is not (RequestStatus.Approved or RequestStatus.InProgress or RequestStatus.PartiallyFulfilled))
            throw new RuleException("Verify and approve this case before allocating aid.");
        var committed = (await store.ListAsync(store.Query<ResourceAllocation>().Where(x => x.RequestId == r.Id && x.Status != AllocationStatus.Cancelled && x.Status != AllocationStatus.Delivered), ct)).Sum(x => x.Quantity);
        if (input.RecommendedResourceId.HasValue)
        {
            var current = await AllocationRecommendations(r.Id, ct);
            if (current.Candidates.FirstOrDefault(x => x.TransportAvailable)?.ResourceId != input.RecommendedResourceId.Value)
                throw new RuleException("The recommendation has changed; refresh it before reserving.");
        }
        QuantityUnits.ValidateWhole(input.Quantity, resource.Unit);
        allocationPolicy.Validate(r, resource, input.Quantity, committed);
        resource.Reserve(input.Quantity);
        var allocation = new ResourceAllocation { RequestId = r.Id, ResourceId = resource.Id, Quantity = input.Quantity, ApprovedBy = access.UserId };
        store.Add(allocation);
        store.Add(new StockMovement { ResourceId = resource.Id, Quantity = input.Quantity, Kind = "Reserved", ActorId = access.UserId });
        if (r.Status == RequestStatus.Approved)
            r.Transition(RequestStatus.InProgress);
        RecordChange(r, $"{input.Quantity} {resource.Unit} reserved; remaining needs stay open.");
        Audit("ResourceReserved", allocation);
        if (input.RecommendedResourceId.HasValue)
        {
            var suggested = await store.FindAsync<Resource>(input.RecommendedResourceId.Value, ct) ?? throw new RuleException("Recommended resource not found.");
            await access.RequireOrg(suggested.OrganisationId, LogisticsRoles, ct);
            if (suggested.Category != r.Category) throw new RuleException("Recommended resource category does not match the request.");
            Audit(input.ResourceId == suggested.Id ? "AllocationRecommendationAccepted" : "AllocationRecommendationIgnored", r, $"Recommended resource {suggested.Id}; reserved resource {resource.Id}; quantity {input.Quantity}.");
        }
        return allocation;
    }, ct);
    public Task<ResourceAllocation> UpdateAllocation(Guid id, string action, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var a = await store.FindAsync<ResourceAllocation>(id, ct) ?? throw new MissingException();
        var r = await access.Request(a.RequestId, LogisticsRoles, ct);
        var resource = await store.FindAsync<Resource>(a.ResourceId, ct) ?? throw new MissingException();
        await access.RequireOrg(resource.OrganisationId, LogisticsRoles, ct);
        if (action == "Dispatch" && a.Status == AllocationStatus.Reserved)
        {
            resource.Dispatch(a.Quantity);
            a.Status = AllocationStatus.Dispatched;
        }
        else if (action == "Deliver" && a.Status == AllocationStatus.Dispatched)
        {
            r.Deliver(a.Quantity);
            a.Status = AllocationStatus.Delivered;
        }
        else if (action == "Cancel" && a.Status == AllocationStatus.Reserved)
        {
            resource.Release(a.Quantity);
            a.Status = AllocationStatus.Cancelled;
        }
        else
            throw new RuleException("Invalid allocation action. Dispatched aid cannot be silently returned to stock.");
        store.Add(new StockMovement { ResourceId = resource.Id, Quantity = a.Quantity, Kind = action, ActorId = access.UserId });
        RecordChange(r, $"Aid allocation: {action}.");
        Audit("Allocation" + action, a);
        return a;
    }, ct);
    public async Task<Shelter> SaveShelter(Guid? id, ShelterInput input, CancellationToken ct)
    {
        await access.RequireOrg(input.OrganisationId, ShelterRoles, ct);
        var shelter = id.HasValue ? await store.FindAsync<Shelter>(id.Value, ct) ?? throw new MissingException() : new Shelter { OrganisationId = input.OrganisationId };
        if (shelter.OrganisationId != input.OrganisationId)
            throw new AccessDeniedException();
        if (input.Capacity < shelter.Occupancy + shelter.Reserved)
            throw new RuleException("Capacity cannot be below active reservations and occupancy.");
        shelter.Name = input.Name;
        shelter.Address = input.Address;
        shelter.Latitude = input.Latitude;
        shelter.Longitude = input.Longitude;
        shelter.Capacity = input.Capacity;
        shelter.Accessible = input.Accessible;
        shelter.Open = input.Open;
        shelter.Facilities = input.Facilities;
        if (!id.HasValue)
            store.Add(shelter);
        Audit("ShelterSaved", shelter);
        await store.SaveAsync(ct);
        return shelter;
    }
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
        await access.RequireOrg(shelter.OrganisationId, ShelterRoles, ct);
        var crisis = await store.FindAsync<Crisis>(r.CrisisId, ct) ?? throw new MissingException();
        if (shelter.CountryCode != crisis.CountryCode)
            throw new RuleException("A shelter must be in the same country as the crisis.");
        if (r.AccessibilityNeeds.Length > 0 && !shelter.Accessible)
            throw new RuleException("This household requires an accessible shelter.");
        shelter.Reserve(r.HouseholdSize);
        var placement = new ShelterAllocation { RequestId = r.Id, ShelterId = shelter.Id, People = r.HouseholdSize, ApprovedBy = access.UserId };
        store.Add(placement);
        if (r.Status == RequestStatus.Approved)
            r.Transition(RequestStatus.InProgress);
        RecordChange(r, "Shelter spaces reserved; check-in is still required.");
        Audit("ShelterReserved", placement);
        return placement;
    }, ct);
    public Task<ShelterAllocation> UpdateStay(Guid id, string action, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var stay = await store.FindAsync<ShelterAllocation>(id, ct) ?? throw new MissingException();
        var r = await access.Request(stay.RequestId, ShelterRoles, ct);
        var shelter = await store.FindAsync<Shelter>(stay.ShelterId, ct) ?? throw new MissingException();
        await access.RequireOrg(shelter.OrganisationId, ShelterRoles, ct);
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
        RecordChange(r, "Shelter placement: " + action);
        Audit("Shelter" + action, stay);
        return stay;
    }, ct);
    public async Task<VolunteerRoster> Volunteers(CancellationToken ct)
    {
        var orgs = await OrgScope(ct);
        var ownOrgs = (await access.Memberships(ct)).Where(x => x.Role == Roles.Volunteer).Select(x => x.OrganisationId).ToArray();
        var q = store.Query<VolunteerProfile>().Where(x => orgs.Contains(x.OrganisationId) || (x.UserId == access.UserId && ownOrgs.Contains(x.OrganisationId)));
        var profiles = await store.ListAsync(q, ct);
        var ids = profiles.Select(x => x.Id).ToArray();
        return new(profiles, await store.ListAsync(store.Query<VolunteerTask>().Where(x => ids.Contains(x.VolunteerId)).OrderBy(x => x.DueAt), ct));
    }
    public async Task<VolunteerProfile> SaveVolunteer(VolunteerProfile input, CancellationToken ct)
    {
        await access.RequireOrg(input.OrganisationId, VolunteerRoles, ct);
        if ((await store.ListAsync(store.Query<Membership>().Where(x => x.UserId == input.UserId && x.OrganisationId == input.OrganisationId && x.Role == Roles.Volunteer), ct)).Count == 0)
            throw new RuleException("An administrator must create a volunteer membership in this organisation first.");
        var existing = (await store.ListAsync(store.Query<VolunteerProfile>().Where(x => x.UserId == input.UserId), ct)).SingleOrDefault();
        if (existing is not null && existing.OrganisationId != input.OrganisationId)
            throw new AccessDeniedException();
        var v = existing ?? new VolunteerProfile { UserId = input.UserId, OrganisationId = input.OrganisationId };
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
    public Task<VolunteerTask> AssignTask(TaskInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        await access.Request(input.RequestId, VolunteerRoles, ct);
        var v = await store.FindAsync<VolunteerProfile>(input.VolunteerId, ct) ?? throw new MissingException();
        await access.RequireOrg(v.OrganisationId, VolunteerRoles, ct);
        if (!v.Verified || !v.Available || input.DueAt <= DateTimeOffset.UtcNow || (input.RequiredSkill.Length > 0 && !v.Skills.Contains(input.RequiredSkill, StringComparison.OrdinalIgnoreCase)))
            throw new RuleException("Volunteer verification, availability, skills or due date is unsuitable.");
        var task = new VolunteerTask { RequestId = input.RequestId, VolunteerId = v.Id, Title = input.Title, RequiredSkill = input.RequiredSkill, DueAt = input.DueAt };
        store.Add(task);
        Audit("VolunteerAssigned", task);
        return task;
    }, ct);
    public async Task<VolunteerTask> UpdateTask(Guid id, TaskUpdateInput input, CancellationToken ct)
    {
        var task = await store.FindAsync<VolunteerTask>(id, ct) ?? throw new MissingException();
        var v = await store.FindAsync<VolunteerProfile>(task.VolunteerId, ct) ?? throw new MissingException();
        if (input.Action == "Verify")
        {
            await access.RequireOrg(v.OrganisationId, VolunteerRoles, ct);
            await access.Request(task.RequestId, VolunteerRoles, ct);
            if (task.Status != VolunteerTaskStatus.AwaitingVerification)
                throw new RuleException("Task is not ready for verification.");
            task.Status = VolunteerTaskStatus.Completed;
        }
        else
        {
            if (v.UserId != access.UserId || !v.Verified)
                throw new AccessDeniedException();
            await access.RequireOrg(v.OrganisationId, [Roles.Volunteer], ct);
            task.Status = (input.Action, task.Status) switch
            {
                ("Accept", VolunteerTaskStatus.Assigned) => VolunteerTaskStatus.Accepted,
                ("Decline", VolunteerTaskStatus.Assigned) => VolunteerTaskStatus.Declined,
                ("Start", VolunteerTaskStatus.Accepted) => VolunteerTaskStatus.InProgress,
                ("Complete", VolunteerTaskStatus.InProgress) => VolunteerTaskStatus.AwaitingVerification,
                _ => throw new RuleException("Invalid task action.")
            };
        }
        task.Note = input.Note;
        Audit("VolunteerTask" + input.Action, task);
        await store.SaveAsync(ct);
        return task;
    }
    public async Task Feedback(Guid id, FeedbackInput input, CancellationToken ct)
    {
        var r = await access.Request(id, ct: ct);
        if (r.CitizenId != access.UserId || r.Status is not (RequestStatus.PartiallyFulfilled or RequestStatus.Fulfilled or RequestStatus.Closed))
            throw new AccessDeniedException();
        store.Add(new Feedback { RequestId = id, UserId = access.UserId, Rating = input.Rating, Received = input.Received, Problem = input.Problem, Comment = input.Comment });
        if (input.Problem)
            r.Escalated = true;
        Audit("FeedbackRecorded", r);
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
        var shelterTotals = (await store.ListAsync(store.Query<Shelter>().Where(x => orgs.Contains(x.OrganisationId)).GroupBy(x => 1).Select(g => new { Occupancy = g.Sum(x => x.Occupancy), Reserved = g.Sum(x => x.Reserved), Capacity = g.Sum(x => x.Capacity) }), ct)).SingleOrDefault();
        var resourceTotals = (await store.ListAsync(store.Query<Resource>().Where(x => orgs.Contains(x.OrganisationId)).GroupBy(x => 1).Select(g => new { Reserved = g.Sum(x => x.Reserved), Stock = g.Sum(x => x.Stock) }), ct)).SingleOrDefault();
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
            OpenCases = statuses.Where(x => x.Status is not (RequestStatus.Closed or RequestStatus.Rejected or RequestStatus.Cancelled)).Sum(x => x.Count),
            ResolvedCases = statuses.Where(x => x.Status is RequestStatus.Closed or RequestStatus.Fulfilled).Sum(x => x.Count),
            OverdueCases = caseTotals?.Overdue ?? 0,
            EscalatedCases = caseTotals?.Escalated ?? 0,
            AverageResponseHours = firstReviews.Count == 0 ? (double?)null : Math.Round(firstReviews.Average(x => (x.FirstReview - x.CreatedAt).TotalHours), 1),
            ShelterOccupancy = shelterTotals?.Occupancy ?? 0,
            ShelterReserved = shelterTotals?.Reserved ?? 0,
            ShelterCapacity = shelterTotals?.Capacity ?? 0,
            ResourceReserved = resourceTotals?.Reserved ?? 0,
            ResourceStock = resourceTotals?.Stock ?? 0,
            AiOverrideFrequency = AiDecisionMetrics.OverrideFrequency(modified, rejected, decisions),
            AiApprovedCount = approved, AiModifiedCount = modified, AiRejectedCount = rejected, AiDeferredCount = deferred,
            ByStatus = statuses.Select(x => new { Status = x.Status.ToString(), x.Count }),
            Shortages = shortages
        };
    }
}
