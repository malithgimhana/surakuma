using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Api.Controllers;

[ApiController, Authorize, Route("api/v1/logistics")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class LogisticsController(CrisisDbContext db, IStore store, AccessService access, Operations operations,
    InternalNotifications notifications) : ControllerBase
{
    public sealed record DepotInput(Guid OperationId, string CountryCode, Guid OrganisationId,
        [Required, MaxLength(120)] string Name, [Required, MaxLength(240)] string Location);
    public sealed record StockInput(Guid OperationId, decimal Delta, [Required, MaxLength(1000)] string Reason, string? Movement = null);
    public sealed record ConfigurationInput(Guid? DepotId, [MaxLength(40)] string? Code,
        [Range(typeof(decimal), "0", "10000000")] decimal? LowStockThreshold);
    public sealed record OrderInput(Guid OperationId, LogisticsOrderKind Kind, Guid ResourceId, Guid? DestinationResourceId,
        Guid? CrisisId, Guid? OperationalAreaId, [Range(typeof(decimal), "0.01", "10000000")] decimal Quantity,
        [Required, MaxLength(1000)] string Reason);
    public sealed record ActionInput([MaxLength(1000)] string? Reason = null, DeliveryInput? Delivery = null);
    public sealed record Shipment(Guid Id, LogisticsOrderKind Kind, Guid ResourceId, Guid? DestinationResourceId,
        Guid? CrisisId, string Origin, string Destination, decimal Quantity, AllocationStatus Status,
        string ActorId, string Reason, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, Guid? RequestId,
        DateTimeOffset? DispatchedAt, DateTimeOffset? PackedAt, DateTimeOffset? ScheduledArrivalAt, string Reference,
        Guid? CaseDispatchId, DateTimeOffset? CentreReceivedAt);
    private sealed record StockRow(Guid Id, string Name, string? Code, string CountryCode, Guid? DepotId,
        Guid OrganisationId, AidCategory Category, string Unit, decimal Stock, decimal Reserved, decimal Available,
        string LocationText, decimal? LowStockThreshold, string Suitability, bool TransportAvailable, bool CanShip, string Reference);

    [HttpGet]
    public async Task<object> Dashboard(CancellationToken ct, bool specialist = false)
    {
        var global = !specialist && await access.IsAdmin(ct);
        var grants = await access.Memberships(ct);
        if (specialist && !grants.Any(m => m.Role == Roles.Logistics)) throw new AccessDeniedException();
        var specialistCountry = specialist ? await access.LogisticsCountry(ct) : null;
        var logisticsGrants = db.Set<Membership>().Where(m => m.UserId == access.UserId && m.Role == Roles.Logistics
            && m.CountryCode == specialistCountry);
        var locations = logisticsGrants.Where(m => m.CrisisId == null);
        var allowed = grants.Where(m => m.Role == (specialist ? Roles.Logistics : Roles.CountryAdministrator) && (specialist || m.CrisisId == null)
                && (!specialist || m.CountryCode == specialistCountry))
            .Select(m => m.CountryCode).Distinct().ToArray();
        if (!specialist && !global && allowed.Length == 0) throw new AccessDeniedException();
        var countries = await db.Set<Country>().Where(c => global || allowed.Contains(c.Code)).OrderBy(c => c.Name)
            .Select(c => new { c.Code, c.Name }).ToListAsync(ct);
        var codes = countries.Select(c => c.Code).ToArray();
        var resources = db.Set<Resource>().Where(r => codes.Contains(r.CountryCode));
        if (specialist) resources = resources.Where(r => locations.Any(m => m.OrganisationId == r.OrganisationId && (m.DepotId == null || m.DepotId == r.DepotId)));
        var inventory = await ProjectStock(resources.OrderBy(r => r.Name).ThenBy(r => r.Id)).ToListAsync(ct);
        var caseGrants = logisticsGrants.Where(m => m.CrisisId != null);
        var crisisScoped = db.Set<Resource>().Where(r => r.CountryCode == specialistCountry &&
            !resources.Any(managed => managed.Id == r.Id) &&
            caseGrants.Any(m => m.OrganisationId == r.OrganisationId && (m.DepotId == null || m.DepotId == r.DepotId)));
        var caseInventory = specialist ? await ProjectStock(crisisScoped).ToListAsync(ct) : [];
        var caseStockScope = grants.Where(m => specialist && m.Role == Roles.Logistics && m.CountryCode == specialistCountry && m.CrisisId != null)
            .Select(m => new { m.OrganisationId, m.CrisisId, m.DepotId });
        var depotOptions = await db.Set<Depot>().Where(d => codes.Contains(d.CountryCode) &&
                (!specialist || logisticsGrants.Any(m => m.OrganisationId == d.OrganisationId && (m.DepotId == null || m.DepotId == d.Id))))
            .OrderBy(d => d.Name)
            .Select(d => new { d.Id, d.Name, d.Location, d.CountryCode, d.OrganisationId,
                CanManageStock = !specialist || locations.Any(m => m.OrganisationId == d.OrganisationId && (m.DepotId == null || m.DepotId == d.Id)) })
            .ToListAsync(ct);
        var depots = depotOptions.Where(d => d.CanManageStock).Select(d => new { d.Id, d.Name, d.Location, d.CountryCode, d.OrganisationId });
        var crises = db.Set<Crisis>().Where(c => codes.Contains(c.CountryCode));
        var crisisOptions = await crises.OrderBy(c => c.Name).Select(c => new { c.Id, c.Name, c.CountryCode, c.Active }).ToListAsync(ct);
        var areas = await db.Set<OperationalArea>().Where(a => crises.Any(c => c.Id == a.CrisisId)).OrderBy(a => a.Name)
            .Select(a => new { a.Id, a.Name, a.CrisisId }).ToListAsync(ct);
        var partnerOptions = await (from registration in db.Set<OrganisationCountry>()
                              join organisation in db.Set<Organisation>() on registration.OrganisationId equals organisation.Id
                              where codes.Contains(registration.CountryCode)
                                  && (!specialist || logisticsGrants.Any(m => m.OrganisationId == organisation.Id))
                                  && (registration.VerificationState == "Verified" || registration.VerificationState == "LegacyActive")
                              orderby organisation.Name
                              select new { organisation.Id, organisation.Name, registration.CountryCode,
                                  CanManageStock = !specialist || locations.Any(m => m.OrganisationId == organisation.Id),
                                  CanRegisterDepot = !specialist || logisticsGrants.Any(m => m.OrganisationId == organisation.Id && m.DepotId == null) })
            .ToListAsync(ct);
        var partners = partnerOptions.Where(p => p.CanManageStock).Select(p => new { p.Id, p.Name, p.CountryCode });
        var resourceRegistration = new { Depots = depotOptions, Partners = partnerOptions };
        var organisationIds = grants.Where(m => specialist && m.Role == Roles.Logistics && m.CountryCode == specialistCountry)
            .Select(m => m.OrganisationId).Distinct().ToArray();
        var organisations = await db.Set<Organisation>().Where(o => organisationIds.Contains(o.Id)).OrderBy(o => o.Name)
            .Select(o => new { o.Id, o.Name }).ToListAsync(ct);
        var shipments = await db.Set<LogisticsOrder>()
            .Where(o => resources.Any(r => r.Id == o.ResourceId)
                && (o.DestinationResourceId == null || resources.Any(r => r.Id == o.DestinationResourceId))
                && (o.CrisisId == null || crises.Any(c => c.Id == o.CrisisId)))
            .Select(o => new Shipment(o.Id, o.Kind, o.ResourceId, o.DestinationResourceId, o.CrisisId, o.Origin, o.Destination,
                o.Quantity, o.Status, o.ActorId, o.Reason, o.CreatedAt, o.UpdatedAt, null,
                db.Set<StockMovement>().Where(m => m.OperationId == o.Id && m.Kind == "Dispatched")
                    .Select(m => (DateTimeOffset?)m.CreatedAt).FirstOrDefault(), o.PackedAt, o.ScheduledArrivalAt, o.Reference, null, null)).ToListAsync(ct);
        var cases = specialist ? await access.StaffCases(Roles.Logistics, ct) : db.Set<AssistanceRequest>();
        var allocations = await (from allocation in db.Set<ResourceAllocation>()
                                 join resource in db.Set<Resource>() on allocation.ResourceId equals resource.Id
                                 join request in cases on allocation.RequestId equals request.Id
                                 join crisis in crises on request.CrisisId equals crisis.Id
                                 where resource.CountryCode == crisis.CountryCode && (resources.Any(r => r.Id == resource.Id)
                                     || (specialist && caseGrants.Any(m => m.CrisisId == request.CrisisId && m.OrganisationId == resource.OrganisationId && (m.DepotId == null || m.DepotId == resource.DepotId))))
                                 select new Shipment(allocation.Id, LogisticsOrderKind.Dispatch, resource.Id, null,
                                     crisis.Id, resource.LocationText,
                                     db.Set<CaseDispatch>().Where(d => d.Id == allocation.CaseDispatchId)
                                         .Select(d => db.Set<Depot>().Where(centre => centre.Id == d.CentreId).Select(centre => centre.Name).FirstOrDefault()).FirstOrDefault()
                                     ?? db.Set<AdministrativeDivision>().Where(d => d.Id == request.AdministrativeDivisionId)
                                         .Select(d => d.Name).FirstOrDefault() ?? request.Reference,
                                     allocation.Quantity, allocation.Status, allocation.ApprovedBy, "",
                                     db.Set<CaseDispatch>().Where(d => d.Id == allocation.CaseDispatchId)
                                         .Select(d => (DateTimeOffset?)d.CreatedAt).FirstOrDefault() ?? allocation.CreatedAt, allocation.UpdatedAt, request.Id,
                                     db.Set<StockMovement>().Where(m => m.OperationId == allocation.Id && m.Kind == "Dispatch")
                                         .Select(m => (DateTimeOffset?)m.CreatedAt).FirstOrDefault(), allocation.PackedAt, allocation.ScheduledArrivalAt,
                                     db.Set<CaseDispatch>().Where(d => d.Id == allocation.CaseDispatchId).Select(d => d.Reference).FirstOrDefault() ?? allocation.Reference,
                                     allocation.CaseDispatchId, db.Set<CaseDispatch>().Where(d => d.Id == allocation.CaseDispatchId).Select(d => d.ReceivedAt).FirstOrDefault())).ToListAsync(ct);
        var orders = shipments.Concat(allocations).OrderByDescending(o => o.UpdatedAt).ThenBy(o => o.Id).ToArray();
        var orderIds = shipments.Select(o => o.Id).ToArray();
        var allocationIds = allocations.Select(o => o.Id).ToArray();
        var receipts = await db.Set<DeliveryConfirmation>().Where(r =>
            r.LogisticsOrderId.HasValue && orderIds.Contains(r.LogisticsOrderId.Value) ||
            r.AllocationId.HasValue && allocationIds.Contains(r.AllocationId.Value)).ToListAsync(ct);
        var actorIds = orders.Select(o => o.ActorId).Concat(receipts.Select(r => r.ActorId)).Distinct().ToArray();
        var actors = await db.Users.Where(u => actorIds.Contains(u.Id)).Select(u => new { u.Id, u.DisplayName })
            .ToDictionaryAsync(u => u.Id, u => u.DisplayName, ct);
        return new { countries, depots, inventory, caseInventory, caseStockScope, crises = crisisOptions, areas, partners, resourceRegistration, organisations, orders, actors, receipts };
    }

    private IQueryable<StockRow> ProjectStock(IQueryable<Resource> resources) => resources.Select(r =>
        new StockRow(r.Id, r.Name, r.Code, r.CountryCode, r.DepotId, r.OrganisationId, r.Category, r.Unit,
            r.Stock, r.Reserved, r.Stock - r.Reserved, r.LocationText, r.LowStockThreshold, r.Suitability, r.TransportAvailable,
            db.Set<OrganisationCountry>().Any(o => o.OrganisationId == r.OrganisationId && o.CountryCode == r.CountryCode &&
                (o.VerificationState == "Verified" || o.VerificationState == "LegacyActive")), r.Reference));

    private static readonly RequestStatus[] FulfilmentStates =
        [RequestStatus.Approved, RequestStatus.InProgress, RequestStatus.PartiallyFulfilled, RequestStatus.Fulfilled, RequestStatus.Closed];

    private async Task<IQueryable<AssistanceRequest>> FulfilmentCases(CancellationToken ct)
    {
        var country = await access.LogisticsCountry(ct);
        return (await access.StaffCases(Roles.Logistics, ct)).AsNoTracking()
            .Where(r => FulfilmentStates.Contains(r.Status) && r.Category != AidCategory.Shelter &&
                db.Set<Crisis>().Any(c => c.Id == r.CrisisId && c.CountryCode == country));
    }

    private sealed record CaseRow(Guid Id, string Reference, Guid CrisisId, Guid? OrganisationId, AidCategory Category,
        Priority Priority, RequestStatus Status, decimal Quantity, string? Unit, decimal DeliveredQuantity,
        decimal ReservedQuantity, decimal InTransitQuantity, bool HasReservations, bool InTransit, string? Region, bool Synthetic, bool RequiresCoordinatorAuthorization, DateTimeOffset? AuthorizedAt, bool PackingComplete, int NeedCount, bool NeedsPending, List<CaseItemRow> Items, string? LegacyReference, bool RequiresCentreHandover, bool AtCentre, bool HasPackedItems);

    private sealed record CaseItemRow(Guid Id, Guid RequestId, string Name, AidCategory Category, string Unit,
        decimal RequiredQuantity, decimal ApprovedQuantity, decimal DeliveredQuantity, DateTimeOffset CreatedAt,
        DateTimeOffset UpdatedAt, decimal ReservedQuantity, decimal InTransitQuantity);

    private IQueryable<CaseRow> ProjectCases(IQueryable<AssistanceRequest> cases)
    {
        var allocations = db.Set<ResourceAllocation>();
        return cases.Select(r => new CaseRow(r.Id, r.Reference, r.CrisisId, r.OrganisationId, r.Category,
            r.Priority, r.Status, r.Quantity, r.Unit, r.DeliveredQuantity,
            allocations.Where(a => a.RequestId == r.Id && a.NeedId == null && a.Status == AllocationStatus.Reserved).Sum(a => a.RequestQuantity ?? 0),
            allocations.Where(a => a.RequestId == r.Id && a.NeedId == null && a.Status == AllocationStatus.Dispatched).Sum(a => a.RequestQuantity ?? 0),
            allocations.Any(a => a.RequestId == r.Id && a.Status == AllocationStatus.Reserved),
            allocations.Any(a => a.RequestId == r.Id && a.Status == AllocationStatus.Dispatched && a.CentreReceivedQuantity == null),
            db.Set<AdministrativeDivision>().Where(d => d.Id == r.AdministrativeDivisionId).Select(d => d.Name).FirstOrDefault(),
            r.Synthetic, r.RequiresCoordinatorAuthorization, r.AuthorizedAt,
            allocations.Any(a => a.RequestId == r.Id && a.Status == AllocationStatus.Reserved) &&
            !allocations.Any(a => a.RequestId == r.Id && a.Status == AllocationStatus.Reserved && a.PackedAt == null),
            db.Set<CaseNeed>().Count(n => n.RequestId == r.Id),
            db.Set<CaseNeed>().Any(n => n.RequestId == r.Id && n.ApprovedQuantity > n.DeliveredQuantity +
                allocations.Where(a => a.RequestId == n.RequestId && a.NeedId == n.Id &&
                    (a.Status == AllocationStatus.Reserved || a.Status == AllocationStatus.Dispatched)).Sum(a => a.RequestQuantity ?? 0)),
            db.Set<CaseNeed>().Where(n => n.RequestId == r.Id).OrderBy(n => n.CreatedAt).ThenBy(n => n.Id)
                .Select(n => new CaseItemRow(n.Id, n.RequestId, n.Name, n.Category, n.Unit, n.RequiredQuantity,
                    n.ApprovedQuantity, n.DeliveredQuantity, n.CreatedAt, n.UpdatedAt,
                    allocations.Where(a => a.RequestId == n.RequestId && a.NeedId == n.Id && a.Status == AllocationStatus.Reserved)
                        .Sum(a => a.RequestQuantity ?? 0),
                    allocations.Where(a => a.RequestId == n.RequestId && a.NeedId == n.Id && a.Status == AllocationStatus.Dispatched)
                        .Sum(a => a.RequestQuantity ?? 0))).ToList(), r.LegacyReference, r.RequiresCentreHandover,
            allocations.Any(a => a.RequestId == r.Id && a.Status == AllocationStatus.Dispatched && a.CentreReceivedQuantity != null),
            allocations.Any(a => a.RequestId == r.Id && a.Status == AllocationStatus.Reserved && a.PackedAt != null)));
    }

    [HttpGet("cases")]
    public async Task<object> Cases(CancellationToken ct) =>
        await ProjectCases((await FulfilmentCases(ct)).OrderByDescending(r => r.Priority).ThenBy(r => r.Reference)).ToListAsync(ct);

    [HttpGet("cases/{id:guid}")]
    public async Task<object> Case(Guid id, CancellationToken ct)
    {
        var row = await ProjectCases((await FulfilmentCases(ct)).Where(r => r.Id == id)).SingleOrDefaultAsync(ct)
            ?? throw new MissingException();
        var country = await access.LogisticsCountry(ct);
        var grants = db.Set<Membership>().Where(m => m.UserId == access.UserId && m.Role == Roles.Logistics &&
            m.CountryCode == country && (m.CrisisId == null || m.CrisisId == row.CrisisId));
        var resources = db.Set<Resource>().Where(r => r.CountryCode == country && grants.Any(m => m.OrganisationId == r.OrganisationId && (m.DepotId == null || m.DepotId == r.DepotId)));
        var allocations = await (from a in db.Set<ResourceAllocation>()
            join r in resources on a.ResourceId equals r.Id
            where a.RequestId == id
            orderby a.CreatedAt, a.Id
            select new
            {
                a.Id, a.Reference, a.ResourceId, a.Quantity, a.RequestQuantity, a.Status, r.Name, r.Unit,
                Depot = db.Set<Depot>().Where(d => d.Id == r.DepotId).Select(d => d.Name).FirstOrDefault() ?? r.LocationText,
                a.CreatedAt, a.UpdatedAt, a.PackedAt, a.ScheduledArrivalAt, a.NeedId, a.CaseDispatchId,
                ConfirmedQuantity = db.Set<DeliveryConfirmation>().Where(d => d.AllocationId == a.Id).Select(d => (decimal?)d.ConfirmedQuantity).FirstOrDefault(),
                HasException = db.Set<DeliveryConfirmation>().Any(d => d.AllocationId == a.Id && d.ExceptionDetail != "")
            }).ToListAsync(ct);
        var history = await db.Set<RequestHistory>().Where(h => h.RequestId == id).OrderBy(h => h.CreatedAt).ThenBy(h => h.Id)
            .Select(h => new { h.Id, h.Status, h.CreatedAt }).ToListAsync(ct);
        return new { Case = row, Allocations = allocations, History = history };
    }

    [HttpPost("depots")]
    public Task<Depot> AddDepot(DepotInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        await access.RequireLocation(input.OrganisationId, input.CountryCode, [Roles.Logistics], ct, includeCrisisAssignments: true);
        await access.RequireDepot(new Resource { OrganisationId = input.OrganisationId, CountryCode = input.CountryCode }, ct,
            includeCrisisAssignments: true);
        await access.RequirePartner(input.OrganisationId, input.CountryCode, ct);
        RequireReference(input.OperationId);
        var name = input.Name.Trim();
        var location = input.Location.Trim();
        if (name.Length == 0 || location.Length == 0) throw new RuleException("Enter a depot name and location.");
        if (await store.FindAsync<Depot>(input.OperationId, ct) is { } existing)
        {
            if (existing.CountryCode != input.CountryCode || existing.OrganisationId != input.OrganisationId) throw new AccessDeniedException();
            if (existing.Name != name || existing.Location != location) throw new RuleException("This depot reference has already been used.");
            return existing;
        }
        var depot = new Depot { Id = input.OperationId, CountryCode = input.CountryCode, OrganisationId = input.OrganisationId, Name = name, Location = location };
        db.Add(depot);
        operations.Audit("DepotRegistered", depot, name, depot.CountryCode);
        return depot;
    }, ct);

    [HttpPost("resources/{id:guid}/stock")]
    public Task<StockMovement> RecordStock(Guid id, StockInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var resource = await RequireResource(id, ct);
        RequireReference(input.OperationId);
        QuantityUnits.ValidateInventory(Math.Abs(input.Delta), resource.Unit);
        if (input.Delta == 0 || input.Delta < -10000000 || input.Delta > 10000000)
            throw new RuleException("Enter a stock change between 0.01 and 10,000,000 units.");
        var kind = (input.Movement ?? (input.Delta > 0 ? "receive" : "adjust")) switch
        {
            "receive" when input.Delta > 0 => "StockReceived",
            "adjust" => "StockAdjusted",
            _ => throw new RuleException("Choose a receipt or a stock adjustment."),
        };
        var reason = Reason(input.Reason);
        if (await store.FindAsync<StockMovement>(input.OperationId, ct) is { } existing)
        {
            if (existing.ResourceId != resource.Id || existing.ActorId != access.UserId) throw new AccessDeniedException();
            if (existing.Quantity != input.Delta || existing.Note != reason || existing.Kind != kind)
                throw new RuleException("This stock movement reference has already been used.");
            return existing;
        }
        resource.ChangePhysical(input.Delta);
        await notifications.StockAlert(resource, ct);
        var place = await Place(resource, ct);
        var movement = new StockMovement { Id = input.OperationId, OperationId = input.OperationId, ResourceId = id,
            Quantity = input.Delta, Kind = kind,
            ActorId = access.UserId, Note = reason, Destination = place };
        db.Add(movement);
        operations.Audit("ResourceStockRecorded", resource, $"{movement.Id}: {reason}");
        return movement;
    }, ct);

    [HttpGet("resources/{id:guid}/history")]
    public async Task<object> History(Guid id, CancellationToken ct)
    {
        await RequireResource(id, ct);
        var movements = await operations.StockHistory(id, ct);
        var actorIds = movements.Select(m => m.ActorId).Distinct().ToArray();
        var actors = await db.Users.Where(u => actorIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.DisplayName, ct);
        return movements.Select(m => new { m.Id, m.OperationId, m.CrisisId, m.RequestId, m.Origin, m.Destination,
            m.Kind, m.Quantity, m.Note, m.ActorId, ActorName = actors.GetValueOrDefault(m.ActorId), m.CreatedAt });
    }

    [HttpPatch("resources/{id:guid}/configuration")]
    public async Task<IActionResult> Configure(Guid id, ConfigurationInput input, CancellationToken ct)
    {
        await store.TransactionAsync(async () =>
        {
            var resource = await RequireResource(id, ct);
            if (input.LowStockThreshold is { } threshold && threshold != resource.LowStockThreshold)
                QuantityUnits.ValidateStockLevel(threshold, resource.Unit);
            if (resource.DepotId != null && input.DepotId != resource.DepotId)
                throw new RuleException("Use a transfer to move stock between registered depots.");
            if (input.DepotId != null && resource.DepotId == null)
            {
                var depot = await store.FindAsync<Depot>(input.DepotId.Value, ct) ?? throw new MissingException();
                if (depot.CountryCode != resource.CountryCode || depot.OrganisationId != resource.OrganisationId)
                    throw new AccessDeniedException();
            }
            var code = string.IsNullOrWhiteSpace(input.Code) ? null : input.Code.Trim();
            if (resource.LowStockThreshold == input.LowStockThreshold && resource.Code == code && resource.DepotId == input.DepotId)
                return resource;
            resource.LowStockThreshold = input.LowStockThreshold;
            resource.DepotId = input.DepotId;
            resource.Code = code;
            operations.Audit("ResourceLogisticsConfigured", resource, $"Code {code ?? "automatic"} · Depot {input.DepotId} · Low-stock threshold {input.LowStockThreshold}");
            return resource;
        }, ct);
        return NoContent();
    }

    [HttpPost("orders")]
    public Task<LogisticsOrder> Reserve(OrderInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var source = await RequireResource(input.ResourceId, ct);
        await access.RequirePartner(source.OrganisationId, source.CountryCode, ct);
        RequireReference(input.OperationId);
        QuantityUnits.ValidateInventory(input.Quantity, source.Unit);
        var reason = Reason(input.Reason);
        Resource? receiver = null;
        string destination;
        if (input.Kind == LogisticsOrderKind.Transfer)
        {
            if (input.DestinationResourceId is not { } receiverId || input.OperationalAreaId != null || input.CrisisId != null)
                throw new RuleException("Choose a destination inventory record for a depot transfer.");
            receiver = await RequireResource(receiverId, ct);
            if (!MatchesTransfer(source, receiver)) throw new RuleException("Choose the same product with a compatible unit at a different registered depot.");
            QuantityUnits.ForInventory(input.Quantity, source.Unit, receiver.Unit);
            await access.RequirePartner(receiver.OrganisationId, receiver.CountryCode, ct);
            destination = await Place(receiver, ct);
        }
        else
        {
            if (input.CrisisId is not { } crisisId || input.DestinationResourceId != null)
                throw new RuleException("Choose a crisis for this dispatch.");
            var crisis = await store.FindAsync<Crisis>(crisisId, ct) ?? throw new MissingException();
            if (crisis.CountryCode != source.CountryCode)
                throw new RuleException("A crisis dispatch must originate in the crisis country. Use a depot transfer first when stock is abroad.");
            destination = crisis.Name;
            if (input.OperationalAreaId is { } areaId)
            {
                var area = await store.FindAsync<OperationalArea>(areaId, ct) ?? throw new MissingException();
                if (area.CrisisId != crisis.Id) throw new RuleException("Choose an operational area in the selected crisis.");
                destination = $"{crisis.Name} · {area.Name}";
            }
            if (!crisis.Active && await store.FindAsync<LogisticsOrder>(input.OperationId, ct) is null)
                throw new RuleException("Choose an active crisis for a new reservation.");
        }
        if (await store.FindAsync<LogisticsOrder>(input.OperationId, ct) is { } existing)
        {
            if (existing.ActorId != access.UserId) throw new AccessDeniedException();
            if (existing.Kind != input.Kind || existing.ResourceId != source.Id ||
                existing.DestinationResourceId != receiver?.Id || existing.CrisisId != input.CrisisId ||
                existing.OperationalAreaId != input.OperationalAreaId || existing.Quantity != input.Quantity || existing.Reason != reason)
                throw new RuleException("This logistics reference has already been used.");
            return existing;
        }
        source.Reserve(input.Quantity);
        var order = new LogisticsOrder { RequiresPacking = true, Id = input.OperationId, Kind = input.Kind, ResourceId = source.Id,
            DestinationResourceId = receiver?.Id, CrisisId = input.CrisisId, OperationalAreaId = input.OperationalAreaId,
            Origin = await Place(source, ct), Destination = destination, Quantity = input.Quantity, ActorId = access.UserId, Reason = reason };
        db.Add(order);
        RecordMovement(source, order, "Reserved", reason);
        return order;
    }, ct);

    [HttpPost("orders/{id:guid}/{operation}")]
    public Task<LogisticsOrder> Transition(Guid id, string operation, ActionInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var order = await store.FindAsync<LogisticsOrder>(id, ct) ?? throw new MissingException();
        var source = await RequireResource(order.ResourceId, ct);
        var receiver = order.DestinationResourceId is { } destinationId ? await RequireResource(destinationId, ct) : null;
        var (before, after) = operation switch
        {
            "dispatch" => (AllocationStatus.Reserved, AllocationStatus.Dispatched),
            "cancel" => (AllocationStatus.Reserved, AllocationStatus.Cancelled),
            "deliver" => (AllocationStatus.Dispatched, AllocationStatus.Delivered),
            _ => throw new RuleException("Choose dispatch, confirm delivery, or cancel."),
        };
        if (order.Status == after || operation == "deliver" && order.Status == AllocationStatus.DeliveryException) return order;
        if (order.Status != before) throw new RuleException("This action is unavailable for the current shipment status.");
        var reason = after == AllocationStatus.Delivered ? "Shipment receipt recorded." : Reason(input.Reason);
        var quantity = order.Quantity;
        if (after == AllocationStatus.Dispatched)
        {
            if (order.RequiresPacking && order.PackedAt == null) throw new RuleException("Confirm packing before dispatch.");
            await access.RequirePartner(source.OrganisationId, source.CountryCode, ct);
            if (receiver != null) await access.RequirePartner(receiver.OrganisationId, receiver.CountryCode, ct);
            if (order.CrisisId is { } crisisId && !await db.Set<Crisis>().AnyAsync(c => c.Id == crisisId && c.Active, ct))
                throw new RuleException("This crisis has ended. Release the reservation to make the stock available.");
            source.Dispatch(order.Quantity);
        }
        else if (after == AllocationStatus.Cancelled) source.Release(order.Quantity);
        else
        {
            var receipt = DeliveryReceipts.Create(input.Delivery, order.Quantity, source.Unit, order.UpdatedAt,
                access.UserId, transfer: receiver is not null);
            receipt.LogisticsOrderId = order.Id;
            quantity = receipt.ConfirmedQuantity;
            if (quantity == 0) after = AllocationStatus.DeliveryException;
            db.Add(receipt);
            if (receiver != null && quantity > 0)
            {
                var destinationQuantity = QuantityUnits.ForInventory(quantity, source.Unit, receiver.Unit);
                receiver.ChangePhysical(destinationQuantity);
                RecordMovement(receiver, order, "TransferReceived", reason, destinationQuantity);
            }
            if (receipt.ExceptionDetail.Length > 0)
                operations.Audit("DeliveryException", order, "See the delivery confirmation for details.", source.CountryCode);
            await notifications.LogisticsReceipt(source, order.CrisisId, receipt.ExceptionDetail.Length > 0, ct);
            if (receiver != null && (receiver.CountryCode != source.CountryCode || receiver.OrganisationId != source.OrganisationId))
                await notifications.LogisticsReceipt(receiver, null, receipt.ExceptionDetail.Length > 0, ct);
        }
        order.Status = after;
        RecordMovement(source, order, after.ToString(), reason, quantity);
        return order;
    }, ct);

    [HttpPost("allocations/{id:guid}/{operation}")]
    public async Task<ResourceAllocation> TransitionAllocation(Guid id, string operation, ActionInput input, CancellationToken ct)
    {
        var allocation = await db.Set<ResourceAllocation>().AsNoTracking().SingleOrDefaultAsync(a => a.Id == id, ct)
            ?? throw new MissingException();
        if (!access.IsLogisticsWorkspace) await RequireResource(allocation.ResourceId, ct);
        var caseAction = operation switch
        {
            "dispatch" => "Dispatch",
            "deliver" => "Deliver",
            "cancel" => "Cancel",
            _ => throw new RuleException("Choose dispatch, confirm delivery, or cancel."),
        };
        return await operations.UpdateAllocation(id, caseAction, ct,
            caseAction == "Deliver" ? null : Reason(input.Reason), input.Delivery);
    }

    private void RecordMovement(Resource resource, LogisticsOrder order, string kind, string reason, decimal? quantity = null)
    {
        db.Add(new StockMovement { ResourceId = resource.Id, OperationId = order.Id, CrisisId = order.CrisisId,
            Origin = order.Origin, Destination = order.Destination, Quantity = quantity ?? order.Quantity,
            Kind = kind, ActorId = access.UserId, Note = reason });
        operations.Audit("Logistics" + kind, order, reason, resource.CountryCode);
    }

    private async Task<Resource> RequireResource(Guid id, CancellationToken ct)
    {
        var resource = await store.FindAsync<Resource>(id, ct) ?? throw new MissingException();
        await access.RequireLocation(resource.OrganisationId, resource.CountryCode, [Roles.Logistics], ct);
        await access.RequireDepot(resource, ct);
        return resource;
    }

    private async Task<string> Place(Resource resource, CancellationToken ct)
    {
        var name = resource.DepotId is { } id ? (await store.FindAsync<Depot>(id, ct))?.Name : null;
        return $"{name ?? resource.LocationText} ({resource.CountryCode})";
    }

    private static string Reason(string? input) => string.IsNullOrWhiteSpace(input)
        ? throw new RuleException("Record a reason for this action.")
        : input.Trim();

    private static void RequireReference(Guid id)
    {
        if (id == Guid.Empty) throw new RuleException("Provide a unique operation reference.");
    }

    private static bool MatchesTransfer(Resource source, Resource receiver) =>
        source.DepotId != null && receiver.DepotId != null && source.DepotId != receiver.DepotId &&
        source.Category == receiver.Category && QuantityUnits.Compatible(source.Unit, receiver.Unit) &&
        source.Name.Equals(receiver.Name, StringComparison.OrdinalIgnoreCase) &&
        (source.Code == null || receiver.Code == null || source.Code.Equals(receiver.Code, StringComparison.OrdinalIgnoreCase));
}
