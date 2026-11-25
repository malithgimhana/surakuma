using System.ComponentModel.DataAnnotations;
using Surakuma.Domain;

namespace Surakuma.Application;

public sealed record SupplyRequestInput(Guid OperationId, Guid RequestingOrganisationId, Guid TargetOrganisationId, Guid? ShelterId, Guid? CaseId,
    AidCategory Category, [Required, MaxLength(40)] string Unit, decimal Quantity, [Required, MaxLength(1000)] string Reason,
    Guid? DestinationResourceId = null);
public sealed record SupplyOption(Guid Id, string Name);
public sealed record SupplyRow(Guid Id, Guid RequestingOrganisationId, Guid TargetOrganisationId, AidCategory Category,
    string Unit, decimal Quantity, decimal ReceivedQuantity, string Reason, bool Cancelled, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt,
    Guid? DestinationResourceId, string? ResourceName, string? Destination, string Reference);
public sealed record SupportCommitment(Guid Id, Guid SupportRequestId, string Title, decimal Quantity, ContributionStatus Status, string Unit,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
public sealed record SupportReceipt(Guid Id, Guid ContributionId, decimal Quantity, string Reference, DateTimeOffset CreatedAt, string? Discrepancy);
public sealed record SupportEvent(Guid Id, Guid ContributionId, string Status, DateTimeOffset CreatedAt);
public sealed record SupplyWorkspace(List<SupplyRow> Requests, List<SupplyOption> Organisations, List<SupplyOption> RequestingOrganisations,
    List<SupplyOption> OfferingOrganisations, List<SupportCommitment> ReceivableCommitments,
    List<SupportCommitment> Commitments, List<SupportReceipt> Receipts, List<SupportEvent> Events,
    SupplyStatistics? Statistics = null);
public sealed record SupplyStatistics(int Total, int Awaiting, int Active, int Delivered);
public sealed record PartnerReceiptInput(Guid OperationId, Guid ResourceId, decimal Quantity, [Required, MaxLength(100)] string Reference, [MaxLength(500)] string? Discrepancy = null);
public sealed record PartnerReceiptOptions(List<FundingInventoryOption> Resources, decimal Remaining, string Unit);

public sealed class SupplySupportService(IStore store, AccessService access, Operations operations, InternalNotifications notifications, ResourceUnitCatalog units)
{
    private static readonly string[] RequesterRoles = [Roles.Partner, Roles.ShelterAdmin, Roles.Logistics];

    public async Task<SupplyWorkspace> Workspace(string country, CancellationToken ct, string? search = null)
    {
        if (access.IsLogisticsWorkspace && country != await access.LogisticsCountry(ct)) throw new AccessDeniedException();
        if (access.IsShelterWorkspace && country != await access.ShelterWorkspaceCountry(ct)) throw new AccessDeniedException();
        var global = !access.IsLogisticsWorkspace && !access.IsShelterWorkspace && await access.CountryAccess(country, [], ct);
        var grants = store.Query<Membership>().Where(m => m.UserId == access.UserId && m.CountryCode == country && RequesterRoles.Contains(m.Role));
        if (access.IsLogisticsWorkspace) grants = grants.Where(m => m.Role == Roles.Logistics);
        if (access.IsShelterWorkspace) grants = grants.Where(m => m.Role == Roles.ShelterAdmin && m.CrisisId == null);
        if (!global && (await store.ListAsync(grants.OrderBy(m => m.Id).Select(m => m.Id).Take(1), ct)).Count == 0) throw new AccessDeniedException();
        var organisations = store.Query<Organisation>().Where(o => store.Query<OrganisationCountry>().Any(link => link.CountryCode == country &&
            link.OrganisationId == o.Id && (link.VerificationState == "Verified" || link.VerificationState == "LegacyActive")));
        var scoped = store.Query<SupplyRequest>().Where(r => r.CountryCode == country &&
            (global || grants.Any(m => (m.OrganisationId == r.RequestingOrganisationId || m.Role == Roles.Partner && m.OrganisationId == r.TargetOrganisationId) &&
            (m.CrisisId == null || m.CrisisId == r.CrisisId) &&
            (m.DepotId == null || store.Query<Resource>().Any(i => i.Id == r.DestinationResourceId && i.DepotId == m.DepotId)) && organisations.Any(o => o.Id == m.OrganisationId))));
        SupplyStatistics? statistics = null;
        if (access.IsShelterWorkspace)
        {
            var contributions = store.Query<PartnerContribution>();
            var resolved = scoped.Where(r => !r.Cancelled && r.ReceivedQuantity >= r.Quantity);
            var outstanding = scoped.Where(r => !r.Cancelled && r.ReceivedQuantity < r.Quantity);
            var active = outstanding.Where(r => contributions.Any(c => c.SupportRequestId == r.Id &&
                (c.Status == ContributionStatus.Accepted || c.Status == ContributionStatus.InProgress || c.Status == ContributionStatus.Fulfilled)));
            static IQueryable<int> CountRows(IQueryable<SupplyRequest> rows) => rows.GroupBy(_ => 1).Select(g => g.Count());
            var total = (await store.ListAsync(CountRows(scoped), ct)).SingleOrDefault();
            var delivered = (await store.ListAsync(CountRows(resolved), ct)).SingleOrDefault();
            var open = (await store.ListAsync(CountRows(outstanding), ct)).SingleOrDefault();
            var inProgress = (await store.ListAsync(CountRows(active), ct)).SingleOrDefault();
            statistics = new(total, open - inProgress, inProgress, delivered);
        }
        var resources = store.Query<Resource>();
        var depots = store.Query<Depot>();
        if (!string.IsNullOrWhiteSpace(search))
        {
            search = search.Trim();
            scoped = scoped.Where(r => r.Reference.Contains(search) ||
                (r.LegacyReference != null && r.LegacyReference.Contains(search)));
        }
        var requests = await store.ListAsync(scoped.OrderByDescending(r => r.CreatedAt).ThenBy(r => r.Id).Take(150).Select(r => new SupplyRow(
            r.Id, r.RequestingOrganisationId, r.TargetOrganisationId, r.Category, r.Unit, r.Quantity, r.ReceivedQuantity,
            r.Reason, r.Cancelled, r.CreatedAt, r.UpdatedAt, r.DestinationResourceId,
            resources.Where(i => i.Id == r.DestinationResourceId).Select(i => i.Name).FirstOrDefault(),
            resources.Where(i => i.Id == r.DestinationResourceId).Select(i =>
                depots.Where(d => d.Id == i.DepotId).Select(d => d.Name).FirstOrDefault() ?? i.LocationText).FirstOrDefault(), r.Reference)), ct);
        var options = await store.ListAsync(organisations.OrderBy(o => o.Name).Select(o => new SupplyOption(o.Id, o.Name)), ct);
        var requesters = await store.ListAsync(organisations.Where(o => global || grants.Any(m => m.OrganisationId == o.Id))
            .OrderBy(o => o.Name).Select(o => new SupplyOption(o.Id, o.Name)), ct);
        var offering = await store.ListAsync(organisations.Where(o => grants.Any(m => m.OrganisationId == o.Id &&
            m.Role == Roles.Partner && m.CrisisId == null)).Select(o => new SupplyOption(o.Id, o.Name)), ct);
        var receiving = scoped.Where(r => global || grants.Any(m => m.Role == Roles.Logistics && m.OrganisationId == r.RequestingOrganisationId &&
            (m.CrisisId == null || m.CrisisId == r.CrisisId)));
        var requestIds = requests.Select(r => r.Id).ToArray();
        var linkedOffers = store.Query<PartnerContribution>().Where(c => c.CountryCode == country && c.SupportRequestId.HasValue &&
            requestIds.Contains(c.SupportRequestId.Value));
        var commitments = await store.ListAsync(linkedOffers.Select(c => new SupportCommitment(c.Id,
            c.SupportRequestId!.Value, c.Title, c.Quantity, c.Status, c.Unit, c.CreatedAt, c.UpdatedAt)), ct);
        var receivableIds = await store.ListAsync(linkedOffers.Where(c => receiving.Any(r => r.Id == c.SupportRequestId) &&
            (c.Status == ContributionStatus.Accepted || c.Status == ContributionStatus.InProgress || c.Status == ContributionStatus.Fulfilled))
            .Select(c => c.Id), ct);
        var discrepancies = store.Query<AuditEvent>().Where(a => a.CountryCode == country &&
            a.EntityType == nameof(PartnerStockReceipt) && a.Action == "SupplyReceiptDiscrepancy");
        var receipts = await store.ListAsync(store.Query<PartnerStockReceipt>().Where(r => linkedOffers.Any(c => c.Id == r.ContributionId))
            .OrderBy(r => r.CreatedAt).ThenBy(r => r.Id).Select(r => new SupportReceipt(r.Id, r.ContributionId, r.Quantity, r.Reference, r.CreatedAt,
                discrepancies.Where(a => a.EntityId == r.Id).Select(a => a.Detail).FirstOrDefault())), ct);
        var offerActions = new[] { "ContributionAccepted", "ContributionDeclined", "ContributionWithdrawn", "ContributionInProgress", "ContributionFulfilled" };
        var events = await store.ListAsync(store.Query<AuditEvent>().Where(e => e.CountryCode == country && e.EntityType == nameof(PartnerContribution) &&
            offerActions.Contains(e.Action) && linkedOffers.Any(c => c.Id == e.EntityId))
            .Select(e => new SupportEvent(e.Id, e.EntityId, e.Action.Substring("Contribution".Length), e.CreatedAt)), ct);
        return new(requests, options, requesters, offering, commitments.Where(c => receivableIds.Contains(c.Id)).ToList(), commitments, receipts, events, statistics);
    }

    public Task<SupplyRequest> Request(string country, SupplyRequestInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        if (input.OperationId == Guid.Empty || input.RequestingOrganisationId == input.TargetOrganisationId ||
            input.ShelterId.HasValue && input.CaseId.HasValue)
            throw new RuleException("Choose a different support organisation and at most one case or shelter.");
        if (access.IsShelterWorkspace && input.CaseId != null) throw new AccessDeniedException();
        var unit = units.Require(input.Unit);
        var reason = input.Reason.Trim();
        if (unit.Length == 0 || reason.Length == 0) throw new RuleException("Enter the units and reason for the shortage.");
        ValidateQuantity(input.Quantity, unit);
        var existing = await store.FindAsync<SupplyRequest>(input.OperationId, ct);
        Guid? crisisId = null;
        if (input.ShelterId.HasValue)
        {
            var shelter = await store.FindAsync<Shelter>(input.ShelterId.Value, ct) ?? throw new MissingException();
            if (shelter.OrganisationId != input.RequestingOrganisationId || shelter.CountryCode != country) throw new AccessDeniedException();
            await access.RequireLocation(shelter.OrganisationId, country, [Roles.ShelterAdmin], ct);
        }
        if (input.CaseId.HasValue)
        {
            var request = await access.Request(input.CaseId.Value, [Roles.Logistics, Roles.CaseManager], ct);
            var crisis = await store.FindAsync<Crisis>(request.CrisisId, ct) ?? throw new MissingException();
            if (request.OrganisationId != input.RequestingOrganisationId || crisis.CountryCode != country || request.Category != input.Category)
                throw new AccessDeniedException();
            if (existing == null && request.Status is not (RequestStatus.Approved or RequestStatus.InProgress or RequestStatus.PartiallyFulfilled))
                throw new RuleException("Only an active, approved case can request additional supplies.");
            if (!QuantityUnits.Compatible(unit, request.Unit))
                throw new RuleException("Choose a unit compatible with the confirmed case unit.");
            var reserved = await store.ListAsync(store.Query<ResourceAllocation>().Where(a => a.RequestId == request.Id &&
                (a.Status == AllocationStatus.Reserved || a.Status == AllocationStatus.Dispatched)).Select(a => a.RequestQuantity), ct);
            if (existing == null && QuantityUnits.Convert(input.Quantity, unit, request.Unit) > request.Quantity - request.DeliveredQuantity - reserved.Sum(q => q ?? 0))
                throw new RuleException("The supplies requested exceed the uncommitted case quantity.");
            crisisId = request.CrisisId;
        }
        await access.RequireLocation(input.RequestingOrganisationId, country, RequesterRoles, ct, crisisId);
        await access.RequirePartner(input.RequestingOrganisationId, country, ct);
        await access.RequirePartner(input.TargetOrganisationId, country, ct);
        if (access.IsLogisticsWorkspace && input.DestinationResourceId == null)
            throw new RuleException("Select an item at the receiving depot.");
        if (input.DestinationResourceId is Guid resourceId)
        {
            var resource = await store.FindAsync<Resource>(resourceId, ct) ?? throw new MissingException();
            if (resource.OrganisationId != input.RequestingOrganisationId || resource.CountryCode != country)
                throw new AccessDeniedException();
            await access.RequireDepot(resource, ct, crisisId);
            if (resource.DepotId == null || resource.Category != input.Category || QuantityUnits.Normalize(resource.Unit) != unit)
                throw new RuleException("Choose a depot item with the requested category and unit.");
        }
        if (existing != null)
        {
            if (existing.CountryCode != country || existing.RequestingOrganisationId != input.RequestingOrganisationId) throw new AccessDeniedException();
            if (existing.TargetOrganisationId != input.TargetOrganisationId || existing.ShelterId != input.ShelterId ||
                existing.CaseId != input.CaseId || existing.Category != input.Category || QuantityUnits.Normalize(existing.Unit) != unit ||
                existing.Quantity != input.Quantity || existing.Reason != reason || existing.DestinationResourceId != input.DestinationResourceId)
                throw new RuleException("This operation reference belongs to another support request.");
            return existing;
        }
        // A linked case or depot can still need the unit already recorded on it.
        if (input.DestinationResourceId == null && (input.CaseId == null || unit == "persons"))
            units.EnsureStockCategory(unit, input.Category);
        var record = new SupplyRequest { Id = input.OperationId, CountryCode = country, RequestingOrganisationId = input.RequestingOrganisationId,
            TargetOrganisationId = input.TargetOrganisationId, ShelterId = input.ShelterId, CaseId = input.CaseId, CrisisId = crisisId,
            Category = input.Category, Unit = unit, Quantity = input.Quantity, Reason = reason, DestinationResourceId = input.DestinationResourceId };
        store.Add(record);
        operations.Audit("SupportSuppliesRequested", record, countryCode: country);
        await notifications.PartnerChanged(record.TargetOrganisationId, country, crisisId, "Your organisation received a request for supplies.", false, ct);
        await notifications.SupplySupportChanged(record, "A supply request was submitted for your organisation.", ct);
        return record;
    }, ct);

    public Task<SupplyRequest> Cancel(string country, Guid id, ReviewNote input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var request = await FindRequest(id, country, ct);
        await access.RequireLocation(request.RequestingOrganisationId, country, RequesterRoles, ct, request.CrisisId);
        if (request.Cancelled) return request;
        var reason = input.Reason.Trim();
        if (reason.Length == 0) throw new RuleException("Enter a cancellation reason.");
        if (request.ReceivedQuantity > 0 || (await store.ListAsync(store.Query<PartnerContribution>().Where(c => c.SupportRequestId == id &&
            (c.Status == ContributionStatus.Accepted || c.Status == ContributionStatus.InProgress || c.Status == ContributionStatus.Fulfilled)).OrderBy(c => c.Id).Take(1), ct)).Count > 0)
            throw new RuleException("A request with a confirmed commitment must be reconciled before cancellation.");
        request.Cancelled = true;
        request.UpdatedAt = DateTimeOffset.UtcNow;
        operations.Audit("SupportRequestCancelled", request, reason, country);
        await notifications.PartnerChanged(request.TargetOrganisationId, country, request.CrisisId, "A supply request was cancelled.", false, ct);
        await notifications.SupplySupportChanged(request, "A supply request for your organisation was cancelled.", ct);
        return request;
    }, ct);

    public async Task<SupplyRequest> ValidateOffer(string country, Guid id, Guid partnerId, AidCategory? category, string kind, string unit, decimal quantity, CancellationToken ct)
    {
        var r = await FindRequest(id, country, ct);
        if (r.TargetOrganisationId != partnerId) throw new AccessDeniedException();
        if (r.Cancelled || r.ReceivedQuantity >= r.Quantity || kind != "Resource" || category != r.Category ||
            !QuantityUnits.Compatible(unit, r.Unit) || QuantityUnits.ForInventory(quantity, unit, r.Unit) > r.Quantity)
            throw new RuleException("The response must match the quantity, unit and category on an open support request.");
        return r;
    }

    public async Task<PartnerReceiptOptions> ReceiptOptions(string country, Guid id, CancellationToken ct)
    {
        var contribution = await FindContribution(id, country, ct);
        var request = contribution.SupportRequestId is Guid supportId ? await FindRequest(supportId, country, ct) : null;
        if (request == null && (access.IsLogisticsWorkspace || !await access.CountryAccess(country, [], ct))) throw new AccessDeniedException();
        if (request != null) await access.RequireLocation(request.RequestingOrganisationId, country, [Roles.Logistics], ct, request.CrisisId);
        var resources = await store.ListAsync((await access.Located<Resource>(ct, request?.CrisisId, [Roles.Logistics]))
            .Where(r => r.CountryCode == country && (request == null || r.OrganisationId == request.RequestingOrganisationId) &&
                (request == null || request.DestinationResourceId == null || r.Id == request.DestinationResourceId))
            .OrderBy(r => r.Name).Select(r => new FundingInventoryOption(r.Id, r.Name + " · " +
                (store.Query<Depot>().Where(d => d.Id == r.DepotId).Select(d => d.Name).FirstOrDefault() ?? r.LocationText),
                r.Category, r.Unit)), ct);
        var received = (await store.ListAsync(store.Query<PartnerStockReceipt>().Where(e => e.ContributionId == id).Select(e => e.Quantity), ct)).Sum();
        var available = resources.Where(r => r.Category == contribution.Category && QuantityUnits.Compatible(r.Unit, contribution.Unit)).ToList();
        var remaining = request == null ? contribution.Quantity - received : Math.Min(contribution.Quantity - received,
            QuantityUnits.Convert(request.Quantity - request.ReceivedQuantity, request.Unit, contribution.Unit));
        return new(available, Math.Max(0, remaining), contribution.Unit);
    }

    public Task<PartnerStockReceipt> Receive(string country, Guid id, PartnerReceiptInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var contribution = await FindContribution(id, country, ct);
        var support = contribution.SupportRequestId is Guid requestId ? await FindRequest(requestId, country, ct) : null;
        if (support == null && (access.IsLogisticsWorkspace || !await access.CountryAccess(country, [], ct))) throw new AccessDeniedException();
        var resource = await store.FindAsync<Resource>(input.ResourceId, ct) ?? throw new MissingException();
        if (resource.CountryCode != country || (support != null && (support.RequestingOrganisationId != resource.OrganisationId ||
            support.DestinationResourceId != null && support.DestinationResourceId != resource.Id)))
            throw new AccessDeniedException();
        await access.RequireLocation(resource.OrganisationId, country, [Roles.Logistics], ct, support?.CrisisId);
        await access.RequireDepot(resource, ct, support?.CrisisId);
        var reference = input.Reference.Trim();
        var discrepancy = input.Discrepancy?.Trim();
        if (input.OperationId == Guid.Empty || reference.Length == 0) throw new RuleException("Provide a receipt and operation reference.");
        ValidateQuantity(input.Quantity, contribution.Unit);
        if (await store.FindAsync<PartnerStockReceipt>(input.OperationId, ct) is { } existing)
        {
            var movement = await store.FindAsync<StockMovement>(existing.StockMovementId, ct) ?? throw new MissingException();
            var recordedDiscrepancy = (await store.ListAsync(store.Query<AuditEvent>().Where(a =>
                a.EntityId == existing.Id && a.EntityType == nameof(PartnerStockReceipt) &&
                a.CountryCode == country && a.Action == "SupplyReceiptDiscrepancy").Select(a => a.Detail), ct)).SingleOrDefault();
            if (existing.ContributionId != id || movement.ResourceId != resource.Id ||
                existing.Quantity != input.Quantity || existing.Reference != reference ||
                (recordedDiscrepancy ?? "") != (discrepancy ?? ""))
                throw new RuleException("This operation reference belongs to another stock receipt.");
            return existing;
        }
        if (contribution.Kind != "Resource" || contribution.Category != resource.Category || !QuantityUnits.Compatible(resource.Unit, contribution.Unit) ||
            contribution.Status is not (ContributionStatus.Accepted or ContributionStatus.InProgress or ContributionStatus.Fulfilled) ||
            support?.Cancelled == true)
            throw new RuleException("Select an accepted resource commitment and matching inventory.");
        var receipts = await store.ListAsync(store.Query<PartnerStockReceipt>().Where(r => r.ContributionId == id), ct);
        var supportQuantity = support == null ? 0 : QuantityUnits.ForInventory(input.Quantity, contribution.Unit, support.Unit);
        if (receipts.Any(r => r.Reference.Equals(reference, StringComparison.OrdinalIgnoreCase)) ||
            receipts.Sum(r => r.Quantity) + input.Quantity > contribution.Quantity ||
            support != null && support.ReceivedQuantity + supportQuantity > support.Quantity)
            throw new RuleException("Receipt duplicates existing evidence or exceeds the commitment or support balance.");
        var stockQuantity = QuantityUnits.ForInventory(input.Quantity, contribution.Unit, resource.Unit);
        resource.ChangePhysical(stockQuantity);
        var stock = new StockMovement { OperationId = input.OperationId, ResourceId = resource.Id, Quantity = stockQuantity, Kind = "PartnerStockReceived",
            ActorId = access.UserId, Note = reference, Destination = resource.LocationText, RequestId = support?.CaseId, CrisisId = support?.CrisisId };
        var receipt = new PartnerStockReceipt { Id = input.OperationId, ContributionId = id, StockMovementId = stock.Id, Quantity = input.Quantity, Reference = reference };
        store.Add(stock);
        store.Add(receipt);
        if (support != null)
        {
            support.ReceivedQuantity += supportQuantity;
            support.UpdatedAt = DateTimeOffset.UtcNow;
        }
        operations.Audit("PartnerContributionStockReceived", receipt, $"{contribution.Id}: {reference}", country);
        if (!string.IsNullOrEmpty(discrepancy))
            operations.Audit("SupplyReceiptDiscrepancy", receipt, discrepancy, country);
        operations.Audit("ContributionStockReceived", contribution, $"Received {input.Quantity} {contribution.Unit} against the commitment.", country);
        await notifications.PartnerChanged(contribution.OrganisationId, country, support?.CrisisId, "Stock was received against your contribution.", false, ct);
        if (support != null)
        {
            await notifications.PartnerChanged(support.RequestingOrganisationId, country, support.CrisisId, "Stock was received for your supply request.", false, ct);
            await notifications.SupplySupportChanged(support, "Stock was received for a supply request from your organisation.", ct);
        }
        return receipt;
    }, ct);

    public async Task<SupplyRequest> FindRequest(Guid id, string country, CancellationToken ct)
    {
        var request = await store.FindAsync<SupplyRequest>(id, ct) ?? throw new MissingException();
        return request.CountryCode == country ? request : throw new MissingException();
    }

    private async Task<PartnerContribution> FindContribution(Guid id, string country, CancellationToken ct)
    {
        var contribution = await store.FindAsync<PartnerContribution>(id, ct) ?? throw new MissingException();
        return contribution.CountryCode == country ? contribution : throw new MissingException();
    }


    private static void ValidateQuantity(decimal quantity, string unit)
    {
        QuantityUnits.ValidateInventory(quantity, unit);
        if (quantity is <= 0 or > 10000000) throw new RuleException("Enter a quantity from 0.01 to 10,000,000.");
    }
}
