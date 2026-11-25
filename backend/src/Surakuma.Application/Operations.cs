using System.Security.Cryptography;
using Surakuma.Domain;
using VolunteerTaskStatus = Surakuma.Domain.TaskStatus;

namespace Surakuma.Application;

public sealed partial class Operations(IStore store, AccessService access, IAiProvider ai, IAllocationPolicy allocationPolicy, IAllocationStrategy allocationStrategy,
    ResourceUnitCatalog units, RequestIntelligence intelligence, ShelterOperationalPolicy shelterPolicy)
{
    private static readonly string[] CaseRoles = [Roles.CaseManager, Roles.Coordinator];
    private static readonly string[] LogisticsReaders = [Roles.Logistics, Roles.Coordinator];
    private static readonly string[] ShelterReaders = [Roles.ShelterAdmin, Roles.Coordinator];
    private static readonly string[] VolunteerReaders = [Roles.VolunteerCoordinator, Roles.Coordinator];
    private static readonly string[] LogisticsRoles = [Roles.Logistics];
    private static readonly string[] ShelterRoles = [Roles.ShelterAdmin];
    private static readonly string[] VolunteerRoles = [Roles.VolunteerCoordinator];
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

    private async Task RecordChange(AssistanceRequest r, string note, CancellationToken ct, RequestStatus? previousStatus = null,
        string? historyStatus = null, bool dispatchUpdate = false, Guid? allocationId = null, string? actionRole = null, Guid? depotId = null)
    {
        store.Add(new RequestHistory { RequestId = r.Id, ActorId = access.UserId, Status = historyStatus ?? r.Status.ToString(), Note = note });
        if (previousStatus != r.Status)
            store.Add(new OutboxMessage { UserId = r.CitizenId, RequestId = r.Id, Message = CitizenMessages.Status(r.Reference, r.Status, "en"), SinhalaMessage = CitizenMessages.Status(r.Reference, r.Status, "si"), TamilMessage = CitizenMessages.Status(r.Reference, r.Status, "ta") });
        await notifications.RequestChanged(r, note, ct, dispatchUpdate, allocationId: allocationId, actionRole: actionRole, depotId: depotId);
        Audit("CaseChanged", r, note, await CrisisCountry(r.CrisisId, ct));
    }
    private async Task<string> CrisisCountry(Guid id, CancellationToken ct) =>
        (await store.FindAsync<Crisis>(id, ct) ?? throw new MissingException()).CountryCode;

    public async Task<PublicLookups> PublicData(CancellationToken ct, string countryCode = "LK") => new(
        await store.ListAsync(store.Query<Crisis>().Where(x => x.Active && x.CountryCode == countryCode).OrderBy(x => x.Name).Select(x => new PublicLookup(x.Id, x.Name)), ct),
        await store.ListAsync(store.Query<Organisation>().Where(o => store.Query<OrganisationCountry>().Any(c => c.OrganisationId == o.Id && c.CountryCode == countryCode && (c.VerificationState == "Verified" || c.VerificationState == "LegacyActive"))).OrderBy(x => x.Name).Select(x => new PublicLookup(x.Id, x.Name)), ct));
    public async Task<List<PublicAlert>> Alerts(CancellationToken ct, string countryCode = "LK") =>
        await store.ListAsync(PublishedAlerts(countryCode)
            .OrderByDescending(x => x.PublishedAt ?? x.CreatedAt), ct);

    public async Task<byte[]?> AlertImage(Guid id, string countryCode, CancellationToken ct) =>
        (await store.ListAsync(from visual in store.Query<PublicAlertVisual>()
            join alert in PublishedAlerts(countryCode) on visual.AlertId equals alert.Id
            where visual.AlertId == id && alert.VisualImageUrl != null
            select visual.Image, ct)).SingleOrDefault();

    private IQueryable<PublicAlert> PublishedAlerts(string countryCode) =>
        store.Query<PublicAlert>().Where(x => x.Published &&
            (x.WorkflowState == null || x.WorkflowState == "LegacyPublished" || x.WorkflowState == "Published" || x.WorkflowState == "EmergencyPublished") &&
            x.ExpiresAt > DateTimeOffset.UtcNow &&
            store.Query<Crisis>().Any(c => c.Id == x.CrisisId && c.CountryCode == countryCode));
    public Task<List<PublicShelter>> PublicShelters(CancellationToken ct, string countryCode = "LK") => store.ListAsync(store.Query<Shelter>()
        .Where(x => !x.PendingVerification && x.CountryCode == countryCode && store.Query<OrganisationCountry>().Any(link =>
            link.OrganisationId == x.OrganisationId && link.CountryCode == countryCode))
        .OrderBy(x => x.Name).Select(x => new PublicShelter(x.Id, x.Name, x.Address, x.Latitude, x.Longitude, x.Capacity, x.Reserved, x.Occupancy, x.Capacity - x.Reserved - x.Occupancy, x.Accessible, x.Open, x.Facilities, x.OperationalUpdatedAt ?? x.UpdatedAt)), ct);
    public async Task<List<Shelter>> StaffShelters(CancellationToken ct)
    {
        return await store.ListAsync((await access.Located<Shelter>(ct, roles: ShelterReaders)).OrderBy(x => x.Name), ct);
    }
    public Task<AssistanceRequest> Submit(CreateRequestInput input, CancellationToken ct,
        IntakeCategoryReceipt? categoryGuidance = null) => store.RoutingTransactionAsync(async () =>
    {
        if (!Enum.IsDefined(input.Category) || input.Intake is null && !Enum.IsDefined(input.Priority))
            throw new RuleException("Invalid category or priority.");
        if (input.Latitude is < -90 or > 90 || input.Longitude is < -180 or > 180 || input.Latitude.HasValue != input.Longitude.HasValue)
            throw new RuleException("Invalid location coordinates.");
        var crisis = await store.FindAsync<Crisis>(input.CrisisId, ct) ?? throw new RuleException("Choose a valid crisis event.");
        if (!crisis.Active)
            throw new RuleException("Choose an active crisis.");
        var existing = await store.ListAsync(store.Query<AssistanceRequest>().Where(x => x.CitizenId == access.UserId && x.SubmissionKey == input.SubmissionKey), ct);
        if (existing.Count > 0)
            return existing[0];
        var intake = input.Intake is null ? null : CitizenTriage.Validate(input.Category, input.Intake);
        if (intake?.SupplyItems is { } supplies)
        {
            intake = intake with { SupplyItems = supplies.Select(line =>
            {
                var lineUnit = units.Require(line.Unit);
                units.EnsureStockCategory(lineUnit, input.Category);
                QuantityUnits.ValidateInventory(line.Quantity, lineUnit);
                return line with { Unit = lineUnit };
            }).ToArray() };
        }
        var firstSupply = intake?.SupplyItems?.FirstOrDefault();
        var (score, priority) = intake is null ? ((decimal?)null, input.Priority) : CitizenTriage.AtIntake(input.Category, intake, input.HouseholdSize);
        var service = intake is not null && !CitizenTriage.RequiresQuantity(input.Category, intake);
        var unit = firstSupply?.Unit ?? (input.Category == AidCategory.Shelter ? QuantityUnits.Household : service ? "persons" : units.Require(input.Unit));
        if (!service && input.Category != AidCategory.Shelter &&
            (intake != null || input.Category == AidCategory.FoodWater || unit != "persons"))
            units.EnsureStockCategory(unit, input.Category);
        decimal quantity = firstSupply?.Quantity ?? (input.Category == AidCategory.Shelter ? 1 : service ? input.HouseholdSize : input.Quantity);
        if (input.Category == AidCategory.Shelter && (input.Quantity != 1 ||
            input.Unit != null && QuantityUnits.Normalize(input.Unit) != QuantityUnits.Household))
            throw new RuleException("A shelter request covers one household placement. Submit a separate request for another household.");
        QuantityUnits.ValidateInventory(quantity, unit);
        await ValidateRequestRegion(input.AdministrativeDivisionId, crisis.CountryCode, ct);
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
            Priority = priority,
            IntakeJson = intake is null ? null : System.Text.Json.JsonSerializer.Serialize(intake),
            IntakeScore = score,
            PriorityScore = score,
            ImmediateDanger = intake?.Danger == "Yes",
            AssessmentState = intake is null ? null : "Pending",
            RequiresCoordinatorAuthorization = intake?.SupplyItems is { Length: > 0 },
            RequiresCentreHandover = intake?.SupplyItems is { Length: > 0 },
            Description = input.Description.Trim(),
            LocationText = input.LocationText.Trim(),
            Latitude = input.Latitude,
            Longitude = input.Longitude,
            HouseholdSize = input.HouseholdSize,
            AccessibilityNeeds = input.AccessibilityNeeds,
            Quantity = quantity,
            Unit = unit,
            AdministrativeDivisionId = input.AdministrativeDivisionId,
            SubmissionKey = input.SubmissionKey,
            Synthetic = input.Synthetic
        };
        if (score is < 17m) r.NextPriorityEscalationAt = r.CreatedAt.AddHours(3);
        store.Add(r);
        // Assign the case reference inside the routing transaction before writing its first status message.
        await store.SaveAsync(ct);
        if (intake?.SupplyItems is { Length: > 1 } caseItems)
        {
            foreach (var line in caseItems)
                store.Add(new CaseNeed { RequestId = r.Id, Category = r.Category,
                    Name = CitizenTriage.SupplyName(r.Category, line.Item), Unit = line.Unit,
                    RequiredQuantity = line.Quantity, ApprovedQuantity = line.Quantity });
        }
        store.Add(new RequestAnalysisJob { RequestId = r.Id });
        if (r.OrganisationId.HasValue)
            Audit("RequestAssigned", r, $"Automatic centre {r.OrganisationId.Value}; case manager {r.AssignedCaseManagerId ?? "unassigned"}", crisis.CountryCode);
        var note = "Request received. A staff member will review it.";
        if (categoryGuidance is not null && categoryGuidance.CountryCode == crisis.CountryCode)
            note += " " + IntakeCategoryHelp.Describe(categoryGuidance, r.Category);
        await RecordChange(r, note, ct,
            actionRole: r.AssignedCaseManagerId == null ? Roles.Coordinator : null);
        return r;
    }, ct);

    private async Task ValidateRequestRegion(Guid? divisionId, string country, CancellationToken ct)
    {
        if (divisionId.HasValue && (await store.FindAsync<AdministrativeDivision>(divisionId.Value, ct))?.CountryCode != country)
            throw new RuleException("Choose an administrative region in the crisis country.");
    }

    public Task<AssistanceRequest> ClarifyMeasurement(Guid id, ClarifyMeasurementInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var request = await access.Request(id, CaseRoles, ct);
        if (CaseReporting.Ended.Contains(request.Status))
            throw new RuleException("Measurement clarification is only available for open cases.");
        var reason = input.Reason.Trim();
        if (reason.Length == 0) throw new RuleException("Record the source of the clarification.");
        if (input.Unit == null && input.AdministrativeDivisionId == null)
            throw new RuleException("Choose a unit or an administrative region to clarify.");
        var country = await CrisisCountry(request.CrisisId, ct);
        await ValidateRequestRegion(input.AdministrativeDivisionId, country, ct);
        var changes = new List<string>();
        if (input.Unit != null)
        {
            var unit = units.Require(input.Unit);
            if (request.Category == AidCategory.Shelter || request.Unit != null && request.Unit != unit)
                throw new RuleException("An established request unit cannot be changed through clarification.");
            if (request.Unit == null)
            {
                if (unit != "persons" || request.Category == AidCategory.FoodWater)
                    units.EnsureStockCategory(unit, request.Category);
                QuantityUnits.ValidateInventory(request.Quantity, unit);
                QuantityUnits.ValidateInventory(request.DeliveredQuantity, unit);
                var previous = await store.ListAsync(
                    from allocation in store.Query<ResourceAllocation>()
                    join resource in store.Query<Resource>() on allocation.ResourceId equals resource.Id
                    where allocation.RequestId == id && allocation.Status != AllocationStatus.Cancelled
                    select new { Allocation = allocation, resource.Unit }, ct);
                if (previous.Any(a => QuantityUnits.Normalize(a.Unit) != unit))
                    throw new RuleException("Historical allocations use a different unit. Reconcile their evidence before clarifying this request.");
                var committed = previous.Where(a => a.Allocation.Status is AllocationStatus.Reserved or AllocationStatus.Dispatched).Sum(a => a.Allocation.Quantity);
                if (committed + request.DeliveredQuantity > request.Quantity)
                    throw new RuleException("Historical commitments exceed the request. Reconcile them before clarifying the unit.");
                request.Unit = unit;
                foreach (var row in previous) row.Allocation.RequestQuantity = row.Allocation.Quantity;
                changes.Add($"Unit confirmed as {unit}");
            }
        }
        if (input.AdministrativeDivisionId is Guid divisionId && request.AdministrativeDivisionId != divisionId)
        {
            changes.Add($"Administrative region changed from {request.AdministrativeDivisionId?.ToString() ?? "unrecorded"} to {divisionId}");
            request.AdministrativeDivisionId = divisionId;
        }
        if (changes.Count > 0)
        {
            var note = string.Join(". ", changes) + $". {reason}";
            await RecordChange(request, note, ct, request.Status);
            Audit("RequestMeasurementClarified", request, note, country);
        }
        return request;
    }, ct);
    private async Task<string?> ChooseCaseManager(Guid organisationId, Guid crisisId, CancellationToken ct)
    {
        var country = (await store.FindAsync<Crisis>(crisisId, ct))!.CountryCode;
        var grants = store.Query<Membership>().Where(m => m.Role == Roles.CaseManager);
        var managers = (await store.ListAsync(grants.Where(x => x.OrganisationId == organisationId && x.CountryCode == country && (x.CrisisId == null || x.CrisisId == crisisId) && x.AvailableForAssignment &&
            !grants.Any(other => other.UserId == x.UserId && other.CountryCode != x.CountryCode)), ct)).Select(x => x.UserId).Distinct().ToArray();
        if (managers.Length == 0) return null;
        var active = await store.ListAsync(store.Query<AssistanceRequest>().Where(x => x.OrganisationId == organisationId && x.AssignedCaseManagerId != null && managers.Contains(x.AssignedCaseManagerId) && x.Status != RequestStatus.Fulfilled && x.Status != RequestStatus.Closed && x.Status != RequestStatus.Rejected && x.Status != RequestStatus.Cancelled), ct);
        return managers.OrderBy(id => active.Count(x => x.AssignedCaseManagerId == id)).ThenBy(id => id, StringComparer.Ordinal).First();
    }
    public async Task<Page<AssistanceRequest>> Requests(bool mine, string? status, string? search, int page,
        CancellationToken ct, bool assignedToMe = false, string? view = null, Guid? crisisId = null, string? staffRole = null,
        AidCategory? category = null, Priority? priority = null, Guid? regionId = null)
    {
        IQueryable<AssistanceRequest> q;
        if (staffRole is not null)
        {
            if (staffRole is not (Roles.CaseManager or Roles.Coordinator or Roles.Logistics)) throw new AccessDeniedException();
            q = await access.StaffCases(staffRole, ct);
        }
        else q = await access.Visible(ct);
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
            "critical" => q.Where(r => (r.Priority == Priority.Critical || r.ImmediateDanger) && !CaseReporting.Ended.Contains(r.Status)),
            "unassigned" => q.Where(r => (r.OrganisationId == null || r.AssignedCaseManagerId == null) && !CaseReporting.Ended.Contains(r.Status)),
            "assigned" => q.Where(r => r.AssignedCaseManagerId != null && !CaseReporting.Ended.Contains(r.Status)),
            "escalated" => q.Where(r => r.Escalated),
            "approved" => q.Where(r => r.Status == RequestStatus.Approved),
            "follow-ups" => FollowUpCases(q),
            "verification" => q.Where(r => r.Status == RequestStatus.UnderReview),
            "pending-ai" => PendingAiCases(q.Where(r => !CaseReporting.Ended.Contains(r.Status))),
            "fulfilment" => q.Where(r => ActiveFulfilment.Contains(r.Status)),
            "shortages" => ShortageCases(q),
            _ => q,
        };
        if (crisisId != null)
            q = q.Where(x => x.CrisisId == crisisId);
        if (category != null) q = q.Where(r => r.Category == category);
        if (priority != null) q = q.Where(r => r.Priority == priority);
        if (regionId != null) q = q.Where(r => r.AdministrativeDivisionId == regionId);
        if (Enum.TryParse<RequestStatus>(status, out var state))
            q = q.Where(x => x.Status == state);
        if (!string.IsNullOrWhiteSpace(search))
            q = q.Where(x => x.Reference.Contains(search) || (x.LegacyReference != null && x.LegacyReference.Contains(search)) ||
                x.Description.Contains(search) || x.LocationText.Contains(search));
        int total = (await store.ListAsync(q.GroupBy(_ => 1).Select(group => group.Count()), ct)).SingleOrDefault();
        const int pageSize = 20;
        page = Math.Clamp(page, 1, Math.Max(1, (total - 1) / pageSize + 1));
        var ordered = mine || staffRole is Roles.CaseManager or Roles.Coordinator or Roles.Logistics || view == "history"
            ? q.OrderByDescending(x => x.CreatedAt).ThenBy(x => x.Id)
            : OrderTriage(q);
        return new(await store.ListAsync(ordered.Skip((page - 1) * pageSize).Take(pageSize), ct), total, page, pageSize);
    }

    public static IOrderedQueryable<AssistanceRequest> OrderTriage(IQueryable<AssistanceRequest> cases) => cases
        .OrderByDescending(x => x.ImmediateDanger && !CaseReporting.Ended.Contains(x.Status))
        .ThenByDescending(x => x.Priority == Priority.Critical ? 5 : x.Priority == Priority.Urgent ? 4 :
            x.Priority == Priority.High ? 3 : x.Priority == Priority.Medium || x.Priority == Priority.Normal ? 2 : 1)
        .ThenByDescending(x => x.PriorityScore).ThenBy(x => x.CreatedAt).ThenBy(x => x.Id);

    public IQueryable<AssistanceRequest> FollowUpCases(IQueryable<AssistanceRequest> cases) =>
        cases.Where(r => r.Escalated && store.Query<Feedback>().Any(f => f.RequestId == r.Id && f.Problem && !f.IsSuperseded));

    public async Task<object> MyRequestSummary(CancellationToken ct)
    {
        var visible = await access.Visible(ct);
        var counts = await store.ListAsync(visible.Where(r => r.CitizenId == access.UserId)
            .GroupBy(r => r.Status).Select(group => new { Status = group.Key, Count = group.Count() }), ct);
        return counts;
    }

    public IQueryable<AssistanceRequest> ShortageCases(IQueryable<AssistanceRequest> cases)
    {
        var needs = store.Query<CaseNeed>();
        var allocations = store.Query<ResourceAllocation>().Where(a => a.Status == AllocationStatus.Reserved || a.Status == AllocationStatus.Dispatched);
        var resources = store.Query<Resource>().Where(s => s.TransportAvailable && s.Stock > s.Reserved &&
            store.Query<OrganisationCountry>().Any(o => o.OrganisationId == s.OrganisationId && o.CountryCode == s.CountryCode &&
                (o.VerificationState == "Verified" || o.VerificationState == "LegacyActive")));
        var mass = QuantityUnits.Kilograms.Concat(QuantityUnits.Grams).ToArray();
        var volume = QuantityUnits.Litres.Concat(QuantityUnits.Millilitres).ToArray();
        var large = QuantityUnits.Kilograms.Concat(QuantityUnits.Litres).ToArray();
        var legacy = from request in cases
               join crisis in store.Query<Crisis>() on request.CrisisId equals crisis.Id
               let uncommitted = request.Quantity - request.DeliveredQuantity -
                   (allocations.Where(a => a.RequestId == request.Id).Sum(a => a.RequestQuantity) ?? 0)
               let compatibleStock = (from resource in resources
                   let unit = resource.Unit.Trim().ToLower()
                   where resource.CountryCode == crisis.CountryCode && resource.OrganisationId == request.OrganisationId &&
                       resource.Category == request.Category &&
                       (unit == request.Unit ||
                           (request.Unit == "pieces" && QuantityUnits.Pieces.Contains(unit)) ||
                           (request.Unit == "packs" && QuantityUnits.Packs.Contains(unit)) ||
                           (request.Unit == "persons" && QuantityUnits.Persons.Contains(unit)) ||
                           (mass.Contains(request.Unit!) && mass.Contains(unit)) ||
                           (volume.Contains(request.Unit!) && volume.Contains(unit)))
                   select (decimal?)((resource.Stock - resource.Reserved) * (large.Contains(unit) ? 1000 : 1))).Sum() ?? 0
               let requiredBase = uncommitted * (large.Contains(request.Unit!) ? 1000 : 1)
               let fineStock = (from resource in resources
                   let unit = resource.Unit.Trim().ToLower()
                   where resource.CountryCode == crisis.CountryCode && resource.OrganisationId == request.OrganisationId &&
                       resource.Category == request.Category &&
                       ((mass.Contains(request.Unit!) && QuantityUnits.Grams.Contains(unit)) ||
                        (volume.Contains(request.Unit!) && QuantityUnits.Millilitres.Contains(unit)))
                   select (decimal?)(resource.Stock - resource.Reserved)).Sum() ?? 0
               where ActiveFulfilment.Contains(request.Status) && request.Category != AidCategory.Shelter && request.Unit != null &&
                   !needs.Any(n => n.RequestId == request.Id) &&
                   uncommitted > 0 && (compatibleStock < requiredBase ||
                       ((mass.Contains(request.Unit) || volume.Contains(request.Unit)) && fineStock < requiredBase % 10m))
               select request;
        // Items in the same category and measurement family share a pool of stock.
        var itemCommitments = from allocation in allocations
                              where allocation.NeedId != null
                              group allocation by allocation.NeedId into held
                              select new { NeedId = held.Key, Quantity = held.Sum(a => a.RequestQuantity) };
        var itemDemand = from item in needs
                         join commitment in itemCommitments on (Guid?)item.Id equals commitment.NeedId into holds
                         from hold in holds.DefaultIfEmpty()
                         let remaining = item.ApprovedQuantity - item.DeliveredQuantity - (hold.Quantity ?? 0)
                         let family = mass.Contains(item.Unit) ? "g" : volume.Contains(item.Unit) ? "ml" : item.Unit
                         where remaining > 0
                         group new { Remaining = remaining * (large.Contains(item.Unit) ? 1000 : 1),
                             Fine = (mass.Contains(item.Unit) || volume.Contains(item.Unit))
                                 ? remaining * (large.Contains(item.Unit) ? 1000 : 1) % 10m : 0 }
                         by new { item.RequestId, item.Category, Family = family } into demand
                         select new { demand.Key.RequestId, demand.Key.Category, demand.Key.Family,
                             Quantity = demand.Sum(item => item.Remaining), Fine = demand.Sum(item => item.Fine) };
        var stockByFamily = from resource in resources
                            let unit = resource.Unit.Trim().ToLower()
                            let family = mass.Contains(unit) ? "g" : volume.Contains(unit) ? "ml" :
                                QuantityUnits.Pieces.Contains(unit) ? "pieces" : QuantityUnits.Packs.Contains(unit) ? "packs" :
                                QuantityUnits.Persons.Contains(unit) ? "persons" : unit
                            let available = resource.Stock - resource.Reserved
                            group new { Quantity = available * (large.Contains(unit) ? 1000 : 1),
                                Fine = large.Contains(unit) ? 0 : available }
                            by new { resource.CountryCode, OrganisationId = (Guid?)resource.OrganisationId, resource.Category, Family = family } into stock
                            select new { stock.Key, Quantity = (decimal?)stock.Sum(r => r.Quantity),
                                Fine = (decimal?)stock.Sum(r => r.Fine) };
        var itemShortages = from request in cases
                            join crisis in store.Query<Crisis>() on request.CrisisId equals crisis.Id
                            join demand in itemDemand on request.Id equals demand.RequestId
                            join stock in stockByFamily on new { crisis.CountryCode, request.OrganisationId, demand.Category, demand.Family }
                                equals stock.Key into stockMatch
                            from stock in stockMatch.DefaultIfEmpty()
                            where ActiveFulfilment.Contains(request.Status)
                            where (stock.Quantity ?? 0) < demand.Quantity || (stock.Fine ?? 0) < demand.Fine
                            select request.Id;
        return cases.Where(r => legacy.Any(l => l.Id == r.Id) || itemShortages.Any(id => id == r.Id));
    }
    public async Task<List<AssistanceRequest>> Triage(CancellationToken ct, Guid? crisisId = null)
    {
        var queue = (await access.Visible(ct)).Where(x => (x.OrganisationId == null || x.AssignedCaseManagerId == null)
            && !CaseReporting.Ended.Contains(x.Status) && (crisisId == null || x.CrisisId == crisisId));
        var memberships = await access.Memberships(ct);
        if (await access.IsAdmin(ct))
            return await store.ListAsync(OrderTriage(queue), ct);
        if (!memberships.Any(x => x.Role == Roles.Coordinator || x.Role == Roles.CountryAdministrator))
            throw new AccessDeniedException();
        var crises = (await store.ListAsync(store.Query<CrisisAssignment>().Where(x => x.UserId == access.UserId), ct)).Select(x => x.CrisisId).ToArray();
        return await store.ListAsync(OrderTriage(queue.Where(x => crises.Contains(x.CrisisId) || store.Query<Membership>().Any(m =>
            m.UserId == access.UserId && m.Role == Roles.CountryAdministrator &&
            store.Query<Crisis>().Any(c => c.Id == x.CrisisId && c.CountryCode == m.CountryCode)))), ct);
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
        if (request.OrganisationId != organisationId)
        {
            request.AuthorizedAt = null;
            request.AuthorizedBy = null;
            request.RequiresCoordinatorAuthorization = true;
            request.HandoverCentreId = null;
        }
        request.OrganisationId = organisationId;
        request.AssignedCaseManagerId = await ChooseCaseManager(organisationId, request.CrisisId, ct);
        request.AssignmentStatus = AssignmentStatus.Reassigned;
        Audit("RequestReassigned", request, $"Centre {previous?.ToString() ?? "unassigned"} to {organisationId}; case manager {previousManager ?? "unassigned"} to {request.AssignedCaseManagerId ?? "unassigned"}", await CrisisCountry(request.CrisisId, ct));
        await notifications.RequestChanged(request, "Case assignment updated.", ct,
            actionRole: request.AssignedCaseManagerId == null ? Roles.Coordinator : null);
        return request;
    }, ct);
    public Task<AssistanceRequest> AssignManager(Guid id, string userId, CancellationToken ct) => store.RoutingTransactionAsync(async () =>
    {
        var request = await store.FindAsync<AssistanceRequest>(id, ct) ?? throw new MissingException();
        if (!await access.IsAdmin(ct) && !await access.Coordinates(request.CrisisId, ct)) throw new AccessDeniedException();
        var grants = store.Query<Membership>().Where(x => x.Role == Roles.CaseManager && x.UserId == userId);
        if (!request.OrganisationId.HasValue || (await store.ListAsync(grants.Where(x => x.OrganisationId == request.OrganisationId && (x.CrisisId == null || x.CrisisId == request.CrisisId) && store.Query<Crisis>().Any(c => c.Id == request.CrisisId && c.CountryCode == x.CountryCode) &&
            !grants.Any(other => other.CountryCode != x.CountryCode)), ct)).Count == 0) throw new RuleException("Choose a case manager at the assigned centre with a single assigned country.");
        var previous = request.AssignedCaseManagerId;
        request.AssignedCaseManagerId = userId;
        Audit("CaseManagerAssigned", request, $"From {previous ?? "unassigned"} to {userId}", await CrisisCountry(request.CrisisId, ct));
        await notifications.RequestChanged(request, "Case assignment updated.", ct);
        return request;
    }, ct);
    public async Task<object> Detail(Guid id, CancellationToken ct)
    {
        var r = await access.Request(id, ct: ct);
        var region = r.AdministrativeDivisionId is Guid divisionId
            ? await store.FindAsync<AdministrativeDivision>(divisionId, ct) : null;
        var histories = await store.ListAsync(store.Query<RequestHistory>().Where(x => x.RequestId == id).OrderBy(x => x.CreatedAt), ct);
        var attachments = await store.ListAsync(store.Query<Attachment>().Where(x => x.RequestId == id).Select(x => new { x.Id, x.OriginalName, x.ContentType, x.Size }), ct);
        var allocations = await store.ListAsync(store.Query<ResourceAllocation>().Where(x => x.RequestId == id).Select(a => new
        {
            a.Id, a.Reference, a.RequestId, a.ResourceId, a.Quantity, a.RequestQuantity, a.Status, a.ApprovedBy, a.CreatedAt, a.UpdatedAt, a.Version,
            a.PackedAt, a.ScheduledArrivalAt, a.NeedId, a.CaseDispatchId,
            Unit = store.Query<Resource>().Where(stock => stock.Id == a.ResourceId).Select(stock => stock.Unit).FirstOrDefault(),
            ConfirmedQuantity = store.Query<DeliveryConfirmation>().Where(d => d.AllocationId == a.Id)
                .Select(d => (decimal?)d.ConfirmedQuantity).FirstOrDefault(),
        }), ct);
        var placements = await store.ListAsync(store.Query<ShelterAllocation>().Where(x => x.RequestId == id).Select(a => new
        {
            a.Id, a.RequestId, a.ShelterId, a.People, a.Status, a.CreatedAt, a.UpdatedAt, a.Version, a.ApprovedBy,
            ShelterName = store.Query<Shelter>().Where(s => s.Id == a.ShelterId).Select(s => s.Name).FirstOrDefault(),
        }), ct);
        var feedbackQuery = store.Query<Feedback>().Where(x => x.RequestId == id);
        if (r.CitizenId == access.UserId)
            feedbackQuery = feedbackQuery.Where(x => x.UserId == access.UserId && !x.IsSuperseded);
        var feedback = await store.ListAsync(feedbackQuery.OrderBy(x => x.IsSuperseded).ThenByDescending(x => x.CreatedAt), ct);
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
            IntakeFactors = r.IntakeScore != null && r.Intake is { } intake
                ? CitizenTriage.Factors(r.Category, intake, r.HouseholdSize).Select(factor => new { factor.Factor, factor.Points }).ToArray()
                : null,
            AdministrativeRegion = region?.Name,
            CrisisName = (await store.FindAsync<Crisis>(r.CrisisId, ct))?.Name,
            OrganisationName = r.OrganisationId is Guid orgId ? (await store.FindAsync<Organisation>(orgId, ct))?.Name : null,
            History = histories.Select(h => new { h.Id, h.CreatedAt, h.Status, Note = r.CitizenId == access.UserId ? CitizenHistoryNote(r.Reference, h.Status) : h.Note, ActorId = r.CitizenId == access.UserId ? "" : h.ActorId }),
            Attachments = attachments,
            Allocations = allocations,
            Items = await store.ListAsync(store.Query<CaseNeed>().Where(n => n.RequestId == id).OrderBy(n => n.CreatedAt).ThenBy(n => n.Id), ct),
            Placements = placements,
            Feedback = feedback,
            HasStockShortage = access.IsCoordinatorWorkspace
                ? (bool?)(await store.ListAsync(ShortageCases(visible.Where(x => x.Id == id)).Select(x => x.Id), ct)).Any()
                : null,
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
            original.CitizenId != primary.CitizenId || original.Category != primary.Category || !EqualRequestMeasurement(original, primary) ||
            original.HouseholdSize != primary.HouseholdSize || original.RequestedForSomeoneElse || primary.RequestedForSomeoneElse)
            throw new RuleException("Consolidate only equivalent requests by the same citizen within the same crisis and response organisation. Cases filed for another person require separate review.");
        var detected = await store.ListAsync(store.Query<PotentialDuplicate>().Where(d =>
            d.RequestId == id && d.CandidateId == primary.Id || d.RequestId == primary.Id && d.CandidateId == id), ct);
        if (detected.Count > 0 && !detected.Any(d => d.State == "Confirmed"))
            throw new RuleException("Compare the cases and confirm the detected match before consolidating.");
        var links = store.Query<CaseConsolidation>();
        if ((await store.ListAsync(links.Where(x => x.OriginalRequestId == id || x.PrimaryRequestId == id ||
            x.OriginalRequestId == primary.Id).OrderBy(x => x.Id).Take(1), ct)).Count > 0)
            throw new RuleException("These cases already have a consolidation relationship that prevents this action.");
        if (primary.Status is RequestStatus.Rejected or RequestStatus.Cancelled or RequestStatus.Closed or RequestStatus.Fulfilled ||
            original.DeliveredQuantity > 0 || original.Escalated ||
            (await store.ListAsync(store.Query<ResourceAllocation>().Where(x => x.RequestId == id && x.Status != AllocationStatus.Cancelled).OrderBy(x => x.Id).Take(1), ct)).Count > 0 ||
            (await store.ListAsync(store.Query<ShelterAllocation>().Where(x => x.RequestId == id && x.Status != StayStatus.Cancelled).OrderBy(x => x.Id).Take(1), ct)).Count > 0 ||
            (await store.ListAsync(store.Query<VolunteerTask>().Where(x => x.RequestId == id && x.Status != VolunteerTaskStatus.Declined).OrderBy(x => x.Id).Take(1), ct)).Count > 0 ||
            (await store.ListAsync(store.Query<CaseShare>().Where(x => x.RequestId == id).OrderBy(x => x.Id).Take(1), ct)).Count > 0 ||
            (await store.ListAsync(store.Query<DonationAllocation>().Where(x => x.RequestId == id).OrderBy(x => x.Id).Take(1), ct)).Count > 0 ||
            (await store.ListAsync(store.Query<SupplyRequest>().Where(x => x.CaseId == id && !x.Cancelled).OrderBy(x => x.Id).Take(1), ct)).Count > 0)
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

    private static bool EqualRequestMeasurement(AssistanceRequest first, AssistanceRequest second)
    {
        if (first.Category == AidCategory.Shelter) return first.Quantity == 1 && second.Quantity == 1;
        return QuantityUnits.Compatible(first.Unit, second.Unit) &&
            QuantityUnits.Convert(first.Quantity, first.Unit, second.Unit) == second.Quantity;
    }
    private static string CitizenHistoryNote(string reference, string status) =>
        Enum.TryParse<RequestStatus>(status, out var state) && Enum.IsDefined(state)
            ? CitizenMessages.Status(reference, state, "en")
            : "Your request has been updated.";
    public async Task<AssistanceRequest> ChangeStatus(Guid id, StatusInput input, CancellationToken ct)
    {
        if (access.IsCoordinatorWorkspace && input.Status is RequestStatus.UnderReview or
            RequestStatus.Verified or RequestStatus.Approved or RequestStatus.Rejected)
            throw new AccessDeniedException();
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
        if (input.Status == RequestStatus.Approved) r.RequiresCoordinatorAuthorization = true;
        r.Transition(input.Status, input.Reason);
        var actionRole = input.Status == RequestStatus.Approved
            ? r.Category == AidCategory.Shelter ? Roles.ShelterAdmin : Roles.Coordinator
            : null;
        await RecordChange(r, input.Reason.Length > 0 ? input.Reason : $"Case moved to {r.Status}.", ct, previousStatus, actionRole: actionRole);
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
        await RecordChange(r, "Case escalated: " + reason, ct, r.Status, "Escalated", actionRole: Roles.Coordinator);
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
    private IQueryable<Recommendation> LatestRecommendation(Guid id) => store.Query<Recommendation>()
        .Where(x => x.RequestId == id).OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id).Take(1);

    public IQueryable<AssistanceRequest> PendingAiCases(IQueryable<AssistanceRequest> cases)
    {
        var recommendations = store.Query<Recommendation>();
        return cases.Where(r => r.AssessmentState == "Pending" || (r.AssessmentState == null || r.AssessmentState == "Completed") && recommendations.Where(x => x.RequestId == r.Id)
            .OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id).Take(1)
            .Any(x => x.ReviewState == "Pending" || x.ReviewState == "Defer"));
    }

    public async Task<object> AiDetail(Guid id, CancellationToken ct)
    {
        await access.Request(id, CaseRoles, ct);
        var visibleIds = (await access.Visible(ct)).Select(x => x.Id);
        var job = (await store.ListAsync(store.Query<RequestAnalysisJob>().Where(j => j.RequestId == id)
            .Select(j => new AnalysisJobState(j.State, j.Attempts, j.FailureReason)), ct)).SingleOrDefault();
        var duplicates = await store.ListAsync(store.Query<PotentialDuplicate>().Where(x =>
            (x.RequestId == id && visibleIds.Contains(x.CandidateId)) ||
            (x.CandidateId == id && visibleIds.Contains(x.RequestId))).OrderByDescending(x => x.Similarity), ct);
        return new
        {
            Recommendations = (await store.ListAsync(LatestRecommendation(id), ct)).Select(AiPresentation.Recommendation),
            Decisions = (await store.ListAsync(
                from decision in store.Query<HumanDecision>()
                join original in store.Query<Recommendation>() on decision.RecommendationId equals original.Id
                where decision.RequestId == id && original.RequestId == id
                orderby decision.CreatedAt descending, decision.Id descending
                select new { decision.Id, decision.CreatedAt, decision.UpdatedAt, decision.Version, decision.RequestId,
                    decision.RecommendationId, decision.ActorId, decision.Action, decision.Reason, decision.FinalPriority,
                    OriginalPriority = original.Priority, OriginalConfidence = original.Confidence,
                    OriginalConfidenceKind = original.ConfidenceKind, OriginalExplanation = original.Explanation }, ct))
                .Select(d => new { d.Id, d.CreatedAt, d.UpdatedAt, d.Version, d.RequestId, d.RecommendationId, d.ActorId,
                    d.Action, d.Reason, d.FinalPriority, d.OriginalPriority, d.OriginalConfidence, d.OriginalConfidenceKind,
                    OriginalExplanation = AiPresentation.Text(d.OriginalExplanation) }),
            Duplicates = duplicates.Select(d => new { d.Id, RequestId = id, CandidateId = d.RequestId == id ? d.CandidateId : d.RequestId,
                d.Similarity, d.State, Reason = AiPresentation.Text(d.Reason),
                Model = d.Model is { } model ? AiPresentation.Model(model) : null, d.CreatedAt }).DistinctBy(d => d.CandidateId),
            Processing = job is { FailureReason: { } reason } ? job with { FailureReason = AiPresentation.Text(reason) } : job
        };
    }
    public async Task<Recommendation> GenerateAi(Guid id, CancellationToken ct)
    {
        var r = await access.Request(id, CaseRoles, ct);
        if (CaseReporting.Ended.Contains(r.Status)) throw new RuleException("This case is no longer open.");
        if (r.IntakeJson is not null) throw new RuleException("Citizen intake assessments run automatically.");
        var analysis = await intelligence.Analyze(r, ct);
        return await store.RoutingTransactionAsync(async () =>
        {
            var current = await access.Request(id, CaseRoles, ct);
            if (CaseReporting.Ended.Contains(current.Status)) throw new RuleException("This case is no longer open.");
            var job = (await store.ListAsync(store.Query<RequestAnalysisJob>().Where(j => j.RequestId == id), ct)).SingleOrDefault();
            var recommendation = await intelligence.Save(current, analysis, await access.Visible(ct), access.UserId, ct);
            if (job is not null)
            {
                job.State = analysis.Result.Fallback ? "Fallback" : "Completed";
                job.FailureReason = analysis.Result.Fallback ? analysis.Result.Explanation : null;
                job.CompletedAt = DateTimeOffset.UtcNow;
                job.Lease = null;
            }
            return recommendation;
        }, ct);
    }
    public static double Similarity(string left, string right)
    {
        var a = left.ToLowerInvariant().Split([' ', ',', '.', '!', '?', '\n'], StringSplitOptions.RemoveEmptyEntries).ToHashSet();
        var b = right.ToLowerInvariant().Split([' ', ',', '.', '!', '?', '\n'], StringSplitOptions.RemoveEmptyEntries).ToHashSet();
        return a.Count == 0 && b.Count == 0 ? 0 : (double)a.Intersect(b).Count() / a.Union(b).Count();
    }
    public Task<Recommendation> Decide(Guid id, DecisionInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        if (access.IsCoordinatorWorkspace) throw new AccessDeniedException();
        var r = await access.Request(id, CaseRoles, ct);
        var recommendation = (await store.ListAsync(LatestRecommendation(id), ct)).SingleOrDefault();
        if (recommendation is null || recommendation.Id != input.RecommendationId)
            throw new MissingException();
        if (recommendation.ReviewState is not ("Pending" or "Defer"))
            throw new RuleException("This recommendation has already been decided.");
        if (!new[] { "Approve", "Modify", "Reject", "Defer" }.Contains(input.Action))
            throw new RuleException("Invalid decision action.");
        if (recommendation.ReviewState == "Defer" && input.Action == "Defer") return recommendation;
        if (input.Action is "Modify" or "Reject" && string.IsNullOrWhiteSpace(input.Reason))
            throw new RuleException("A reason is required.");
        if (r.Status is RequestStatus.Fulfilled or RequestStatus.Closed or RequestStatus.Cancelled or RequestStatus.Rejected)
            throw new RuleException("This case is no longer open.");
        if (input.Action is "Approve" or "Modify")
        {
            var priority = input.Action == "Modify" ? input.FinalPriority ?? throw new RuleException("Choose a final priority.") :
                r.IntakeJson is not null ? r.Priority : recommendation.Priority;
            r.Priority = r.Priority == Priority.Critical || r.ImmediateDanger || recommendation.UrgencyScore == 100 ? Priority.Critical : priority;
            if (r.IntakeJson is not null && input.Action == "Modify")
                r.NextPriorityEscalationAt = null;
            var category = input.Action == "Modify" ? input.FinalCategory ?? r.Category : recommendation.Category;
            if (r.IntakeJson is not null)
            {
                if (input.FinalCategory.HasValue && input.FinalCategory != r.Category)
                    throw new RuleException("Keep the category associated with the original intake answers.");
                category = r.Category;
            }
            if (category != r.Category && (category == AidCategory.Shelter || r.Category == AidCategory.Shelter))
                throw new RuleException("A household placement needs a separate shelter request.");
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
        if (d.RequestId != id && d.CandidateId != id)
            throw new MissingException();
        await access.Request(d.RequestId == id ? d.CandidateId : d.RequestId, CaseRoles, ct);
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
        if (access.IsCoordinatorWorkspace)
            return await store.ListAsync(access.CoordinatorInventory(await access.CoordinatorCountry(ct))
                .OrderBy(x => x.Name).ThenBy(x => x.Id), ct);
        return await store.ListAsync((await access.Located<Resource>(ct, roles: LogisticsReaders)).OrderBy(x => x.Name), ct);
    }
    public Task<Resource> AddResource(ResourceInput input, CancellationToken ct) =>
        store.TransactionAsync(() => RegisterResource(input, ct), ct);

    public Task<List<Resource>> AddResources(ResourceBatchInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var operationIds = new HashSet<Guid>();
        var resources = new List<Resource>(input.Resources.Length);
        foreach (var item in input.Resources)
        {
            if (item?.OperationId is not { } id || id == Guid.Empty || !operationIds.Add(id))
                throw new RuleException("Provide a unique registration reference for each resource.");
            resources.Add(await RegisterResource(item, ct));
        }
        return resources;
    }, ct);

    private async Task<Resource> RegisterResource(ResourceInput input, CancellationToken ct)
    {
        // Crisis assignments can register inventory at their permitted depots.
        var registerAtDepot = input.DepotId.HasValue;
        await access.RequireLocation(input.OrganisationId, input.CountryCode, LogisticsRoles, ct,
            includeCrisisAssignments: registerAtDepot);
        await access.RequireDepot(new Resource { OrganisationId = input.OrganisationId, CountryCode = input.CountryCode, DepotId = input.DepotId }, ct,
            includeCrisisAssignments: registerAtDepot);
        CountryLocations.Validate(input.CountryCode, input.Latitude, input.Longitude);
        if (input.AdministrativeDivisionId is { } divisionId &&
            (await store.FindAsync<AdministrativeDivision>(divisionId, ct))?.CountryCode != input.CountryCode)
            throw new RuleException("Choose an administrative division in the resource country.");
        if (string.IsNullOrWhiteSpace(input.LocationText)) throw new RuleException("Enter a resource location.");
        var name = input.Name.Trim();
        var unit = units.Require(input.Unit);
        if (name.Length == 0) throw new RuleException("Enter a resource name.");
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
                QuantityUnits.Normalize(existing.Unit) != unit || existing.Category != input.Category)
                throw new RuleException("This resource registration reference has already been used.");
            return existing;
        }
        units.EnsureStockCategory(unit, input.Category);
        QuantityUnits.ValidateStockLevel(input.Stock, unit);
        if (input.LowStockThreshold is { } threshold) QuantityUnits.ValidateStockLevel(threshold, unit);
        var r = new Resource { Id = input.OperationId ?? Guid.NewGuid(), CountryCode = input.CountryCode, AdministrativeDivisionId = input.AdministrativeDivisionId, OrganisationId = input.OrganisationId, DepotId = input.DepotId, Code = code, LowStockThreshold = input.LowStockThreshold, Name = name, Category = input.Category, Unit = unit, Stock = input.Stock, LocationText = input.LocationText, Latitude = input.Latitude, Longitude = input.Longitude, Suitability = input.Suitability, TransportAvailable = input.TransportAvailable };
        store.Add(r);
        store.Add(new StockMovement { ResourceId = r.Id, OperationId = r.Id, Quantity = r.Stock, Kind = "Opening", ActorId = access.UserId, Destination = r.LocationText, Note = "Resource registered." });
        Audit("ResourceCreated", r);
        return r;
    }
    public async Task Replenish(Guid id, MovementInput input, CancellationToken ct)
    {
        var r = await store.FindAsync<Resource>(id, ct) ?? throw new MissingException();
        await access.RequireLocation(r.OrganisationId, r.CountryCode, LogisticsRoles, ct);
        await access.RequireDepot(r, ct);
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
        var movements = store.Query<StockMovement>().Where(x => x.ResourceId == id);
        if (access.IsCoordinatorWorkspace)
        {
            var country = await access.CoordinatorCountry(ct);
            var inventory = access.CoordinatorInventory(country);
            if (!(await store.ListAsync(inventory.Where(resource => resource.Id == id), ct)).Any())
                throw new AccessDeniedException();
            var crises = access.CoordinatorCrises(country);
            var cases = await access.StaffCases(Roles.Coordinator, ct);
            movements = movements.Where(m => (m.RequestId == null || cases.Any(c => c.Id == m.RequestId)) &&
                (m.CrisisId == null || crises.Any(c => c.Id == m.CrisisId)));
        }
        else
        {
            await access.RequireLocation(r.OrganisationId, r.CountryCode, LogisticsReaders, ct);
            await access.RequireDepot(r, ct, allowCoordinatorRead: true);
        }
        return await store.ListAsync(movements.OrderByDescending(x => x.CreatedAt).ThenBy(x => x.Id), ct);
    }
    public async Task<List<Resource>> CaseResources(Guid requestId, CancellationToken ct)
    {
        var request = await access.Request(requestId, LogisticsReaders, ct);
        return await CaseResources(request, request.Category, request.Unit, ct);
    }

    private async Task<List<Resource>> CaseResources(AssistanceRequest request, AidCategory category, string? unit, CancellationToken ct)
    {
        if (unit is null || category == AidCategory.Shelter) return [];
        var crisis = await store.FindAsync<Crisis>(request.CrisisId, ct) ?? throw new MissingException();
        var resources = await store.ListAsync((await access.Located<Resource>(ct, request.CrisisId, LogisticsReaders)).Where(x => x.CountryCode == crisis.CountryCode &&
            x.Category == category && store.Query<OrganisationCountry>().Any(o => o.OrganisationId == x.OrganisationId && o.CountryCode == x.CountryCode &&
                (o.VerificationState == "Verified" || o.VerificationState == "LegacyActive"))), ct);
        return resources.Where(x => QuantityUnits.Compatible(x.Unit, unit)).ToList();
    }
    public async Task<List<Shelter>> CaseShelters(Guid requestId, CancellationToken ct)
    {
        var request = await access.Request(requestId, ShelterReaders, ct);
        var crisis = await store.FindAsync<Crisis>(request.CrisisId, ct) ?? throw new MissingException();
        var cutoff = shelterPolicy.ReviewCutoff;
        return await store.ListAsync((await access.Located<Shelter>(ct, request.CrisisId, ShelterReaders)).Where(x =>
            !x.PendingVerification && (!x.Open || (x.OperationalUpdatedAt ?? x.UpdatedAt) >= cutoff) && x.CountryCode == crisis.CountryCode && store.Query<OrganisationCountry>().Any(o => o.OrganisationId == x.OrganisationId && o.CountryCode == x.CountryCode && (o.VerificationState == "Verified" || o.VerificationState == "LegacyActive"))), ct);
    }
    public async Task<List<ShelterCandidate>> ShelterRecommendations(Guid requestId, CancellationToken ct)
    {
        var request = await access.Request(requestId, ShelterReaders, ct);
        var shelters = await CaseShelters(requestId, ct);
        var evidence = await FulfilmentSignals(request, "shelter-eligibility-v2", "Reservation pending", ct);
        var facilitiesRequired = evidence.Needs.Where(n => n is "accessible toilet" or "electricity").ToArray();
        var accessible = !string.IsNullOrWhiteSpace(request.AccessibilityNeeds) ||
            evidence.Needs.Any(n => n is "step-free access" or "accessible toilet");
        return shelters.Where(s => s.Open && s.Available >= request.HouseholdSize &&
            (!accessible || s.Accessible) && facilitiesRequired.All(RequestSignals.Local(s.Facilities).Contains))
            .Select(s =>
            {
                double? distance = request.Latitude.HasValue && request.Longitude.HasValue
                    ? Math.Round(RankedAllocationStrategy.Distance(request.Latitude.Value, request.Longitude.Value, s.Latitude, s.Longitude), 1)
                    : null;
                var matches = RequestSignals.Local(s.Facilities).Intersect(evidence.Needs).ToArray();
                var score = Math.Round(50 + (s.Accessible ? 10 : 0) + matches.Length * 5 + (distance is double km ? 30 / (1 + km / 10) : 0), 1);
                return new ShelterCandidate(s.Id, s.Name, s.Available, s.Accessible, distance,
                    $"Capacity for {request.HouseholdSize} people. " +
                    (matches.Length == 0 ? "" : $"Recorded facilities match {string.Join(", ", matches)}. ") +
                    (distance.HasValue ? $"{distance:0.0} km straight-line distance. " : "Request location unavailable. ") +
                    "Check facilities, accessibility needs, transport and arrival conditions before reserving.", score, evidence);
            }).OrderByDescending(s => s.Score).ThenBy(s => s.DistanceKm ?? double.MaxValue)
            .ThenByDescending(s => s.Available).ThenBy(s => s.Id).ToList();
    }

    private async Task<FulfilmentEvidence> FulfilmentSignals(AssistanceRequest request, string algorithm, string review, CancellationToken ct)
    {
        var recommendation = (await store.ListAsync(LatestRecommendation(request.Id), ct)).SingleOrDefault();
        var usesAdvice = recommendation?.SignalsJson != null && recommendation.ReviewState != "Reject";
        var signals = RequestSignals.Validate(RequestSignals.Local(request.Description + " " + request.AccessibilityNeeds)
            .Concat(usesAdvice ? RequestSignals.Read(recommendation!.SignalsJson) : []));
        var processing = (await store.ListAsync(store.Query<RequestAnalysisJob>().Where(j => j.RequestId == request.Id)
            .Select(j => j.State), ct)).SingleOrDefault();
        var source = usesAdvice ? AiPresentation.Source($"{recommendation!.Provider} · {recommendation.Model}") : "Local request indicators";
        return new(algorithm, source, processing ?? (usesAdvice ? "Completed" : "Local"), review, signals);
    }

    public async Task<AllocationRecommendations> AllocationRecommendations(Guid requestId, CancellationToken ct, Guid? needId = null)
    {
        var request = await access.Request(requestId, LogisticsReaders, ct);
        var need = needId.HasValue ? (await store.ListAsync(store.Query<CaseNeed>().Where(n => n.Id == needId && n.RequestId == requestId), ct))
            .SingleOrDefault() ?? throw new MissingException() : null;
        var target = need is null ? request : ItemDemand(request, need);
        var resources = await CaseResources(request, target.Category, target.Unit, ct);
        var needs = store.Query<CaseNeed>();
        var cases = await store.ListAsync((await access.Visible(ct)).Where(x => x.OrganisationId == request.OrganisationId &&
            x.CrisisId == request.CrisisId && ActiveFulfilment.Contains(x.Status) &&
            (x.Category == target.Category || needs.Any(n => n.RequestId == x.Id && n.Category == target.Category))), ct);
        if (cases.All(x => x.Id != request.Id)) cases.Add(request);
        var ids = cases.Select(x => x.Id).ToArray();
        var items = (await store.ListAsync(needs.Where(n => ids.Contains(n.RequestId)), ct)).ToLookup(n => n.RequestId);
        var commitments = await store.ListAsync(store.Query<ResourceAllocation>().Where(x => ids.Contains(x.RequestId) &&
            (x.Status == AllocationStatus.Reserved || x.Status == AllocationStatus.Dispatched)), ct);
        var approved = (await store.ListAsync(store.Query<RequestHistory>().Where(x => ids.Contains(x.RequestId) && x.Status == "Approved"), ct))
            .ToLookup(h => h.RequestId);
        var reserved = commitments.ToLookup(a => (a.RequestId, a.NeedId));
        var demand = new List<AllocationDemand>();
        foreach (var itemCase in cases)
        {
            var waitingSince = approved[itemCase.Id].Select(h => (DateTimeOffset?)h.CreatedAt).Min() ?? itemCase.CreatedAt;
            if (!items.Contains(itemCase.Id) || itemCase.Id == requestId && needId is null)
            {
                if (itemCase.Category == target.Category)
                    demand.Add(new(itemCase, Committed(itemCase.Id, null), waitingSince));
                continue;
            }
            foreach (var item in items[itemCase.Id].Where(n => n.Category == target.Category))
                demand.Add(new(ItemDemand(itemCase, item), Committed(itemCase.Id, item.Id), waitingSince));
        }
        var evidence = await FulfilmentSignals(request, "inventory-constraints-v2", "Reservation pending", ct);
        if (need is not null)
            evidence = evidence with { Needs = RequestSignals.Validate(evidence.Needs.Concat(RequestSignals.Local(need.Name))) };
        return allocationStrategy.Recommend(target, Committed(request.Id, needId), resources, demand, evidence);

        decimal Committed(Guid id, Guid? itemId) => reserved[(id, itemId)].Sum(a => a.RequestQuantity ?? 0);
    }

    private static AssistanceRequest ItemDemand(AssistanceRequest request, CaseNeed item) => new()
    {
        Id = item.Id, CrisisId = request.CrisisId, OrganisationId = request.OrganisationId, Category = item.Category, Unit = item.Unit,
        Quantity = item.ApprovedQuantity, DeliveredQuantity = item.DeliveredQuantity, Priority = request.Priority, Status = request.Status,
        CreatedAt = request.CreatedAt, Latitude = request.Latitude, Longitude = request.Longitude,
        Description = item.Name, AccessibilityNeeds = request.AccessibilityNeeds
    };
    public async Task IgnoreAllocationRecommendation(Guid requestId, Guid resourceId, CancellationToken ct)
    {
        var request = await access.Request(requestId, LogisticsRoles, ct);
        var recommendations = await AllocationRecommendations(requestId, ct);
        if (recommendations.Candidates.FirstOrDefault(x => x.TransportAvailable)?.ResourceId != resourceId) throw new RuleException("The recommendation has changed; refresh it first.");
        Audit("AllocationRecommendationIgnored", request, $"Recommended resource {resourceId}; staff chose to ignore it.", await CrisisCountry(request.CrisisId, ct));
        await store.SaveAsync(ct);
    }
    public async Task<ResourceAllocation> Allocate(AllocateInput input, CancellationToken ct) =>
        (await ReserveAllocations(input, grouped: false, ct)).Single();

    public Task<List<ResourceAllocation>> AllocateGroup(AllocateInput input, CancellationToken ct) =>
        ReserveAllocations(input, grouped: true, ct);

    private Task<List<ResourceAllocation>> ReserveAllocations(AllocateInput input, bool grouped, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var r = await access.Request(input.RequestId, LogisticsRoles, ct);
        var resource = await store.FindAsync<Resource>(input.ResourceId, ct) ?? throw new MissingException();
        await access.RequireLocation(resource.OrganisationId, resource.CountryCode, LogisticsRoles, ct, r.CrisisId);
        await access.RequireDepot(resource, ct, r.CrisisId);
        var crisis = await store.FindAsync<Crisis>(r.CrisisId, ct) ?? throw new MissingException();
        if (resource.CountryCode != crisis.CountryCode)
            throw new RuleException("A resource must be in the same country as the crisis.");
        if (input.OperationId == Guid.Empty || grouped && input.OperationId == null)
            throw new RuleException("Provide a unique operation reference.");
        var sources = grouped ? await AllocationSources(resource, ct) : [resource];
        if (input.OperationId is Guid operationId && await store.FindAsync<ResourceAllocation>(operationId, ct) is { } existing)
        {
            var replay = new List<ResourceAllocation> { existing };
            if (grouped)
            {
                var siblingIds = sources.Select(s => AllocationPartId(operationId, s.Id)).ToArray();
                replay.AddRange(await store.ListAsync(store.Query<ResourceAllocation>().Where(a => siblingIds.Contains(a.Id)), ct));
            }
            if (replay.Sum(a => a.Quantity) != input.Quantity || replay.Any(a =>
                a.RequestId != r.Id || a.NeedId != input.NeedId || a.ApprovedBy != access.UserId ||
                sources.All(s => s.Id != a.ResourceId)))
                throw new RuleException("This operation reference belongs to another reservation.");
            return replay;
        }
        if (r.Status is not (RequestStatus.Approved or RequestStatus.InProgress or RequestStatus.PartiallyFulfilled))
            throw new RuleException("Verify and approve this case before allocating aid.");
        if (r.RequiresCoordinatorAuthorization && r.AuthorizedAt == null)
            throw new RuleException("Coordinator authorization is required before reserving stock.");
        var needs = await store.ListAsync(store.Query<CaseNeed>().Where(n => n.RequestId == r.Id), ct);
        var need = needs.SingleOrDefault(n => n.Id == input.NeedId);
        if (needs.Count > 0 && need == null || input.NeedId != null && need == null)
            throw new RuleException("Select an approved item on this case.");
        var demand = need == null ? r : new AssistanceRequest { Status = r.Status, OrganisationId = r.OrganisationId,
            Category = need.Category, Unit = need.Unit, Quantity = need.ApprovedQuantity, DeliveredQuantity = need.DeliveredQuantity };
        var committed = (await store.ListAsync(store.Query<ResourceAllocation>().Where(x => x.RequestId == r.Id && x.NeedId == input.NeedId &&
            (x.Status == AllocationStatus.Reserved || x.Status == AllocationStatus.Dispatched)), ct)).Sum(x => x.RequestQuantity ?? 0);
        if (input.RecommendedResourceId.HasValue)
        {
            var current = await AllocationRecommendations(r.Id, ct, input.NeedId);
            if (current.Candidates.FirstOrDefault(x => x.TransportAvailable)?.ResourceId != input.RecommendedResourceId.Value)
                throw new RuleException("The recommendation has changed; refresh it before reserving.");
        }
        await access.RequirePartner(resource.OrganisationId, resource.CountryCode, ct);
        var plan = grouped ? PlanGroupedAllocation(sources, input.Quantity, resource.Unit) : [(resource, input.Quantity)];
        foreach (var (source, quantity) in plan)
        {
            allocationPolicy.Validate(demand, source, quantity, committed);
            committed += QuantityUnits.Convert(quantity, source.Unit, demand.Unit);
        }
        var previousStatus = r.Status;
        var allocations = new List<ResourceAllocation>(plan.Count);
        var reservationId = input.OperationId ?? Guid.NewGuid();
        foreach (var (source, quantity) in plan)
        {
            source.Reserve(quantity);
            await notifications.StockAlert(source, ct);
            var allocation = new ResourceAllocation
            {
                Id = allocations.Count == 0 ? reservationId : AllocationPartId(reservationId, source.Id),
                RequestId = r.Id, ResourceId = source.Id, Quantity = quantity, NeedId = input.NeedId,
                RequestQuantity = QuantityUnits.Convert(quantity, source.Unit, demand.Unit), ApprovedBy = access.UserId
            };
            allocations.Add(allocation);
            store.Add(allocation);
            store.Add(new StockMovement { ResourceId = source.Id, OperationId = allocation.Id, RequestId = r.Id, CrisisId = r.CrisisId, Quantity = quantity, Kind = "Reserved", ActorId = access.UserId, Origin = source.LocationText, Destination = r.Reference, Note = "Reserved for the authorised request." });
            Audit("ResourceReserved", allocation, countryCode: source.CountryCode);
        }
        if (r.Status == RequestStatus.Approved)
            r.Transition(RequestStatus.InProgress);
        await RecordChange(r, $"{input.Quantity} {resource.Unit} reserved; remaining needs stay open.", ct, previousStatus,
            dispatchUpdate: true, depotId: resource.DepotId);
        if (input.RecommendedResourceId.HasValue)
        {
            var suggested = await store.FindAsync<Resource>(input.RecommendedResourceId.Value, ct) ?? throw new RuleException("Recommended resource not found.");
            await access.RequireLocation(suggested.OrganisationId, suggested.CountryCode, LogisticsRoles, ct, r.CrisisId);
            if (suggested.Category != demand.Category) throw new RuleException("Recommended resource category does not match the requested item.");
            Audit(sources.Any(s => s.Id == suggested.Id) ? "AllocationRecommendationAccepted" : "AllocationRecommendationIgnored", r, $"Recommended resource {suggested.Id}; reserved from source {resource.Id}; quantity {input.Quantity}.", resource.CountryCode);
        }
        return allocations;
    }, ct);

    private async Task<List<Resource>> AllocationSources(Resource source, CancellationToken ct)
    {
        if (source.DepotId == null) return [source];
        var name = source.Name.Trim().ToLowerInvariant();
        var unit = QuantityUnits.Normalize(source.Unit);
        var rows = await store.ListAsync(store.Query<Resource>().Where(r => r.Id != source.Id &&
            r.CountryCode == source.CountryCode && r.OrganisationId == source.OrganisationId && r.DepotId == source.DepotId &&
            r.Category == source.Category && r.Name.Trim().ToLower() == name).OrderBy(r => r.CreatedAt).ThenBy(r => r.Id), ct);
        return [source, .. rows.Where(r => QuantityUnits.Normalize(r.Unit) == unit &&
            string.Equals(r.Name.Trim(), source.Name.Trim(), StringComparison.OrdinalIgnoreCase))];
    }

    private static List<(Resource Resource, decimal Quantity)> PlanGroupedAllocation(List<Resource> sources, decimal requested, string unit)
    {
        QuantityUnits.ValidateInventory(requested, unit);
        var remaining = requested;
        var plan = new List<(Resource, decimal)>();
        foreach (var source in sources.Where(r => r.TransportAvailable && r.Available > 0))
        {
            var quantity = Math.Min(remaining, QuantityUnits.FloorToInventory(source.Available, source.Unit));
            if (quantity > 0) plan.Add((source, quantity));
            remaining -= quantity;
            if (remaining == 0) break;
        }
        if (remaining != 0 || plan.Count == 0)
            throw new RuleException("Insufficient available stock at this depot; refresh stock and try again.");
        return plan;
    }

    private static Guid AllocationPartId(Guid operationId, Guid resourceId)
    {
        Span<byte> input = stackalloc byte[32];
        operationId.TryWriteBytes(input);
        resourceId.TryWriteBytes(input[16..]);
        // The first allocation uses the operation ID. Additional rows get stable IDs for retries.
        return new Guid(SHA256.HashData(input).AsSpan(0, 16));
    }

    public Task<ResourceAllocation> UpdateAllocation(Guid id, string action, CancellationToken ct, string? reason = null, DeliveryInput? delivery = null) => store.TransactionAsync(async () =>
    {
        var a = await store.FindAsync<ResourceAllocation>(id, ct) ?? throw new MissingException();
        var r = await access.Request(a.RequestId, LogisticsRoles, ct);
        var resource = await store.FindAsync<Resource>(a.ResourceId, ct) ?? throw new MissingException();
        await access.RequireLocation(resource.OrganisationId, resource.CountryCode, LogisticsRoles, ct, r.CrisisId);
        await access.RequireDepot(resource, ct, r.CrisisId);
        if (resource.CountryCode != await CrisisCountry(r.CrisisId, ct)) throw new AccessDeniedException();
        if (a.CaseDispatchId != null || r.RequiresCentreHandover && a.Status == AllocationStatus.Reserved && action == "Dispatch")
            throw new RuleException("Use the case dispatch workflow for these items.");
        if (action == "Deliver" && a.Status is AllocationStatus.Delivered or AllocationStatus.DeliveryException)
            return a;
        if (reason != null && (action, a.Status) is ("Dispatch", AllocationStatus.Dispatched) or
            ("Cancel", AllocationStatus.Cancelled))
            return a;
        if (action is "Dispatch" or "Deliver" && (a.NeedId == null && r.UnitRequiresClarification || a.RequestQuantity == null))
            throw new RuleException("Confirm the historical request unit before dispatching or confirming delivery.");
        var previousStatus = r.Status;
        var quantity = a.Quantity;
        DeliveryConfirmation? receipt = null;
        if (action == "Dispatch" && a.Status == AllocationStatus.Reserved)
        {
            if (r.RequiresCoordinatorAuthorization && (r.AuthorizedAt == null || a.PackedAt == null))
                throw new RuleException("Authorize the case and confirm packing before dispatch.");
            resource.Dispatch(a.Quantity);
            a.Status = AllocationStatus.Dispatched;
        }
        else if (action == "Deliver" && a.Status == AllocationStatus.Dispatched)
        {
            receipt = DeliveryReceipts.Create(delivery, a.Quantity, resource.Unit, a.UpdatedAt, access.UserId);
            receipt.AllocationId = a.Id;
            quantity = receipt.ConfirmedQuantity;
            if (quantity > 0 && a.NeedId is Guid needId)
            {
                var need = await store.FindAsync<CaseNeed>(needId, ct) ?? throw new MissingException();
                var delivered = QuantityUnits.Convert(quantity, resource.Unit, need.Unit);
                if (need.DeliveredQuantity + delivered > need.ApprovedQuantity) throw new RuleException("Delivery exceeds the approved item quantity.");
                need.DeliveredQuantity += delivered;
                var otherNeeds = await store.ListAsync(store.Query<CaseNeed>().Where(n => n.RequestId == r.Id && n.Id != need.Id), ct);
                r.Status = need.DeliveredQuantity == need.ApprovedQuantity && otherNeeds.All(n => n.DeliveredQuantity == n.ApprovedQuantity)
                    ? RequestStatus.Fulfilled : RequestStatus.PartiallyFulfilled;
                r.UpdatedAt = DateTimeOffset.UtcNow;
            }
            else if (quantity > 0) r.Deliver(QuantityUnits.Convert(quantity, resource.Unit, r.Unit));
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
        var reference = string.IsNullOrEmpty(a.Reference) ? $"DSP-{a.Id.ToString("N")[..12].ToUpperInvariant()}" : a.Reference;
        var unit = QuantityUnits.Normalize(resource.Unit) switch { "l" => "L", "ml" => "mL", var code => code };
        var amount = $"{quantity:0.#####} {unit}";
        var depot = action == "Cancel" && resource.DepotId is Guid depotId ? await store.FindAsync<Depot>(depotId, ct) : null;
        var message = action == "Cancel" ? $"Released {amount} of {resource.Name} back to {depot?.Name ?? resource.LocationText}. Shipment {reference}." :
            receipt is null ? $"Dispatched {amount} of {resource.Name}. Shipment {reference}." :
            quantity == 0 ? "Delivery attempt recorded. No aid was received and the case remains open." :
            receipt.ExceptionDetail.Length > 0 ? $"Delivery confirmed for {quantity} {resource.Unit}. A delivery exception was recorded." :
            $"Delivery confirmed for {quantity} {resource.Unit}.";
        await RecordChange(r, message, ct, previousStatus, dispatchUpdate: true, allocationId: a.Id, depotId: resource.DepotId);
        Audit("Allocation" + action, a, reason ?? "", resource.CountryCode);
        if (receipt?.ExceptionDetail.Length > 0) Audit("DeliveryException", a, "See the delivery confirmation for details.", resource.CountryCode);
        return a;
    }, ct);

    public async Task<DeliveryConfirmation> AllocationReceipt(Guid id, CancellationToken ct)
    {
        var allocation = await store.FindAsync<ResourceAllocation>(id, ct) ?? throw new MissingException();
        var request = await access.Request(allocation.RequestId, LogisticsReaders, ct);
        var resource = await store.FindAsync<Resource>(allocation.ResourceId, ct) ?? throw new MissingException();
        await access.RequireLocation(resource.OrganisationId, resource.CountryCode, LogisticsReaders, ct, request.CrisisId);
        await access.RequireDepot(resource, ct, request.CrisisId, allowCoordinatorRead: true);
        return (await store.ListAsync(store.Query<DeliveryConfirmation>().Where(x => x.AllocationId == id), ct)).SingleOrDefault()
            ?? throw new MissingException();
    }
    public Task<Shelter> SaveShelter(Guid? id, ShelterInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        if (access.SelectedCountry is { } selected && selected != input.CountryCode)
            throw new AccessDeniedException();
        await access.RequireLocation(input.OrganisationId, input.CountryCode, ShelterRoles, ct);
        if (string.IsNullOrWhiteSpace(input.Name) || string.IsNullOrWhiteSpace(input.Address) ||
            !double.IsFinite(input.Latitude) || !double.IsFinite(input.Longitude))
            throw new RuleException("Enter a shelter name, address and valid coordinates.");
        if ((input.RegistrationId.HasValue && input.AdministrativeDivisionId == null) ||
            (input.AdministrativeDivisionId is Guid divisionId &&
             (await store.FindAsync<AdministrativeDivision>(divisionId, ct))?.CountryCode != input.CountryCode))
            throw new RuleException("Choose an administrative division in the shelter country.");
        if (id == null)
        {
            if (input.RegistrationId.HasValue && input.Address.Trim().Length > 500)
                throw new RuleException("Keep the shelter address within 500 characters.");
            await access.RequirePartner(input.OrganisationId, input.CountryCode, ct);
            if (input.RegistrationId == Guid.Empty) throw new RuleException("Invalid registration reference.");
            if (input.RegistrationId is Guid registrationId &&
                await store.FindAsync<Shelter>(registrationId, ct) is { } registered)
            {
                var createdByCaller = await store.ListAsync(store.Query<AuditEvent>().Where(a =>
                    a.EntityId == registrationId && a.EntityType == nameof(Shelter) &&
                    a.ActorId == access.UserId && a.Action == "ShelterCreated").OrderBy(a => a.Id).Take(1), ct);
                if (registered.CountryCode != input.CountryCode || registered.OrganisationId != input.OrganisationId ||
                    createdByCaller.Count == 0) throw new AccessDeniedException();
                return registered;
            }
        }
        var shelter = id.HasValue ? await store.FindAsync<Shelter>(id.Value, ct) ?? throw new MissingException() :
            new Shelter { Id = input.RegistrationId ?? Guid.NewGuid(), CountryCode = input.CountryCode, OrganisationId = input.OrganisationId };
        if (shelter.OrganisationId != input.OrganisationId || shelter.CountryCode != input.CountryCode)
            throw new AccessDeniedException();
        if (input.Capacity < shelter.Occupancy + shelter.Reserved)
            throw new RuleException("Capacity cannot be below active reservations and occupancy.");
        if (id.HasValue && input.ExpectedOperationalUpdate is { } expected &&
            expected != (shelter.OperationalUpdatedAt ?? shelter.UpdatedAt))
            throw new RuleException("Another staff member updated this shelter. Reopen the editor and review the latest report.");
        var oldCapacity = shelter.Capacity;
        var wasOpen = shelter.Open;
        var wasPending = shelter.PendingVerification;
        if (id == null)
        {
            // Shelters registered by operational staff require a readiness check before opening.
            shelter.PendingVerification = input.RegistrationId.HasValue || access.IsShelterWorkspace ||
                !await access.CountryAccess(input.CountryCode, [], ct);
        }
        else if (input.VerifyOperations)
        {
            await access.RequirePartner(shelter.OrganisationId, shelter.CountryCode, ct);
            shelter.PendingVerification = false;
        }
        else if (shelter.PendingVerification && input.Open)
            throw new RuleException("Confirm the operational assessment before opening this shelter.");

        shelter.Name = input.Name.Trim();
        shelter.AdministrativeDivisionId = input.AdministrativeDivisionId;
        shelter.Address = input.Address.Trim();
        shelter.Latitude = input.Latitude;
        shelter.Longitude = input.Longitude;
        shelter.Capacity = input.Capacity;
        shelter.Accessible = input.Accessible;
        shelter.Open = input.Open && !shelter.PendingVerification;
        shelter.Facilities = input.Facilities;
        shelter.OperationalUpdatedAt = DateTimeOffset.UtcNow;
        if (!id.HasValue)
            store.Add(shelter);
        Audit(id.HasValue ? "ShelterUpdated" : "ShelterCreated", shelter);
        if (id.HasValue && oldCapacity != shelter.Capacity)
            Audit("ShelterCapacityChanged", shelter, $"{oldCapacity} → {shelter.Capacity} spaces");
        if (id.HasValue && wasPending && !shelter.PendingVerification)
            Audit("ShelterOperationsVerified", shelter);
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
        if (access.IsShelterWorkspace && r.OrganisationId != shelter.OrganisationId)
            throw new AccessDeniedException();
        var crisis = await store.FindAsync<Crisis>(r.CrisisId, ct) ?? throw new MissingException();
        if (shelter.CountryCode != crisis.CountryCode)
            throw new RuleException("A shelter must be in the same country as the crisis.");
        if (r.AccessibilityNeeds.Length > 0 && !shelter.Accessible)
            throw new RuleException("This household requires an accessible shelter.");
        var previousStatus = r.Status;
        await access.RequirePartner(shelter.OrganisationId, shelter.CountryCode, ct);
        if (!shelterPolicy.AcceptsPlacements(shelter))
            throw new RuleException("Confirm the shelter's operational readiness before reserving spaces.");
        shelter.OperationalUpdatedAt ??= shelter.UpdatedAt;
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
        shelter.OperationalUpdatedAt ??= shelter.UpdatedAt;
        if (action == "CheckIn" && stay.Status == StayStatus.Reserved)
        {
            if (!shelter.Open || shelter.PendingVerification)
                throw new RuleException("Reopen the shelter or move this reservation before checking in the household.");
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
        var country = access.IsVolunteerWorkspace ? await access.VolunteerWorkspaceCountry(ct) : access.SelectedCountry;
        if (access.IsVolunteerWorkspace) scopeRole = Roles.VolunteerCoordinator;
        if (access.IsCoordinatorWorkspace)
        {
            country = await access.CoordinatorCountry(ct);
            scopeRole = Roles.Coordinator;
        }
        var global = scopeRole == null && await access.IsAdmin(ct);
        var grants = store.Query<Membership>().Where(m => m.UserId == access.UserId);
        if (scopeRole != null) grants = grants.Where(m => m.Role == scopeRole);
        if (access.IsCoordinatorWorkspace) grants = access.CoordinatorOrganisationGrants(country!);
        var q = store.Query<VolunteerProfile>().Where(x => country == null || x.CountryCode == country)
            .Where(x => global || grants.Any(m => m.CountryCode == x.CountryCode &&
                (m.Role == Roles.CountryAdministrator || m.OrganisationId == x.OrganisationId &&
                    (VolunteerReaders.Contains(m.Role) || x.UserId == access.UserId && m.Role == Roles.Volunteer)) &&
                (x.TaskRequestId == null || m.CrisisId == null || store.Query<AssistanceRequest>().Any(r =>
                    r.Id == x.TaskRequestId && r.CrisisId == m.CrisisId))));
        var profiles = await store.ListAsync(q, ct);
        var tasks = await store.ListAsync((from task in store.Query<VolunteerTask>()
            join volunteer in q on task.VolunteerId equals volunteer.Id
            join request in store.Query<AssistanceRequest>() on task.RequestId equals request.Id
            join crisis in store.Query<Crisis>() on request.CrisisId equals crisis.Id
            where crisis.CountryCode == volunteer.CountryCode && (global || grants.Any(m =>
                m.CountryCode == crisis.CountryCode && (m.CrisisId == null || m.CrisisId == crisis.Id) &&
                (m.Role == Roles.CountryAdministrator || m.OrganisationId == volunteer.OrganisationId &&
                    (m.Role == Roles.VolunteerCoordinator && m.OrganisationId == request.OrganisationId ||
                     m.Role == Roles.Coordinator && store.Query<CrisisAssignment>().Any(a => a.CrisisId == crisis.Id && a.UserId == access.UserId)
                     || m.Role == Roles.Volunteer && volunteer.UserId == access.UserId))))
            orderby task.DueAt
            select task), ct);
        var ids = tasks.Select(t => t.Id).ToArray();
        var history = await store.ListAsync(store.Query<VolunteerTaskEvent>().Where(e => ids.Contains(e.TaskId)).OrderBy(e => e.CreatedAt), ct);
        return new(profiles, tasks, history);
    }

    public async Task<(Dictionary<string, int> Metrics, Guid[] Available, Guid[] Committed, Guid[] Overdue)> VolunteerMetrics(
        VolunteerRoster roster, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var profileIds = roster.Profiles.Select(v => v.Id).ToArray();
        var commitments = await store.ListAsync(store.Query<VolunteerTask>().Where(t => profileIds.Contains(t.VolunteerId) &&
            ScheduledTasks.Contains(t.Status)), ct);
        var committed = commitments.Where(t => t.Status == VolunteerTaskStatus.InProgress ||
            Overlaps(t, now, now.AddTicks(1))).Select(t => t.VolunteerId).Distinct().ToArray();
        var members = await store.ListAsync(store.Query<Membership>().Where(m => m.Role == Roles.Volunteer &&
            store.Query<VolunteerProfile>().Any(v => profileIds.Contains(v.Id) && v.UserId == m.UserId &&
                v.OrganisationId == m.OrganisationId && v.CountryCode == m.CountryCode)), ct);
        var assigned = roster.Tasks.Where(t => t.Status != VolunteerTaskStatus.Declined).Select(t => t.VolunteerId).ToHashSet();
        var available = roster.Profiles.Where(v => v.Verified && v.Available && !committed.Contains(v.Id) &&
            (v.TaskRequestId == null || !assigned.Contains(v.Id)) &&
            members.Any(m => m.UserId == v.UserId && m.OrganisationId == v.OrganisationId && m.CountryCode == v.CountryCode))
            .Select(v => v.Id).ToArray();
        var overdue = roster.Tasks.Where(t => (ScheduledTasks.Contains(t.Status) || t.Status == VolunteerTaskStatus.Returned) &&
            t.DueAt < now).Select(t => t.Id).ToArray();
        return (new Dictionary<string, int>
        {
            ["verified"] = roster.Profiles.Count(v => v.Verified),
            ["available"] = available.Length,
            ["open"] = roster.Tasks.Count(t => OpenTasks.Contains(t.Status)),
            ["deployments"] = roster.Tasks.Count(t => t.Status == VolunteerTaskStatus.InProgress),
            ["reports"] = roster.Tasks.Count(t => t.Status == VolunteerTaskStatus.AwaitingVerification),
            ["overdue"] = overdue.Length
        }, available, committed, overdue);
    }
    public Task<VolunteerProfile> SaveVolunteer(VolunteerProfile input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var existing = (await store.ListAsync(store.Query<VolunteerProfile>().Where(x => x.UserId == input.UserId), ct)).SingleOrDefault();
        if (existing is not null && (existing.OrganisationId != input.OrganisationId || existing.CountryCode != input.CountryCode))
            throw new AccessDeniedException();
        var crisisId = existing is null ? null : await VolunteerScopeCrisis(existing, ct);
        await access.RequireLocation(input.OrganisationId, input.CountryCode, VolunteerRoles, ct, crisisId);
        if (!(await store.ListAsync(store.Query<Membership>().Where(x => x.UserId == input.UserId && x.OrganisationId == input.OrganisationId &&
            x.CountryCode == input.CountryCode && (x.CrisisId == null || x.CrisisId == crisisId) && x.Role == Roles.Volunteer)
            .OrderBy(x => x.Id).Take(1), ct)).Any())
            throw new RuleException("An active volunteer membership is required for this profile.");
        var requiresSchedule = existing?.TaskRequestId is null;
        if (input.Skills.Length > 1000 || input.Availability.Length > 500 ||
            access.IsVolunteerWorkspace && (input.Skills.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Length == 0 ||
                requiresSchedule && string.IsNullOrWhiteSpace(input.Availability)))
            throw new RuleException(requiresSchedule
                ? "Enter at least one skill and an availability schedule within the field limits."
                : "Enter at least one skill and keep the profile fields within their limits.");
        if (access.IsVolunteerWorkspace && input.ServiceRegionId is Guid region &&
            (await store.FindAsync<AdministrativeDivision>(region, ct))?.CountryCode != input.CountryCode)
            throw new RuleException("Choose a deployment area in the same country.");
        var v = existing ?? new VolunteerProfile { CountryCode = input.CountryCode, UserId = input.UserId, OrganisationId = input.OrganisationId };
        v.Skills = input.Skills.Trim();
        v.Availability = input.Availability.Trim();
        if (access.IsVolunteerWorkspace)
        {
            if (v.ServiceRegionId != input.ServiceRegionId)
            {
                v.ServiceLatitude = null;
                v.ServiceLongitude = null;
                v.ServiceLocationConsent = false;
            }
            v.ServiceRegionId = input.ServiceRegionId;
        }
        else if (v.Verified != input.Verified)
        {
            v.Verified = input.Verified;
            Audit(v.Verified ? "VolunteerVerified" : "VolunteerVerificationRemoved", v);
        }
        v.Available = input.Available;
        if (existing is null)
            store.Add(v);
        Audit("VolunteerSaved", v);
        return v;
    }, ct);

    public Task<VolunteerProfile> VerifyVolunteer(Guid id, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var profile = await store.FindAsync<VolunteerProfile>(id, ct) ?? throw new MissingException();
        var crisisId = await VolunteerScopeCrisis(profile, ct);
        await access.RequireLocation(profile.OrganisationId, profile.CountryCode, VolunteerRoles, ct, crisisId);
        if (profile.UserId == access.UserId) throw new AccessDeniedException();
        if (profile.Verified) throw new RuleException("This volunteer is already verified.");
        if (string.IsNullOrWhiteSpace(profile.Skills) || !(await store.ListAsync(store.Query<Membership>().Where(m =>
            m.UserId == profile.UserId && m.Role == Roles.Volunteer && m.OrganisationId == profile.OrganisationId &&
            m.CountryCode == profile.CountryCode && (m.CrisisId == null || m.CrisisId == crisisId))
            .OrderBy(m => m.Id).Take(1), ct)).Any())
            throw new RuleException("The volunteer needs recorded skills and a current volunteer membership.");
        profile.Verified = true;
        Audit("VolunteerVerified", profile);
        return profile;
    }, ct);

    public async Task<List<VolunteerCase>> VolunteerCases(string? search, CancellationToken ct, bool unassigned = false, Guid? requestId = null)
    {
        var cases = (await access.Visible(ct)).Where(r => r.OrganisationId != null &&
            ActiveFulfilment.Contains(r.Status) && (r.RequiresCentreHandover
                ? store.Query<CaseDispatch>().Any(d => d.RequestId == r.Id && d.ReceivedAt != null
                    && store.Query<ResourceAllocation>().Any(a => a.CaseDispatchId == d.Id && a.Status == AllocationStatus.Dispatched)
                    && !store.Query<VolunteerTask>().Any(t => t.CaseDispatchId == d.Id && OpenTasks.Contains(t.Status)))
                : r.DeliveredQuantity < r.Quantity) &&
            store.Query<OrganisationCountry>().Any(o => o.OrganisationId == r.OrganisationId &&
                (o.VerificationState == "Verified" || o.VerificationState == "LegacyActive") &&
                store.Query<Crisis>().Any(c => c.Id == r.CrisisId && c.CountryCode == o.CountryCode)));
        if (!access.IsVolunteerWorkspace && !await access.IsAdmin(ct))
        {
            var grants = store.Query<Membership>().Where(m => m.UserId == access.UserId &&
                (VolunteerRoles.Contains(m.Role) || m.Role == Roles.CountryAdministrator));
            cases = cases.Where(r => grants.Any(m => (m.CrisisId == null || m.CrisisId == r.CrisisId)
                && (m.OrganisationId == r.OrganisationId || m.Role == Roles.CountryAdministrator)
                && store.Query<Crisis>().Any(c => c.Id == r.CrisisId && c.CountryCode == m.CountryCode)));
        }
        if (requestId.HasValue) cases = cases.Where(r => r.Id == requestId);
        if (unassigned) cases = cases.Where(r => r.RequiresCentreHandover ||
            !store.Query<VolunteerTask>().Any(t => t.RequestId == r.Id && OpenTasks.Contains(t.Status)));
        var crises = store.Query<Crisis>();
        var query = from r in cases
                    join c in crises on r.CrisisId equals c.Id
                    select new { Request = r, Crisis = c.Name };
        if (!string.IsNullOrWhiteSpace(search))
        {
            search = search.Trim();
            var categories = Enum.GetValues<AidCategory>().Where(c => c.ToString().Contains(search, StringComparison.OrdinalIgnoreCase)).ToArray();
            query = query.Where(row => row.Request.Reference.Contains(search) || (row.Request.LegacyReference != null && row.Request.LegacyReference.Contains(search)) ||
                row.Request.LocationText.Contains(search) || row.Request.Description.Contains(search) ||
                row.Crisis.Contains(search) || categories.Contains(row.Request.Category));
        }
        var results = await store.ListAsync(query.OrderByDescending(row => row.Request.CreatedAt).ThenBy(row => row.Request.Id).Take(20)
            .Select(row => new { row.Request.Id, row.Request.Reference, row.Request.LocationText, row.Request.OrganisationId,
                row.Crisis, row.Request.Category, row.Request.Priority, row.Request.Description,
                Outstanding = row.Request.Quantity - row.Request.DeliveredQuantity, row.Request.Unit,
                row.Request.RequiresCentreHandover, row.Request.AdministrativeDivisionId }), ct);
        return results.Select(row => new VolunteerCase(row.Id, row.Reference, row.LocationText, row.OrganisationId!.Value,
            row.Crisis, row.Category.ToString(), row.Priority.ToString(), row.Description, row.Outstanding, row.Unit,
            row.RequiresCentreHandover, row.AdministrativeDivisionId)).ToList();
    }

    public async Task<List<VolunteerCandidate>> VolunteerRecommendations(Guid requestId, DateTimeOffset startsAt, DateTimeOffset dueAt,
        string? requiredSkill, CancellationToken ct, Guid? dispatchId = null)
    {
        var request = await access.Request(requestId, VolunteerRoles, ct);
        var country = await CrisisCountry(request.CrisisId, ct);
        if (!request.OrganisationId.HasValue || !ActiveFulfilment.Contains(request.Status) ||
            !request.RequiresCentreHandover && request.DeliveredQuantity >= request.Quantity) return [];
        await access.RequireLocation(request.OrganisationId.Value, country, VolunteerRoles, ct, request.CrisisId);
        await access.RequirePartner(request.OrganisationId.Value, country, ct);
        ValidateWindow(startsAt, dueAt);
        if (dispatchId.HasValue) await RequireAvailableHandover(request, dispatchId.Value, ct);
        var memberships = store.Query<Membership>().Where(m => m.Role == Roles.Volunteer && m.OrganisationId == request.OrganisationId &&
            m.CountryCode == country && (m.CrisisId == null || m.CrisisId == request.CrisisId));
        var eligible = await store.ListAsync(store.Query<VolunteerProfile>().Where(v => v.Verified && v.Available &&
            v.OrganisationId == request.OrganisationId && v.CountryCode == country && memberships.Any(m => m.UserId == v.UserId) &&
            (v.TaskRequestId == null || v.TaskRequestId == requestId && v.TaskDispatchId == dispatchId &&
                !store.Query<VolunteerTask>().Any(t => t.VolunteerId == v.Id && t.Status != VolunteerTaskStatus.Declined))), ct);
        if (eligible.Count == 0) return [];
        var skill = requiredSkill?.Trim() ?? "";
        var regions = await CaseRegions(request, country, ct);
        var userIds = eligible.Select(v => v.UserId).Distinct().ToArray();
        var availability = (await store.ListAsync(store.Query<VolunteerAvailabilityWindow>()
            .Where(w => userIds.Contains(w.UserId) && w.EndsAt > DateTimeOffset.UtcNow), ct)).ToLookup(w => w.UserId);
        var candidates = new List<VolunteerCandidate>();
        foreach (var v in eligible.Where(v => HasSkill(v, skill) && (v.ServiceRegionId == null || regions.Contains(v.ServiceRegionId.Value))))
        {
            var windows = availability[v.UserId];
            if (!VolunteerAvailability.Covers(windows, startsAt, dueAt)) continue;
            var commitments = await OpenVolunteerCommitments(v.UserId, ct);
            if (commitments.Any(t => t.VolunteerId == v.Id && t.RequestId == request.Id || Overlaps(t, startsAt, dueAt))) continue;
            double? km = v.ServiceLocationConsent && v.ServiceLatitude is double a && v.ServiceLongitude is double b &&
                request.Latitude is double c && request.Longitude is double d ? Math.Round(RankedAllocationStrategy.Distance(a, b, c, d)) : null;
            var open = commitments.Count(t => t.VolunteerId == v.Id);
            var score = 50 + (skill.Length > 0 ? 20 : 0) + (v.ServiceRegionId != null ? 10 : 0) +
                (km.HasValue ? 10 / (1 + km.Value / 15) : 0) + 10d / (1 + open);
            var reason = "Verified, available and free of recorded conflicts. " +
                (skill.Length > 0 ? $"Verified skill: {skill}. " : "") +
                (v.ServiceRegionId.HasValue ? "Declared service area covers this case. " : "Organisation-wide service area. ") +
                (km.HasValue ? $"About {km:0} km from the volunteer's shared service point. " : "") +
                $"{open} other open commitments. " + (windows.Any() ? "Within a saved availability window." : "No upcoming availability windows recorded.");
            candidates.Add(new(v.Id, v.Skills, v.Availability, open, reason, Math.Round(score, 1), km));
        }
        return candidates.OrderByDescending(c => c.Score).ThenBy(c => c.OpenCommitments).ThenBy(c => c.Id).ToList();
    }

    public async Task<AiDraft?> VolunteerSkill(VolunteerSkillInput input, CancellationToken ct)
    {
        var request = await access.Request(input.RequestId, VolunteerRoles, ct);
        if (!request.OrganisationId.HasValue || !ActiveFulfilment.Contains(request.Status)) return null;
        var country = await CrisisCountry(request.CrisisId, ct);
        await access.RequireLocation(request.OrganisationId.Value, country, VolunteerRoles, ct, request.CrisisId);
        await access.RequirePartner(request.OrganisationId.Value, country, ct);
        var grants = store.Query<Membership>().Where(m => m.Role == Roles.Volunteer && m.CountryCode == country &&
            m.OrganisationId == request.OrganisationId && (m.CrisisId == null || m.CrisisId == request.CrisisId));
        var skills = (await store.ListAsync(store.Query<VolunteerProfile>().Where(v => v.Verified && v.Available &&
            v.CountryCode == country && v.OrganisationId == request.OrganisationId && grants.Any(m => m.UserId == v.UserId)).Select(v => v.Skills), ct))
            .SelectMany(s => s.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
            .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var result = await ai.ExtractTaskSkillAsync(input.Title, skills, ct);
        var suggested = result is null ? null : skills.FirstOrDefault(s => RequestSignals.Local(s).Contains(result.Text, StringComparer.OrdinalIgnoreCase));
        if (suggested is not null) return result! with { Text = suggested };
        var local = RequestSignals.Local(input.Title);
        var fallback = skills.FirstOrDefault(s => RequestSignals.Local(s).Intersect(local).Any());
        return fallback is null ? null : new AiDraft(fallback, "Deterministic fallback · roster skill keywords");
    }

    private async Task<HashSet<Guid>> CaseRegions(AssistanceRequest request, string country, CancellationToken ct)
    {
        var regions = new HashSet<Guid>();
        var current = request.AdministrativeDivisionId;
        while (current is Guid id && regions.Add(id))
        {
            var region = await store.FindAsync<AdministrativeDivision>(id, ct);
            current = region?.CountryCode == country ? region.ParentId : null;
        }
        return regions;
    }

    public Task<VolunteerTask> AssignTask(TaskInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var request = await access.Request(input.RequestId, VolunteerRoles, ct);
        if (!ActiveFulfilment.Contains(request.Status) || !request.RequiresCentreHandover && request.DeliveredQuantity >= request.Quantity)
            throw new RuleException("Assign tasks only to approved or active cases with outstanding assistance.");
        if (input.CaseDispatchId is Guid dispatchId)
            await RequireAvailableHandover(request, dispatchId, ct);
        else if (request.RequiresCentreHandover)
            throw new RuleException("Select a dispatch that the centre has received.");
        var v = await store.FindAsync<VolunteerProfile>(input.VolunteerId, ct) ?? throw new MissingException();
        await access.RequireLocation(v.OrganisationId, v.CountryCode, VolunteerRoles, ct, request.CrisisId);
        if ((await store.FindAsync<Crisis>(request.CrisisId, ct))?.CountryCode != v.CountryCode) throw new RuleException("Volunteer and crisis countries must match.");
        if (v.OrganisationId != request.OrganisationId) throw new RuleException("Choose a volunteer from the organisation assigned to this case.");
        if (v.TaskRequestId != null && (v.TaskRequestId != request.Id || v.TaskDispatchId != input.CaseDispatchId ||
            (await store.ListAsync(store.Query<VolunteerTask>().Where(t => t.VolunteerId == v.Id && t.Status != VolunteerTaskStatus.Declined)
                .OrderBy(t => t.Id).Take(1), ct)).Any()))
            throw new RuleException("This volunteer can be assigned once to the case and dispatch they were registered for.");
        await access.RequirePartner(v.OrganisationId, v.CountryCode, ct);
        if (!v.Verified || !v.Available) throw new RuleException("Choose a verified, available volunteer.");
        if (v.ServiceRegionId is Guid region && !(await CaseRegions(request, v.CountryCode, ct)).Contains(region))
            throw new RuleException("This case is outside the volunteer's declared service area.");
        if ((await store.ListAsync(store.Query<Membership>().Where(m => m.UserId == v.UserId && m.Role == Roles.Volunteer
            && m.OrganisationId == v.OrganisationId && m.CountryCode == v.CountryCode && (m.CrisisId == null || m.CrisisId == request.CrisisId)), ct)).Count == 0)
            throw new RuleException("This volunteer no longer has a membership for the case.");
        var skill = (input.RequiredSkill ?? "").Trim();
        if (string.IsNullOrWhiteSpace(input.Title)) throw new RuleException("Enter a task title.");
        if (!HasSkill(v, skill))
            throw new RuleException("The volunteer does not have the required skill.");
        var startsAt = input.StartsAt ?? DateTimeOffset.UtcNow;
        ValidateWindow(startsAt, input.DueAt);
        var availability = await store.ListAsync(store.Query<VolunteerAvailabilityWindow>()
            .Where(w => w.UserId == v.UserId && w.EndsAt > DateTimeOffset.UtcNow), ct);
        if (!VolunteerAvailability.Covers(availability, startsAt, input.DueAt))
            throw new RuleException("Choose a task window within the volunteer’s recorded availability.");
        var commitments = await OpenVolunteerCommitments(v.UserId, ct);
        if (commitments.Any(t => t.VolunteerId == v.Id && t.RequestId == request.Id))
            throw new RuleException("This volunteer already has an open assignment for this case.");
        if (commitments.Any(t => Overlaps(t, startsAt, input.DueAt)))
            throw new RuleException("The volunteer has another assignment that overlaps this scheduled window.");
        var task = new VolunteerTask { RequestId = input.RequestId, VolunteerId = v.Id, Title = input.Title.Trim(),
            CaseDispatchId = input.CaseDispatchId,
            RequiredSkill = skill, StartsAt = startsAt, DueAt = input.DueAt, Instructions = input.Instructions?.Trim() ?? "" };
        store.Add(task);
        store.Add(new VolunteerTaskEvent { TaskId = task.Id, Action = "Assign", ActorId = access.UserId });
        Audit("VolunteerAssigned", task, countryCode: v.CountryCode);
        notifications.TaskAssigned(task, v, request);
        return task;
    }, ct);
    private Task<List<VolunteerTask>> OpenVolunteerCommitments(string userId, CancellationToken ct)
    {
        var profiles = store.Query<VolunteerProfile>().Where(v => v.UserId == userId);
        return store.ListAsync(store.Query<VolunteerTask>().Where(t => OpenTasks.Contains(t.Status) && profiles.Any(v => v.Id == t.VolunteerId)), ct);
    }
    private static bool HasSkill(VolunteerProfile volunteer, string skill)
    {
        var recorded = volunteer.Skills.Split(',', StringSplitOptions.TrimEntries).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return skill.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).All(recorded.Contains);
    }
    private static bool Overlaps(VolunteerTask task, DateTimeOffset startsAt, DateTimeOffset dueAt)
    {
        var windowStart = task.StartsAt ?? task.CreatedAt;
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
        string? handoverReport = null;
        if (input.Action is "Verify" or "Return")
        {
            await access.RequireLocation(v.OrganisationId, v.CountryCode, VolunteerRoles, ct, request.CrisisId);
            await access.Request(task.RequestId, VolunteerRoles, ct);
            if (v.UserId == access.UserId) throw new AccessDeniedException();
            if (task.Status != VolunteerTaskStatus.AwaitingVerification)
                throw new RuleException("Task is not ready for verification.");
            if (note.Length < 5) throw new RuleException("Record the reason for returning or verifying this report.");
            if (input.Action == "Verify" && (await store.ListAsync(store.Query<VolunteerTaskEvent>()
                .Where(e => e.TaskId == id && e.Action == "Complete").OrderBy(e => e.Id).Take(1), ct)).Count == 0)
                throw new RuleException("Return this task to request a completion report before verifying.");
            if (input.Action == "Verify" && task.CaseDispatchId is Guid dispatchId)
                await VerifyHandover(task, request, dispatchId, ct);
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
            if (input.Action == "Progress" && note.Length < 5)
                throw new RuleException("Enter a progress update of at least 5 characters.");
            task.Status = (input.Action, task.Status) switch
            {
                ("Accept", VolunteerTaskStatus.Assigned) => VolunteerTaskStatus.Accepted,
                ("Decline", VolunteerTaskStatus.Assigned) => VolunteerTaskStatus.Declined,
                ("Start", VolunteerTaskStatus.Accepted) => VolunteerTaskStatus.InProgress,
                ("Progress", VolunteerTaskStatus.InProgress) => VolunteerTaskStatus.InProgress,
                ("Complete", VolunteerTaskStatus.InProgress or VolunteerTaskStatus.Returned) => VolunteerTaskStatus.AwaitingVerification,
                _ => throw new RuleException("Invalid task action.")
            };
            if (input.Action == "Complete" && task.CaseDispatchId is Guid dispatchId)
                handoverReport = await PrepareHandoverReport(dispatchId, input.HandoverQuantities, input.Issues, ct);
        }
        task.Note = note;
        store.Add(new VolunteerTaskEvent
        {
            TaskId = id, ActorId = access.UserId, Action = input.Action, Note = note,
            WorkDescription = input.Action == "Complete" ? description : "",
            Outcome = input.Action == "Complete" ? outcome : "",
            PeopleAssisted = input.Action == "Complete" ? input.PeopleAssisted : null,
            Issues = input.Action == "Complete" ? input.Issues?.Trim() ?? "" : "",
            HandoverQuantitiesJson = handoverReport,
        });
        Audit("VolunteerTask" + input.Action, task, countryCode: country);
        if (input.Action == "Complete") await notifications.TaskSubmitted(task, v, request, ct);
        return task;
    }, ct);
    public Task<Feedback> Feedback(Guid id, FeedbackInput input, CancellationToken ct) => store.FeedbackTransactionAsync(id, async () =>
    {
        var r = await access.Request(id, ct: ct);
        if (r.CitizenId != access.UserId)
            throw new AccessDeniedException();
        var existing = (await store.ListAsync(store.Query<Feedback>().Where(f => f.RequestId == id && f.UserId == access.UserId && !f.IsSuperseded), ct)).SingleOrDefault();
        if (existing is not null)
            return existing;
        if (r.Status is not (RequestStatus.PartiallyFulfilled or RequestStatus.Fulfilled or RequestStatus.Closed))
            throw new AccessDeniedException();
        var feedback = new Feedback { RequestId = id, UserId = access.UserId, Rating = input.Rating, Received = input.Received, Problem = input.Problem, Comment = input.Comment };
        store.Add(feedback);
        if (input.Problem)
            r.Escalated = true;
        Audit("FeedbackRecorded", r, countryCode: await CrisisCountry(r.CrisisId, ct));
        return feedback;
    }, ct);
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
        var stock = await store.ListAsync((await access.Located<Resource>(ct)).GroupBy(x => new { x.Category, x.Unit })
            .Select(g => new { g.Key.Category, g.Key.Unit, Stock = g.Sum(x => x.Stock), Reserved = g.Sum(x => x.Reserved) }), ct);
        var stockByUnit = stock.Where(r => !string.IsNullOrWhiteSpace(r.Unit)).GroupBy(r => (r.Category, Unit: QuantityUnits.BaseUnit(r.Unit)))
            .Select(g => new { g.Key.Category, g.Key.Unit, Stock = g.Sum(r => QuantityUnits.Convert(r.Stock, r.Unit, g.Key.Unit)),
                Reserved = g.Sum(r => QuantityUnits.Convert(r.Reserved, r.Unit, g.Key.Unit)) }).ToList();
        var singleStockUnit = stockByUnit.Select(r => r.Unit).Distinct().Take(2).Count() <= 1;
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
        var reservations = store.Query<ResourceAllocation>().Where(a => a.Status == AllocationStatus.Reserved || a.Status == AllocationStatus.Dispatched);
        var shortages = await store.ListAsync(ShortageCases(cases).Select(x => new { x.Id, x.Reference, x.Priority,
            Outstanding = x.Quantity - x.DeliveredQuantity - (reservations.Where(a => a.RequestId == x.Id).Sum(a => a.RequestQuantity) ?? 0),
            x.Category, x.Unit }), ct);
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
            ResourceReserved = singleStockUnit ? stockByUnit.Sum(r => r.Reserved) : (decimal?)null,
            ResourceStock = singleStockUnit ? stockByUnit.Sum(r => r.Stock) : (decimal?)null,
            ResourceUnit = singleStockUnit ? stockByUnit.FirstOrDefault()?.Unit : null,
            AiOverrideFrequency = AiDecisionMetrics.OverrideFrequency(modified, rejected, decisions),
            AiApprovedCount = approved, AiModifiedCount = modified, AiRejectedCount = rejected, AiDeferredCount = deferred,
            ByStatus = statuses.Select(x => new { Status = x.Status.ToString(), x.Count }),
            Shortages = shortages
        };
    }
}
