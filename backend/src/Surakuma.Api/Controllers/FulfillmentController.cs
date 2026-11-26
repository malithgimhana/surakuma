using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Api.Controllers;

[ApiController, Authorize, Route("api/v1/fulfillment")]
public sealed class FulfillmentController(CrisisDbContext db, IStore store, AccessService access,
    Operations operations, ResourceUnitCatalog units, InternalNotifications notifications) : ControllerBase
{
    public sealed record NeedInput([Required, MaxLength(120)] string Name, AidCategory Category,
        string Unit, decimal RequiredQuantity, decimal ApprovedQuantity, Guid? Id = null);
    public sealed record NeedList([Required, MinLength(1), MaxLength(30)] NeedInput[] Items);
    public sealed record PreparationInput(decimal PackedQuantity, DateTimeOffset? ScheduledArrivalAt, [Required, MaxLength(1000)] string Note);
    public sealed record DepotAssignment(Guid? DepotId);
    public sealed record HandoverCentre(Guid CentreId);
    public sealed record CaseDispatchInput(Guid OperationId, [Required, MinLength(1), MaxLength(100)] Guid[] AllocationIds);
    public sealed record CentreReceipt([Required, MinLength(1), MaxLength(100)] HandoverQuantity[] Items, [MaxLength(1000)] string? Note);

    [HttpGet("cases/{id:guid}/dispatches")]
    public Task<object> Dispatches(Guid id, CancellationToken ct) => operations.Dispatches(id, ct);

    [HttpPut("cases/{id:guid}/handover-centre")]
    public Task<Depot> HandoverCentreForCase(Guid id, HandoverCentre input, CancellationToken ct) =>
        operations.PlanHandover(id, input.CentreId, ct);

    [HttpPost("cases/{id:guid}/dispatches")]
    public Task<CaseDispatch> Dispatch(Guid id, CaseDispatchInput input, CancellationToken ct) =>
        operations.DispatchToCentre(id, input.OperationId, input.AllocationIds, ct);

    [HttpPost("dispatches/{id:guid}/receive")]
    public Task<CaseDispatch> Receive(Guid id, CentreReceipt input, CancellationToken ct) =>
        operations.ReceiveAtCentre(id, input.Items, input.Note, ct);

    [HttpGet("volunteer-tasks/{id:guid}/dispatch")]
    public Task<Operations.DispatchSummary> VolunteerDispatch(Guid id, CancellationToken ct) => operations.VolunteerDispatch(id, ct);

    [HttpGet("depot-assignments")]
    public async Task<object> Assignments(CancellationToken ct)
    {
        var country = access.SelectedCountry ?? throw new RuleException("Select the assigned country.");
        if (access.IsLogisticsWorkspace || !await access.CountryAccess(country, [], ct)) throw new AccessDeniedException();
        return new {
            Assignments = await db.Set<Membership>().Where(m => m.CountryCode == country && m.Role == Roles.Logistics)
                .Select(m => new { m.Id, m.OrganisationId, m.DepotId,
                    Name = db.Users.Where(u => u.Id == m.UserId).Select(u => u.DisplayName).FirstOrDefault() }).ToListAsync(ct),
            Depots = await db.Set<Depot>().Where(d => d.CountryCode == country).Select(d => new { d.Id, d.Name, d.OrganisationId }).ToListAsync(ct)
        };
    }

    [HttpGet("cases/{id:guid}")]
    public async Task<object> Read(Guid id, CancellationToken ct)
    {
        var request = await access.Request(id, [Roles.Logistics, Roles.CaseManager, Roles.Coordinator], ct);
        return new { request.RequiresCoordinatorAuthorization, request.AuthorizedAt,
            CanAuthorize = !access.IsLogisticsWorkspace && request.OrganisationId != null &&
                request.Status is RequestStatus.Approved or RequestStatus.InProgress or RequestStatus.PartiallyFulfilled &&
                await access.Coordinates(request.CrisisId, ct),
            CanEditNeeds = !access.IsLogisticsWorkspace && !access.IsCoordinatorWorkspace &&
                request.Status is RequestStatus.UnderReview or RequestStatus.Verified or RequestStatus.Approved &&
                !await db.Set<ResourceAllocation>().AnyAsync(a => a.RequestId == id, ct) &&
                await access.CrisisAccess(request.CrisisId,
                [Roles.CaseManager, Roles.Coordinator], request.OrganisationId, ct),
            Items = await db.Set<CaseNeed>().Where(n => n.RequestId == id).OrderBy(n => n.CreatedAt).ThenBy(n => n.Id).ToListAsync(ct) };
    }

    [HttpPut("cases/{id:guid}/items")]
    public Task<object> Items(Guid id, NeedList input, CancellationToken ct) => store.TransactionAsync<object>(async () =>
    {
        if (access.IsCoordinatorWorkspace) throw new AccessDeniedException();
        var request = await access.Request(id, [Roles.CaseManager, Roles.Coordinator], ct);
        if (request.Status is not (RequestStatus.UnderReview or RequestStatus.Verified or RequestStatus.Approved) ||
            await db.Set<ResourceAllocation>().AnyAsync(a => a.RequestId == id, ct))
            throw new RuleException("Item requirements can be edited before fulfillment starts.");
        var existing = await db.Set<CaseNeed>().Where(n => n.RequestId == id).ToListAsync(ct);
        db.RemoveRange(existing);
        var previousNeeds = existing.ToDictionary(need => need.Id);
        foreach (var item in input.Items)
        {
            var unit = units.Require(item.Unit);
            if (item.Id is not { } needId || !previousNeeds.Remove(needId, out var previous) ||
                previous.Category != item.Category || QuantityUnits.Normalize(previous.Unit) != unit)
                units.EnsureStockCategory(unit, item.Category);
            QuantityUnits.ValidateInventory(item.RequiredQuantity, unit);
            QuantityUnits.ValidateInventory(item.ApprovedQuantity, unit);
            if (item.RequiredQuantity <= 0 || item.ApprovedQuantity <= 0 ||
                item.RequiredQuantity > 10000000 || item.ApprovedQuantity > 10000000 ||
                string.IsNullOrWhiteSpace(item.Name) || item.Category == AidCategory.Shelter)
                throw new RuleException("Enter an item name, positive quantities and an inventory aid category.");
            db.Add(new CaseNeed { RequestId = id, Name = item.Name.Trim(), Category = item.Category, Unit = unit,
                RequiredQuantity = item.RequiredQuantity, ApprovedQuantity = item.ApprovedQuantity });
        }
        request.RequiresCoordinatorAuthorization = true;
        request.AuthorizedAt = null;
        request.AuthorizedBy = null;
        operations.Audit("CaseItemsReviewed", request);
        return new { Saved = true };
    }, ct);

    [HttpPost("cases/{id:guid}/authorize")]
    public Task<object> Authorize(Guid id, ReviewNote input, CancellationToken ct) => store.RoutingTransactionAsync<object>(async () =>
    {
        var request = await access.Request(id, [Roles.Coordinator], ct);
        if (access.IsLogisticsWorkspace || !await access.Coordinates(request.CrisisId, ct)) throw new AccessDeniedException();
        if (request.Status is not (RequestStatus.Approved or RequestStatus.InProgress or RequestStatus.PartiallyFulfilled) ||
            request.OrganisationId == null || string.IsNullOrWhiteSpace(input.Reason))
            throw new RuleException("Approve and assign the case and record a handoff reason.");
        if (request.AuthorizedAt != null) return new { request.AuthorizedAt };
        request.RequiresCoordinatorAuthorization = true;
        request.AuthorizedAt = DateTimeOffset.UtcNow;
        request.AuthorizedBy = access.UserId;
        db.Add(new RequestHistory { RequestId = id, ActorId = access.UserId, Status = "CoordinatorAuthorized", Note = input.Reason.Trim() });
        operations.Audit("CoordinatorAuthorized", request, input.Reason);
        await notifications.RequestChanged(request, "Coordinator authorized fulfillment.", ct,
            actionRole: request.Category == AidCategory.Shelter ? Roles.ShelterAdmin : Roles.Logistics);
        return new { request.AuthorizedAt };
    }, ct);

    [HttpPost("allocations/{id:guid}/prepare")]
    public Task<object> Prepare(Guid id, PreparationInput input, CancellationToken ct) => store.TransactionAsync<object>(async () =>
    {
        var allocation = await store.FindAsync<ResourceAllocation>(id, ct) ?? throw new MissingException();
        var request = await access.Request(allocation.RequestId, [Roles.Logistics], ct);
        var resource = await store.FindAsync<Resource>(allocation.ResourceId, ct) ?? throw new MissingException();
        await access.RequireLocation(resource.OrganisationId, resource.CountryCode, [Roles.Logistics], ct, request.CrisisId);
        await access.RequireDepot(resource, ct, request.CrisisId);
        ValidatePreparation(allocation.Quantity, allocation.Status, input, resource.Unit);
        if (request.RequiresCoordinatorAuthorization && request.AuthorizedAt == null) throw new RuleException("Coordinator authorization is required.");
        allocation.PackedAt ??= DateTimeOffset.UtcNow;
        allocation.PackedBy ??= access.UserId;
        allocation.ScheduledArrivalAt = input.ScheduledArrivalAt;
        db.Add(new RequestHistory { RequestId = request.Id, ActorId = access.UserId, Status = "Packed",
            Note = $"Packed {allocation.Quantity} {resource.Unit}. {input.Note}" });
        operations.Audit("AllocationPacked", allocation, input.Note, resource.CountryCode);
        return allocation;
    }, ct);

    [HttpPost("orders/{id:guid}/prepare")]
    public Task<object> PrepareOrder(Guid id, PreparationInput input, CancellationToken ct) => store.TransactionAsync<object>(async () =>
    {
        var order = await store.FindAsync<LogisticsOrder>(id, ct) ?? throw new MissingException();
        var resource = await store.FindAsync<Resource>(order.ResourceId, ct) ?? throw new MissingException();
        await access.RequireLocation(resource.OrganisationId, resource.CountryCode, [Roles.Logistics], ct);
        await access.RequireDepot(resource, ct);
        ValidatePreparation(order.Quantity, order.Status, input, resource.Unit);
        order.PackedAt ??= DateTimeOffset.UtcNow;
        order.PackedBy ??= access.UserId;
        order.ScheduledArrivalAt = input.ScheduledArrivalAt;
        operations.Audit("OrderPacked", order, input.Note, resource.CountryCode);
        return order;
    }, ct);

    private static void ValidatePreparation(decimal quantity, AllocationStatus status, PreparationInput input, string unit)
    {
        QuantityUnits.ValidateInventory(input.PackedQuantity, unit);
        if (status != AllocationStatus.Reserved || input.PackedQuantity != quantity || string.IsNullOrWhiteSpace(input.Note))
            throw new RuleException("Confirm the complete reserved quantity and packing note before dispatch.");
        if (input.ScheduledArrivalAt <= DateTimeOffset.UtcNow) throw new RuleException("Schedule arrival in the future.");
    }

    [HttpPut("assignments/{id:guid}/depot")]
    public Task<object> AssignDepot(Guid id, DepotAssignment input, CancellationToken ct) => store.TransactionAsync<object>(async () =>
    {
        var membership = await store.FindAsync<Membership>(id, ct) ?? throw new MissingException();
        if (access.IsLogisticsWorkspace || !await access.CountryAccess(membership.CountryCode, [], ct)) throw new AccessDeniedException();
        if (membership.Role != Roles.Logistics) throw new RuleException("Select a Logistics assignment.");
        if (input.DepotId is Guid depotId && !await db.Set<Depot>().AnyAsync(d => d.Id == depotId &&
            d.CountryCode == membership.CountryCode && d.OrganisationId == membership.OrganisationId, ct))
            throw new RuleException("Select a depot belonging to the assigned organisation and country.");
        membership.DepotId = input.DepotId;
        operations.Audit("LogisticsDepotAssigned", membership, countryCode: membership.CountryCode);
        return new { membership.DepotId };
    }, ct);
}
