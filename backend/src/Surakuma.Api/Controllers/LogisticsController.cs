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
        string ActorId, string Reason, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, Guid? RequestId);

    [HttpGet]
    public async Task<object> Dashboard(CancellationToken ct, bool specialist = false)
    {
        var global = !specialist && await access.IsAdmin(ct);
        var grants = await access.Memberships(ct);
        if (specialist && !grants.Any(m => m.Role == Roles.Logistics)) throw new AccessDeniedException();
        var specialistCountry = specialist ? access.SelectedCountry ?? throw new RuleException("Select the logistics country.") : null;
        var locations = db.Set<Membership>().Where(m => m.UserId == access.UserId && m.Role == Roles.Logistics
            && m.CountryCode == specialistCountry && m.CrisisId == null);
        var allowed = grants.Where(m => m.Role == (specialist ? Roles.Logistics : Roles.CountryAdministrator) && m.CrisisId == null
                && (!specialist || m.CountryCode == specialistCountry))
            .Select(m => m.CountryCode).Distinct().ToArray();
        if (!specialist && !global && allowed.Length == 0) throw new AccessDeniedException();
        var countries = await db.Set<Country>().Where(c => global || allowed.Contains(c.Code)).OrderBy(c => c.Name)
            .Select(c => new { c.Code, c.Name }).ToListAsync(ct);
        var codes = countries.Select(c => c.Code).ToArray();
        var resources = db.Set<Resource>().Where(r => codes.Contains(r.CountryCode));
        if (specialist) resources = resources.Where(r => locations.Any(m => m.OrganisationId == r.OrganisationId));
        var inventory = await resources.OrderBy(r => r.Name).ThenBy(r => r.Id)
            .Select(r => new { r.Id, r.Name, r.Code, r.CountryCode, r.DepotId, r.OrganisationId, r.Category, r.Unit,
                r.Stock, r.Reserved, Available = r.Stock - r.Reserved, r.LocationText, r.LowStockThreshold,
                r.Suitability, r.TransportAvailable }).ToListAsync(ct);
        var depots = await db.Set<Depot>().Where(d => codes.Contains(d.CountryCode) &&
                (!specialist || locations.Any(m => m.OrganisationId == d.OrganisationId))).OrderBy(d => d.Name)
            .Select(d => new { d.Id, d.Name, d.Location, d.CountryCode, d.OrganisationId }).ToListAsync(ct);
        var crises = db.Set<Crisis>().Where(c => codes.Contains(c.CountryCode));
        var crisisOptions = await crises.OrderBy(c => c.Name).Select(c => new { c.Id, c.Name, c.CountryCode, c.Active }).ToListAsync(ct);
        var areas = await db.Set<OperationalArea>().Where(a => crises.Any(c => c.Id == a.CrisisId)).OrderBy(a => a.Name)
            .Select(a => new { a.Id, a.Name, a.CrisisId }).ToListAsync(ct);
        var partners = await (from registration in db.Set<OrganisationCountry>()
                              join organisation in db.Set<Organisation>() on registration.OrganisationId equals organisation.Id
                              where codes.Contains(registration.CountryCode)
                                  && (!specialist || locations.Any(m => m.OrganisationId == organisation.Id))
                                  && (registration.VerificationState == "Verified" || registration.VerificationState == "LegacyActive")
                              orderby organisation.Name
                              select new { organisation.Id, organisation.Name, registration.CountryCode }).ToListAsync(ct);
        var shipments = await db.Set<LogisticsOrder>()
            .Where(o => resources.Any(r => r.Id == o.ResourceId)
                && (o.DestinationResourceId == null || resources.Any(r => r.Id == o.DestinationResourceId))
                && (o.CrisisId == null || crises.Any(c => c.Id == o.CrisisId)))
            .Select(o => new Shipment(o.Id, o.Kind, o.ResourceId, o.DestinationResourceId, o.CrisisId, o.Origin, o.Destination,
                o.Quantity, o.Status, o.ActorId, o.Reason, o.CreatedAt, o.UpdatedAt, null)).ToListAsync(ct);
        var cases = specialist ? await access.StaffCases(Roles.Logistics, ct) : db.Set<AssistanceRequest>();
        var allocations = await (from allocation in db.Set<ResourceAllocation>()
                                 join resource in resources on allocation.ResourceId equals resource.Id
                                 join request in cases on allocation.RequestId equals request.Id
                                 join crisis in crises on request.CrisisId equals crisis.Id
                                 select new Shipment(allocation.Id, LogisticsOrderKind.Dispatch, resource.Id, null,
                                     crisis.Id, resource.LocationText, request.Reference, allocation.Quantity, allocation.Status,
                                     allocation.ApprovedBy, "", allocation.CreatedAt, allocation.UpdatedAt, request.Id)).ToListAsync(ct);
        var orders = shipments.Concat(allocations).OrderByDescending(o => o.UpdatedAt).ThenBy(o => o.Id).ToArray();
        var orderIds = shipments.Select(o => o.Id).ToArray();
        var allocationIds = allocations.Select(o => o.Id).ToArray();
        var receipts = await db.Set<DeliveryConfirmation>().Where(r =>
            r.LogisticsOrderId.HasValue && orderIds.Contains(r.LogisticsOrderId.Value) ||
            r.AllocationId.HasValue && allocationIds.Contains(r.AllocationId.Value)).ToListAsync(ct);
        var actorIds = orders.Select(o => o.ActorId).Concat(receipts.Select(r => r.ActorId)).Distinct().ToArray();
        var actors = await db.Users.Where(u => actorIds.Contains(u.Id)).Select(u => new { u.Id, u.DisplayName })
            .ToDictionaryAsync(u => u.Id, u => u.DisplayName, ct);
        return new { countries, depots, inventory, crises = crisisOptions, areas, partners, orders, actors, receipts };
    }

    [HttpPost("depots")]
    public Task<Depot> AddDepot(DepotInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        await access.RequireLocation(input.OrganisationId, input.CountryCode, [Roles.Logistics], ct);
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
            if (input.LowStockThreshold is { } threshold) QuantityUnits.ValidateInventory(threshold, resource.Unit);
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
            if (!MatchesTransfer(source, receiver)) throw new RuleException("Choose the same product and unit at a different registered depot.");
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
        var order = new LogisticsOrder { Id = input.OperationId, Kind = input.Kind, ResourceId = source.Id,
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
                receiver.ChangePhysical(quantity);
                RecordMovement(receiver, order, "TransferReceived", reason, quantity);
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
        await RequireResource(allocation.ResourceId, ct);
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
        source.Category == receiver.Category && source.Unit.Equals(receiver.Unit, StringComparison.OrdinalIgnoreCase) &&
        source.Name.Equals(receiver.Name, StringComparison.OrdinalIgnoreCase) &&
        (source.Code == null || receiver.Code == null || source.Code.Equals(receiver.Code, StringComparison.OrdinalIgnoreCase));
}
