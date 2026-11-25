using System.Text.Json;
using Surakuma.Domain;
using VolunteerTaskStatus = Surakuma.Domain.TaskStatus;

namespace Surakuma.Application;

public sealed partial class Operations
{
    public sealed record CentreOption(Guid Id, string Name, string Location);
    public sealed record DispatchLine(Guid Id, string Name, string Unit, decimal Sent, decimal? AtCentre, decimal? GivenToCitizen,
        decimal? ReportedQuantity = null);
    public sealed record DispatchSummary(Guid Id, string Reference, string Centre, string CentreLocation, DateTimeOffset SentAt,
        DateTimeOffset? ReceivedAt, DispatchLine[] Items, bool CanReceive, bool AvailableForAssignment, string? VolunteerStatus);

    public async Task<object> Dispatches(Guid requestId, CancellationToken ct)
    {
        var request = await access.Request(requestId, ct: ct);
        var citizen = request.CitizenId == access.UserId;
        var canPlan = !citizen && !access.IsLogisticsWorkspace && !access.IsVolunteerWorkspace &&
            request.OrganisationId != null && ActiveFulfilment.Contains(request.Status) && await access.Coordinates(request.CrisisId, ct);
        var country = await CrisisCountry(request.CrisisId, ct);
        var centres = request.RequiresCentreHandover && request.OrganisationId != null && !citizen
            ? await store.ListAsync(store.Query<Depot>().Where(d => d.CountryCode == country && d.OrganisationId == request.OrganisationId)
                .OrderBy(d => d.Name).Select(d => new CentreOption(d.Id, d.Name, d.Location)), ct)
            : [];
        var centre = centres.FirstOrDefault(d => d.Id == request.HandoverCentreId);
        var dispatches = await store.ListAsync(store.Query<CaseDispatch>().Where(d => d.RequestId == requestId)
            .OrderByDescending(d => d.CreatedAt), ct);
        var shipments = new List<DispatchSummary>();
        foreach (var dispatch in dispatches)
            shipments.Add(await DescribeDispatch(dispatch, request, citizen, ct));
        return new { request.RequiresCentreHandover, Centre = centre, Centres = canPlan ? centres : [],
            CanPlan = canPlan && request.RequiresCentreHandover, Dispatches = shipments };
    }

    public Task<Depot> PlanHandover(Guid requestId, Guid centreId, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var request = await access.Request(requestId, [Roles.Coordinator], ct);
        if (access.IsLogisticsWorkspace || access.IsVolunteerWorkspace || !await access.Coordinates(request.CrisisId, ct))
            throw new AccessDeniedException();
        if (!request.RequiresCentreHandover || !ActiveFulfilment.Contains(request.Status))
            throw new RuleException("Choose a receiving centre for an approved supply request.");
        var centre = await store.FindAsync<Depot>(centreId, ct) ?? throw new MissingException();
        if (centre.OrganisationId != request.OrganisationId || centre.CountryCode != await CrisisCountry(request.CrisisId, ct))
            throw new AccessDeniedException();
        if (request.HandoverCentreId == centreId) return centre;
        request.HandoverCentreId = centre.Id;
        await RecordChange(request, $"Receiving centre set to {centre.Name}.", ct, request.Status, "HandoverCentreAssigned");
        return centre;
    }, ct);

    public Task<CaseDispatch> DispatchToCentre(Guid requestId, Guid operationId, Guid[] ids, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var request = await access.Request(requestId, LogisticsRoles, ct);
        if (!request.RequiresCentreHandover || request.HandoverCentreId is not Guid centreId || request.AuthorizedAt == null)
            throw new RuleException("The coordinator must authorize fulfilment and select a receiving centre.");
        var centre = await store.FindAsync<Depot>(centreId, ct) ?? throw new MissingException();
        var country = await CrisisCountry(request.CrisisId, ct);
        if (centre.CountryCode != country || centre.OrganisationId != request.OrganisationId)
            throw new RuleException("Choose a receiving centre in the assigned organisation.");
        if (operationId == Guid.Empty || ids.Length is < 1 or > 100 || ids.Distinct().Count() != ids.Length)
            throw new RuleException("Select up to 100 distinct packed items.");

        var lines = await store.ListAsync(store.Query<ResourceAllocation>().Where(a => ids.Contains(a.Id) && a.RequestId == requestId)
            .OrderBy(a => a.ResourceId).ThenBy(a => a.Id), ct);
        if (lines.Count != ids.Length) throw new MissingException();
        var resources = new Dictionary<Guid, Resource>();
        foreach (var line in lines)
        {
            if (resources.ContainsKey(line.ResourceId)) continue;
            var resource = await store.FindAsync<Resource>(line.ResourceId, ct) ?? throw new MissingException();
            if (resource.CountryCode != country) throw new AccessDeniedException();
            await access.RequireLocation(resource.OrganisationId, country, LogisticsRoles, ct, request.CrisisId);
            await access.RequireDepot(resource, ct, request.CrisisId);
            resources.Add(resource.Id, resource);
        }
        if (await store.FindAsync<CaseDispatch>(operationId, ct) is { } existing)
        {
            if (existing.RequestId != requestId || existing.DispatchedBy != access.UserId) throw new AccessDeniedException();
            var previous = await store.ListAsync(store.Query<ResourceAllocation>().Where(a => a.CaseDispatchId == operationId).Select(a => a.Id), ct);
            if (!previous.ToHashSet().SetEquals(ids)) throw new RuleException("This dispatch reference has already been used.");
            return existing;
        }
        if (!ActiveFulfilment.Contains(request.Status) || lines.Any(a => a.Status != AllocationStatus.Reserved ||
            a.CaseDispatchId != null || a.PackedAt == null || a.RequestQuantity == null || a.NeedId == null && request.UnitRequiresClarification))
            throw new RuleException("Only packed, reserved items for this case can be dispatched.");

        var dispatch = new CaseDispatch { Id = operationId, RequestId = requestId, CentreId = centre.Id, DispatchedBy = access.UserId };
        store.Add(dispatch);
        foreach (var line in lines)
        {
            var resource = resources[line.ResourceId];
            resource.Dispatch(line.Quantity);
            line.CaseDispatchId = dispatch.Id;
            line.Status = AllocationStatus.Dispatched;
            store.Add(new StockMovement { ResourceId = resource.Id, OperationId = line.Id, RequestId = requestId, CrisisId = request.CrisisId,
                Quantity = line.Quantity, Kind = "Dispatch", ActorId = access.UserId, Origin = resource.LocationText,
                Destination = centre.Name, Note = "Included in the case dispatch." });
        }
        await store.SaveAsync(ct);
        await RecordChange(request, $"{dispatch.Reference} dispatched to {centre.Name} with {lines.Count} stock lines.", ct,
            request.Status, "DispatchedToCentre", dispatchUpdate: true, depotId: centre.Id);
        Audit("CaseDispatchSent", dispatch, countryCode: country);
        return dispatch;
    }, ct);

    private async Task RequireCentreAccess(AssistanceRequest request, Depot centre, CancellationToken ct)
    {
        await access.RequireLocation(centre.OrganisationId, centre.CountryCode, LogisticsRoles, ct, request.CrisisId);
        await access.RequireDepot(new Resource { OrganisationId = centre.OrganisationId, CountryCode = centre.CountryCode,
            DepotId = centre.Id }, ct, request.CrisisId);
    }

    public Task<CaseDispatch> ReceiveAtCentre(Guid id, HandoverQuantity[] input, string? note, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var dispatch = await store.FindAsync<CaseDispatch>(id, ct) ?? throw new MissingException();
        var request = await access.Request(dispatch.RequestId, LogisticsRoles, ct);
        var centre = await store.FindAsync<Depot>(dispatch.CentreId, ct) ?? throw new MissingException();
        await RequireCentreAccess(request, centre, ct);
        var rows = await DispatchAllocations(id, ct);
        var quantities = await ValidateDispatchQuantities(rows, input, a => a.Quantity, note, ct);
        if (dispatch.ReceivedAt != null)
        {
            if (rows.All(line => line.CentreReceivedQuantity == quantities[line.Id])) return dispatch;
            throw new RuleException("Receipt for this dispatch has already been recorded.");
        }
        if (!ActiveFulfilment.Contains(request.Status)) throw new RuleException("The request is no longer open for fulfilment.");
        foreach (var line in rows)
        {
            var quantity = quantities[line.Id];
            var resource = await store.FindAsync<Resource>(line.ResourceId, ct) ?? throw new MissingException();
            var need = line.NeedId is Guid needId ? await store.FindAsync<CaseNeed>(needId, ct) : null;
            line.CentreReceivedQuantity = quantity;
            line.RequestQuantity = QuantityUnits.Convert(quantity, resource.Unit, need?.Unit ?? request.Unit);
            if (quantity == 0) line.Status = AllocationStatus.DeliveryException;
        }
        dispatch.ReceivedAt = DateTimeOffset.UtcNow;
        dispatch.ReceivedBy = access.UserId;
        dispatch.ReceiptNote = note?.Trim() ?? "";
        var anyReceived = quantities.Values.Any(q => q > 0);
        await RecordChange(request, anyReceived ? $"{dispatch.Reference} received at {centre.Name}. Assign a volunteer to deliver the items."
            : $"{dispatch.Reference} reached {centre.Name} with no items received. The remaining needs are open.", ct,
              request.Status, anyReceived ? "ReceivedAtCentre" : "CentreReceiptException", dispatchUpdate: true,
              actionRole: anyReceived ? Roles.VolunteerCoordinator : Roles.Logistics, depotId: centre.Id);
        Audit("CaseDispatchReceived", dispatch, dispatch.ReceiptNote, centre.CountryCode);
        return dispatch;
    }, ct);

    public async Task<DispatchSummary> VolunteerDispatch(Guid taskId, CancellationToken ct)
    {
        var task = await store.FindAsync<VolunteerTask>(taskId, ct) ?? throw new MissingException();
        var profile = await store.FindAsync<VolunteerProfile>(task.VolunteerId, ct) ?? throw new MissingException();
        var dispatch = task.CaseDispatchId is Guid id ? await store.FindAsync<CaseDispatch>(id, ct) : null;
        if (dispatch == null) throw new MissingException();
        var request = await store.FindAsync<AssistanceRequest>(task.RequestId, ct) ?? throw new MissingException();
        if (access.SelectedCountry is { } country && profile.CountryCode != country) throw new AccessDeniedException();
        if (profile.UserId == access.UserId)
            await access.RequireLocation(profile.OrganisationId, profile.CountryCode, [Roles.Volunteer], ct, request.CrisisId);
        else
        {
            await access.RequireLocation(profile.OrganisationId, profile.CountryCode, VolunteerRoles, ct, request.CrisisId);
            await access.Request(task.RequestId, VolunteerRoles, ct);
        }
        var summary = await DescribeDispatch(dispatch, request, false, ct);
        var reported = await LatestHandoverReport(taskId, ct);
        return summary with { Items = summary.Items.Select(line => line with {
            ReportedQuantity = reported != null && reported.TryGetValue(line.Id, out var quantity) ? quantity : null,
        }).ToArray() };
    }

    private async Task<DispatchSummary> DescribeDispatch(CaseDispatch dispatch, AssistanceRequest request, bool citizen, CancellationToken ct)
    {
        var centre = await store.FindAsync<Depot>(dispatch.CentreId, ct) ?? throw new MissingException();
        var items = await store.ListAsync(from line in store.Query<ResourceAllocation>()
            join stock in store.Query<Resource>() on line.ResourceId equals stock.Id
            where line.CaseDispatchId == dispatch.Id
            orderby stock.Name, line.Id
            select new DispatchLine(line.Id, stock.Name, stock.Unit, line.Quantity, line.CentreReceivedQuantity, line.CitizenReceivedQuantity, null), ct);
        var open = (await store.ListAsync(store.Query<VolunteerTask>().Where(t => t.CaseDispatchId == dispatch.Id &&
            OpenTasks.Contains(t.Status)).OrderByDescending(t => t.CreatedAt).ThenBy(t => t.Id)
            .Select(t => (VolunteerTaskStatus?)t.Status).Take(1), ct)).SingleOrDefault();
        var canReceive = false;
        if (!citizen && dispatch.ReceivedAt == null && !access.IsCoordinatorWorkspace && !access.IsVolunteerWorkspace)
        {
            try
            {
                await RequireCentreAccess(request, centre, ct);
                canReceive = true;
            }
            catch (AccessDeniedException) { }
        }
        return new(dispatch.Id, dispatch.Reference, centre.Name, centre.Location, dispatch.CreatedAt, dispatch.ReceivedAt, items.ToArray(),
            canReceive, !citizen && open == null && dispatch.ReceivedAt != null && items.Any(i => i.AtCentre > (i.GivenToCitizen ?? 0)),
            open?.ToString());
    }

    private Task<List<ResourceAllocation>> DispatchAllocations(Guid dispatchId, CancellationToken ct) =>
        store.ListAsync(store.Query<ResourceAllocation>().Where(a => a.CaseDispatchId == dispatchId).OrderBy(a => a.Id), ct);

    private async Task RequireAvailableHandover(AssistanceRequest request, Guid id, CancellationToken ct)
    {
        var dispatch = await store.FindAsync<CaseDispatch>(id, ct) ?? throw new MissingException();
        if (dispatch.RequestId != request.Id) throw new MissingException();
        if (dispatch.ReceivedAt == null || !(await DispatchAllocations(id, ct)).Any(a => a.Status == AllocationStatus.Dispatched))
            throw new RuleException("The centre must have items available for handover.");
        if ((await store.ListAsync(store.Query<VolunteerTask>().Where(t => t.CaseDispatchId == id && OpenTasks.Contains(t.Status))
            .OrderBy(t => t.Id).Take(1), ct)).Count > 0)
            throw new RuleException("This dispatch already has an open volunteer assignment.");
    }

    private async Task<Dictionary<Guid, decimal>> ValidateDispatchQuantities(List<ResourceAllocation> rows, HandoverQuantity[]? input,
        Func<ResourceAllocation, decimal> maximum, string? exception, CancellationToken ct)
    {
        if (input == null || input.Length != rows.Count || input.Select(i => i.AllocationId).Distinct().Count() != rows.Count)
            throw new RuleException("Enter an actual quantity for each item.");
        var quantities = input.ToDictionary(i => i.AllocationId, i => i.Quantity);
        foreach (var row in rows)
        {
            var limit = maximum(row);
            if (!quantities.TryGetValue(row.Id, out var quantity) || quantity < 0 || quantity > limit)
                throw new RuleException("Actual quantities cannot exceed the quantities available for this handover.");
            if (quantity < limit && string.IsNullOrWhiteSpace(exception))
                throw new RuleException("Explain any missing items in the report.");
            if (quantity == 0) continue;
            var stock = await store.FindAsync<Resource>(row.ResourceId, ct) ?? throw new MissingException();
            QuantityUnits.ValidateInventory(quantity, stock.Unit);
        }
        return quantities;
    }

    private static decimal PendingHandover(ResourceAllocation line) =>
        (line.CentreReceivedQuantity ?? 0) - (line.CitizenReceivedQuantity ?? 0);

    private async Task<string> PrepareHandoverReport(Guid dispatchId, HandoverQuantity[]? input, string? issues, CancellationToken ct)
    {
        var rows = (await DispatchAllocations(dispatchId, ct)).Where(a => PendingHandover(a) > 0).ToList();
        if (rows.Count == 0) throw new RuleException("No items remain for handover.");
        return JsonSerializer.Serialize(await ValidateDispatchQuantities(rows, input, PendingHandover, issues, ct));
    }

    private async Task<Dictionary<Guid, decimal>?> LatestHandoverReport(Guid taskId, CancellationToken ct)
    {
        var json = (await store.ListAsync(store.Query<VolunteerTaskEvent>().Where(e => e.TaskId == taskId && e.Action == "Complete")
            .OrderByDescending(e => e.CreatedAt).ThenByDescending(e => e.Id).Select(e => e.HandoverQuantitiesJson).Take(1), ct)).SingleOrDefault();
        return json == null ? null : JsonSerializer.Deserialize<Dictionary<Guid, decimal>>(json);
    }

    private async Task VerifyHandover(VolunteerTask task, AssistanceRequest request, Guid dispatchId, CancellationToken ct)
    {
        if (!ActiveFulfilment.Contains(request.Status)) throw new RuleException("The request is no longer open for fulfilment.");
        var dispatch = await store.FindAsync<CaseDispatch>(dispatchId, ct) ?? throw new MissingException();
        var quantities = await LatestHandoverReport(task.Id, ct) ?? throw new RuleException("Return the report for item quantities.");
        var needs = await store.ListAsync(store.Query<CaseNeed>().Where(n => n.RequestId == request.Id), ct);
        var previous = request.Status;
        foreach (var row in await DispatchAllocations(dispatchId, ct))
        {
            if (!quantities.TryGetValue(row.Id, out var quantity) || quantity == 0) continue;
            if (quantity > PendingHandover(row)) throw new RuleException("The report exceeds the remaining quantity.");
            var resource = await store.FindAsync<Resource>(row.ResourceId, ct) ?? throw new MissingException();
            var need = needs.Find(n => n.Id == row.NeedId);
            var delivered = QuantityUnits.Convert(quantity, resource.Unit, need?.Unit ?? request.Unit);
            row.CitizenReceivedQuantity = (row.CitizenReceivedQuantity ?? 0) + quantity;
            row.RequestQuantity -= delivered;
            if (PendingHandover(row) == 0) row.Status = AllocationStatus.Delivered;
            if (need != null)
            {
                if (need.DeliveredQuantity + delivered > need.ApprovedQuantity) throw new RuleException("Handover exceeds the approved item quantity.");
                need.DeliveredQuantity += delivered;
            }
            else request.Deliver(delivered);
        }
        if (needs.Count > 0 && quantities.Values.Any(q => q > 0))
        {
            request.Status = needs.All(n => n.DeliveredQuantity == n.ApprovedQuantity) ? RequestStatus.Fulfilled : RequestStatus.PartiallyFulfilled;
            request.UpdatedAt = DateTimeOffset.UtcNow;
        }
        await RecordChange(request, quantities.Values.Any(q => q > 0) ? $"Citizen handover verified for {dispatch.Reference}."
            : $"The handover attempt for {dispatch.Reference} was reviewed. Items remain at the centre.", ct,
              previous, "CitizenHandoverReviewed");
        Audit("CitizenHandoverVerified", dispatch, countryCode: await CrisisCountry(request.CrisisId, ct));
    }
}
