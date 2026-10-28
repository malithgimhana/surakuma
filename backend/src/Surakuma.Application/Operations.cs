using Surakuma.Domain;
using VolunteerTaskStatus = Surakuma.Domain.TaskStatus;

namespace Surakuma.Application;

public sealed class Operations(IStore store, AccessService access, IAiProvider ai, IAllocationPolicy allocationPolicy)
{
    private static readonly string[] CaseRoles = [Roles.CaseManager, Roles.Coordinator];
    private static readonly string[] LogisticsRoles = [Roles.Logistics, Roles.Coordinator];
    private static readonly string[] ShelterRoles = [Roles.ShelterAdmin, Roles.Coordinator];
    private static readonly string[] VolunteerRoles = [Roles.VolunteerCoordinator, Roles.Coordinator];

    public void Audit(string action, Record record, string detail = "") => store.Add(new AuditEvent { ActorId = access.UserId, Action = action, EntityId = record.Id, EntityType = record.GetType().Name, Detail = detail });
    private void RecordChange(AssistanceRequest r, string note)
    {
        store.Add(new RequestHistory { RequestId = r.Id, ActorId = access.UserId, Status = r.Status.ToString(), Note = note });
        store.Add(new OutboxMessage { UserId = r.CitizenId, RequestId = r.Id, Message = CitizenMessages.Status(r.Reference, r.Status, "en"), SinhalaMessage = CitizenMessages.Status(r.Reference, r.Status, "si"), TamilMessage = CitizenMessages.Status(r.Reference, r.Status, "ta") });
        Audit("CaseChanged", r, note);
    }
    public async Task<object> PublicData(CancellationToken ct) => new
    {
        Crises = await store.ListAsync(store.Query<Crisis>().Where(x => x.Active).OrderBy(x => x.Name), ct),
        Organisations = await store.ListAsync(store.Query<Organisation>().OrderBy(x => x.Name), ct)
    };
    public async Task<List<PublicAlert>> Alerts(CancellationToken ct) => await store.ListAsync(store.Query<PublicAlert>().Where(x => x.Published && x.ExpiresAt > DateTimeOffset.UtcNow).OrderByDescending(x => x.CreatedAt), ct);
    public Task<List<Shelter>> PublicShelters(CancellationToken ct) => store.ListAsync(store.Query<Shelter>().OrderBy(x => x.Name), ct);
    public async Task<AssistanceRequest> Submit(CreateRequestInput input, CancellationToken ct)
    {
        if (!Enum.IsDefined(input.Category) || !Enum.IsDefined(input.Priority))
            throw new RuleException("Invalid category or priority.");
        if (input.Latitude is < -90 or > 90 || input.Longitude is < -180 or > 180 || input.Latitude.HasValue != input.Longitude.HasValue)
            throw new RuleException("Invalid location coordinates.");
        var crisis = await store.FindAsync<Crisis>(input.CrisisId, ct) ?? throw new RuleException("Choose a valid crisis event.");
        if (!crisis.Active || await store.FindAsync<Organisation>(input.OrganisationId, ct) is null)
            throw new RuleException("Choose an active crisis and receiving organisation.");
        var existing = await store.ListAsync(store.Query<AssistanceRequest>().Where(x => x.CitizenId == access.UserId && x.SubmissionKey == input.SubmissionKey), ct);
        if (existing.Count > 0)
            return existing[0];
        var r = new AssistanceRequest
        {
            CitizenId = access.UserId,
            CrisisId = input.CrisisId,
            OrganisationId = input.OrganisationId,
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
        RecordChange(r, "Request received. A staff member will review it.");
        await store.SaveAsync(ct);
        return r;
    }
    public async Task<Page<AssistanceRequest>> Requests(bool mine, string? status, string? search, int page, CancellationToken ct)
    {
        var q = await access.Visible(ct);
        if (mine)
            q = q.Where(x => x.CitizenId == access.UserId);
        if (Enum.TryParse<RequestStatus>(status, out var state))
            q = q.Where(x => x.Status == state);
        if (!string.IsNullOrWhiteSpace(search))
            q = q.Where(x => x.Reference.Contains(search) || x.Description.Contains(search));
        int total = (await store.ListAsync(q.Select(x => x.Id), ct)).Count;
        page = Math.Max(1, page);
        return new(await store.ListAsync(q.OrderByDescending(x => x.CreatedAt).Skip((page - 1) * 20).Take(20), ct), total, page, 20);
    }
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
            History = histories,
            Attachments = attachments,
            Allocations = allocations,
            Placements = placements,
            Feedback = feedback
        };
    }
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
        RecordChange(r, "Case escalated: " + reason);
        await store.SaveAsync(ct);
    }
    public async Task Share(Guid id, Guid orgId, CancellationToken ct)
    {
        var r = await access.Request(id, [Roles.Coordinator], ct);
        if (await store.FindAsync<Organisation>(orgId, ct) is null)
            throw new RuleException("Organisation not found.");
        if ((await store.ListAsync(store.Query<CaseShare>().Where(x => x.RequestId == id && x.OrganisationId == orgId), ct)).Count == 0)
        {
            store.Add(new CaseShare { RequestId = id, OrganisationId = orgId });
            Audit("CaseShared", r, orgId.ToString());
            await store.SaveAsync(ct);
        }
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
        var crisisOrgs = (await store.ListAsync(await access.Visible(ct), ct)).Where(x => memberships.Any(m => m.Role == Roles.Coordinator)).Select(x => x.OrganisationId);
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
    public Task<ResourceAllocation> Allocate(AllocateInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var r = await access.Request(input.RequestId, LogisticsRoles, ct);
        var resource = await store.FindAsync<Resource>(input.ResourceId, ct) ?? throw new MissingException();
        await access.RequireOrg(resource.OrganisationId, LogisticsRoles, ct);
        if (r.Status is not (RequestStatus.Approved or RequestStatus.InProgress or RequestStatus.PartiallyFulfilled))
            throw new RuleException("Verify and approve this case before allocating aid.");
        var committed = (await store.ListAsync(store.Query<ResourceAllocation>().Where(x => x.RequestId == r.Id && x.Status != AllocationStatus.Cancelled && x.Status != AllocationStatus.Delivered), ct)).Sum(x => x.Quantity);
        allocationPolicy.Validate(r, resource, input.Quantity, committed);
        resource.Reserve(input.Quantity);
        var allocation = new ResourceAllocation { RequestId = r.Id, ResourceId = resource.Id, Quantity = input.Quantity, ApprovedBy = access.UserId };
        store.Add(allocation);
        store.Add(new StockMovement { ResourceId = resource.Id, Quantity = input.Quantity, Kind = "Reserved", ActorId = access.UserId });
        if (r.Status == RequestStatus.Approved)
            r.Transition(RequestStatus.InProgress);
        RecordChange(r, $"{input.Quantity} {resource.Unit} reserved; remaining needs stay open.");
        Audit("ResourceReserved", allocation);
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
        if ((await store.ListAsync(store.Query<ShelterAllocation>().Where(x => x.RequestId == r.Id && x.Status != StayStatus.Cancelled && x.Status != StayStatus.Departed), ct)).Count > 0)
            throw new RuleException("This household already has an active placement.");
        var shelter = await store.FindAsync<Shelter>(input.ShelterId, ct) ?? throw new MissingException();
        await access.RequireOrg(shelter.OrganisationId, ShelterRoles, ct);
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
            shelter.CheckIn(stay.People);
            stay.Status = StayStatus.CheckedIn;
            r.Deliver(r.Quantity - r.DeliveredQuantity);
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
    public async Task<object> Volunteers(CancellationToken ct)
    {
        var orgs = await OrgScope(ct);
        var ownOrgs = (await access.Memberships(ct)).Where(x => x.Role == Roles.Volunteer).Select(x => x.OrganisationId).ToArray();
        var q = store.Query<VolunteerProfile>().Where(x => orgs.Contains(x.OrganisationId) || (x.UserId == access.UserId && ownOrgs.Contains(x.OrganisationId)));
        var profiles = await store.ListAsync(q, ct);
        var ids = profiles.Select(x => x.Id).ToArray();
        return new
        {
            Profiles = profiles,
            Tasks = await store.ListAsync(store.Query<VolunteerTask>().Where(x => ids.Contains(x.VolunteerId)).OrderBy(x => x.DueAt), ct)
        };
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
        var cases = await store.ListAsync(await access.Visible(ct), ct);
        var ids = cases.Select(x => x.Id).ToArray();
        var orgs = await OrgScope(ct);
        var resources = await Resources(ct);
        var shelters = await store.ListAsync(store.Query<Shelter>().Where(x => orgs.Contains(x.OrganisationId)), ct);
        var decisions = await store.ListAsync(store.Query<HumanDecision>().Where(x => ids.Contains(x.RequestId)), ct);
        var firstReviews = (await store.ListAsync(store.Query<RequestHistory>().Where(x => ids.Contains(x.RequestId) && x.Status == "UnderReview"), ct)).GroupBy(x => x.RequestId).Select(x => x.Min(h => h.CreatedAt) - cases.Single(r => r.Id == x.Key).CreatedAt).ToList();
        return new
        {
            OpenCases = cases.Count(x => x.Status is not (RequestStatus.Closed or RequestStatus.Rejected or RequestStatus.Cancelled)),
            ResolvedCases = cases.Count(x => x.Status is RequestStatus.Closed or RequestStatus.Fulfilled),
            OverdueCases = cases.Count(x => x.CreatedAt < DateTimeOffset.UtcNow.AddHours(-24) && x.Status is not (RequestStatus.Closed or RequestStatus.Fulfilled or RequestStatus.Cancelled or RequestStatus.Rejected)),
            EscalatedCases = cases.Count(x => x.Escalated),
            AverageResponseHours = firstReviews.Count == 0 ? (double?)null : Math.Round(firstReviews.Average(x => x.TotalHours), 1),
            ShelterOccupancy = shelters.Sum(x => x.Occupancy),
            ShelterReserved = shelters.Sum(x => x.Reserved),
            ShelterCapacity = shelters.Sum(x => x.Capacity),
            ResourceReserved = resources.Sum(x => x.Reserved),
            ResourceStock = resources.Sum(x => x.Stock),
            AiOverrideFrequency = decisions.Count == 0 ? 0 : (double)decisions.Count(x => x.Action == "Modify") / decisions.Count,
            ByStatus = cases.GroupBy(x => x.Status).Select(x => new { Status = x.Key.ToString(), Count = x.Count() }),
            Shortages = cases.Where(x => x.Status is RequestStatus.Approved or RequestStatus.PartiallyFulfilled).Select(x => new { x.Id, x.Reference, x.Priority, Outstanding = x.Quantity - x.DeliveredQuantity, x.Category })
        };
    }
}
