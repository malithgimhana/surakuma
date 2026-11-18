using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Surakuma.Domain;
using VolunteerStatus = Surakuma.Domain.TaskStatus;

namespace Surakuma.Application;

public sealed record ForecastInput(AidCategory Category);
public sealed record BriefingInput([Range(1, 90)] int Days = 7);
public sealed record ReviewNote([Required, MaxLength(1000)] string Reason);
public sealed record InvestigationReview(InvestigationOutcome Outcome, [Required, MaxLength(1000)] string Reason);
public sealed record DemandWeek(DateTimeOffset From, int Requests, decimal? Requested, decimal? Fulfilled);
public sealed record DemandGroup(Guid? RegionId, string? Region, string Unit, IReadOnlyList<DemandWeek> Weeks, decimal? WeeklyEstimate);
public sealed record ForecastEvidence(IReadOnlyList<DemandWeek> Weeks, int? ObservedLow, int? ObservedHigh,
    int TransportReadyItems, string Risk, string Limitations, IReadOnlyList<DemandGroup>? Groups = null, int UnknownUnitRequests = 0);
public sealed record ForecastView(DemandForecast Record, ForecastEvidence Evidence);
public sealed record BriefingFactSet(int NewCases, int ActiveCases, int CriticalCases, int OutstandingCases,
    IReadOnlyList<BriefingNeed> Needs, int LowStockItems, int OpenShelters, long Capacity, long Occupied,
    long Reserved, int ActiveVolunteerTasks, int TasksAwaitingReview, int EscalatedCases);
public sealed record BriefingNeed(AidCategory Category, int Cases, decimal? OutstandingQuantity, string? Unit = null);
public sealed record BriefingView(CrisisBriefing Record, BriefingFactSet Facts);
public sealed record DecisionWorkspace(string Name, string CountryCode, string? Region, IReadOnlyList<ForecastView> Forecasts,
    IReadOnlyList<BriefingView> Briefings, IReadOnlyList<InvestigationFlag> Flags);

public sealed class DecisionSupportService(IStore store, AccessService access, Operations operations, IAiProvider ai)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly RequestStatus[] Terminal = [RequestStatus.Closed, RequestStatus.Fulfilled, RequestStatus.Rejected, RequestStatus.Cancelled];

    public async Task<DecisionWorkspace> Workspace(Guid crisisId, CancellationToken ct)
    {
        var crisis = await Scope(crisisId, ct);
        var reviewer = await access.CountryAccess(crisis.CountryCode, [], ct);
        var forecasts = await store.ListAsync(store.Query<DemandForecast>().Where(f => f.CrisisId == crisis.Id && (reviewer || f.CreatedByUserId == access.UserId))
            .OrderByDescending(f => f.CreatedAt).Take(30), ct);
        var briefings = await store.ListAsync(store.Query<CrisisBriefing>().Where(f => f.CrisisId == crisis.Id && (reviewer || f.CreatedByUserId == access.UserId))
            .OrderByDescending(f => f.CreatedAt).Take(20), ct);
        var requests = (await access.Visible(ct)).Where(r => r.CrisisId == crisis.Id);
        var flags = await store.ListAsync(store.Query<InvestigationFlag>().Where(f => requests.Any(r => r.Id == f.RequestId))
            .OrderBy(f => f.ReviewedAt != null).ThenByDescending(f => f.CreatedAt).Take(100), ct);
        var region = crisis.AdministrativeDivisionId is Guid id ? await store.FindAsync<AdministrativeDivision>(id, ct) : null;
        return new(crisis.Name, crisis.CountryCode, region?.Name, forecasts.Select(View).ToList(), briefings.Select(View).ToList(), flags);
    }

    public Task<ForecastView> Forecast(Guid crisisId, ForecastInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var crisis = await Scope(crisisId, ct);
        if (!Enum.IsDefined(input.Category)) throw new RuleException("Choose a valid category.");
        var now = DateTimeOffset.UtcNow;
        var monday = new DateTimeOffset(now.UtcDateTime.Date.AddDays(-((7 + (int)now.DayOfWeek - (int)DayOfWeek.Monday) % 7)), TimeSpan.Zero);
        var observedFrom = monday.AddDays(-56);
        var cases = (await access.Visible(ct)).Where(r => r.CrisisId == crisis.Id && r.Category == input.Category &&
            r.Status != RequestStatus.Rejected && r.Status != RequestStatus.Cancelled);
        var requests = await store.ListAsync(cases.Where(r => r.CreatedAt >= observedFrom && r.CreatedAt < monday)
            .Select(r => new { r.CreatedAt, r.Quantity, r.Unit, r.AdministrativeDivisionId }), ct);
        var receipts = await store.ListAsync(
            from receipt in store.Query<DeliveryConfirmation>()
            join shipment in store.Query<ResourceAllocation>() on receipt.AllocationId equals (Guid?)shipment.Id
            join request in cases on shipment.RequestId equals request.Id
            join stock in store.Query<Resource>() on shipment.ResourceId equals stock.Id
            where receipt.ReceivedAt >= observedFrom && receipt.ReceivedAt < monday && request.Unit != null && shipment.RequestQuantity != null
            select new { receipt.ReceivedAt, receipt.ConfirmedQuantity, StockUnit = stock.Unit, request.Unit, request.AdministrativeDivisionId }, ct);
        var inventory = await store.ListAsync((await access.Located<Resource>(ct, crisis.Id)).Where(r => r.CountryCode == crisis.CountryCode &&
            r.Category == input.Category && r.TransportAvailable && r.Stock > r.Reserved).Select(r => r.Unit), ct);
        var demand = requests.Where(r => r.Unit != null).ToLookup(r => (r.AdministrativeDivisionId, Unit: QuantityUnits.BaseUnit(r.Unit)));
        var fulfilled = receipts.Where(r => QuantityUnits.Compatible(r.StockUnit, r.Unit))
            .ToLookup(r => (r.AdministrativeDivisionId, Unit: QuantityUnits.BaseUnit(r.Unit)));
        var keys = demand.Select(g => g.Key).Union(fulfilled.Select(g => g.Key)).ToList();
        var regionIds = keys.Select(key => key.AdministrativeDivisionId).OfType<Guid>().Distinct().ToArray();
        var divisions = (await store.ListAsync(store.Query<AdministrativeDivision>()
            .Where(r => r.CountryCode == crisis.CountryCode && regionIds.Contains(r.Id)), ct))
            .ToDictionary(r => r.Id, r => r.Name);
        var starts = Enumerable.Range(0, 8).Select(i => observedFrom.AddDays(i * 7)).ToList();
        var weeks = starts.Select(start => new DemandWeek(start, requests.Count(r => InWeek(r.CreatedAt, start)), null, null)).ToList();
        var groups = keys.OrderBy(k => k.AdministrativeDivisionId).ThenBy(k => k.Unit)
            .Select(key =>
            {
                var series = starts.Select(start =>
                {
                    var samples = demand[key].Where(r => InWeek(r.CreatedAt, start)).ToList();
                    return new DemandWeek(start, samples.Count, samples.Sum(r => QuantityUnits.Convert(r.Quantity, r.Unit, key.Unit)),
                        fulfilled[key].Where(r => InWeek(r.ReceivedAt, start)).Sum(r => QuantityUnits.Convert(r.ConfirmedQuantity, r.StockUnit, key.Unit)));
                }).ToList();
                return new DemandGroup(key.AdministrativeDivisionId, divisions.GetValueOrDefault(key.AdministrativeDivisionId ?? Guid.Empty), key.Unit, series,
                    series.Sum(w => w.Requests) >= 8 && series.Count(w => w.Requests > 0) >= 4
                        ? decimal.Round(series.Sum(w => w.Requested ?? 0) / series.Count, 2) : null);
            }).ToList();
        var demandUnits = demand.Select(group => group.Key.Unit).ToHashSet();
        var items = inventory.Count(unit => demandUnits.Contains(QuantityUnits.BaseUnit(unit)));
        var sufficient = requests.Count >= 8 && weeks.Count(w => w.Requests > 0) >= 4;
        var risk = demand.Count == 0 ? "No comparable request quantities in the observation period" :
            items == 0 ? "No compatible transport-ready stock in your scope" : "Compatible stock exists in your scope";
        var evidence = new ForecastEvidence(weeks, sufficient ? weeks.Min(w => w.Requests) : null, sufficient ? weeks.Max(w => w.Requests) : null,
            items, risk, "Eight complete UTC weeks. Quantities are grouped by recorded request region and compatible unit. Cases with unknown units are counted separately. Material receipt quantities use confirmed deliveries.", groups,
            requests.Count(r => r.Unit == null));
        var record = new DemandForecast { CrisisId = crisis.Id, RegionId = crisis.AdministrativeDivisionId, Category = input.Category,
            ObservedFrom = observedFrom, ForecastFrom = monday, ForecastTo = monday.AddDays(7), Model = "weekly-request-and-unit-mean-v2",
            Estimate = sufficient ? decimal.Round((decimal)requests.Count / weeks.Count, 2) : null, InputsJson = JsonSerializer.Serialize(evidence, Json),
            CreatedByUserId = access.UserId };
        store.Add(record);
        operations.Audit("DemandForecastCalculated", record, input.Category.ToString(), crisis.CountryCode);
        return new ForecastView(record, evidence);
    }, ct);

    private static bool InWeek(DateTimeOffset time, DateTimeOffset start) => time >= start && time < start.AddDays(7);

    public async Task<BriefingView> Briefing(Guid crisisId, BriefingInput input, CancellationToken ct)
    {
        var crisis = await Scope(crisisId, ct);
        var now = DateTimeOffset.UtcNow;
        var from = now.AddDays(-input.Days);
        var cases = store.Query<AssistanceRequest>().Where(r => r.CrisisId == crisis.Id);
        var recorded = await store.ListAsync(cases.Select(r => new { r.CreatedAt, r.Status, r.Category, r.Priority, r.Escalated, r.Quantity, r.DeliveredQuantity, r.Unit }), ct);
        var active = recorded.Where(r => !Terminal.Contains(r.Status)).ToList();
        var needs = active.Where(r => r.Quantity > r.DeliveredQuantity).GroupBy(r => (r.Category, Unit: QuantityUnits.BaseUnit(r.Unit)))
            .Select(group => new BriefingNeed(group.Key.Category, group.Count(), group.Key.Unit.Length == 0 ? null :
                group.Sum(r => QuantityUnits.Convert(r.Quantity - r.DeliveredQuantity, r.Unit, group.Key.Unit)), group.Key.Unit)).ToList();
        var stock = await store.ListAsync((await access.Located<Resource>(ct, crisis.Id)).Where(r => r.CountryCode == crisis.CountryCode &&
            (r.Stock <= r.Reserved || r.Stock - r.Reserved <= r.LowStockThreshold)).Select(r => r.Id), ct);
        var shelters = await store.ListAsync((await access.Located<Shelter>(ct, crisis.Id)).Where(s => s.CountryCode == crisis.CountryCode && s.Open)
            .Select(s => new { s.Capacity, s.Occupancy, s.Reserved }), ct);
        var tasks = await store.ListAsync(store.Query<VolunteerTask>().Where(t => cases.Any(r => r.Id == t.RequestId)).Select(t => t.Status), ct);
        var facts = new BriefingFactSet(recorded.Count(r => r.CreatedAt >= from && r.CreatedAt <= now), active.Count,
            active.Count(r => r.Priority == Priority.Critical), needs.Sum(n => n.Cases), needs, stock.Count, shelters.Count,
            shelters.Sum(s => (long)s.Capacity), shelters.Sum(s => (long)s.Occupancy), shelters.Sum(s => (long)s.Reserved),
            tasks.Count(s => s is VolunteerStatus.Assigned or VolunteerStatus.Accepted or VolunteerStatus.InProgress or VolunteerStatus.Returned),
            tasks.Count(s => s == VolunteerStatus.AwaitingVerification), active.Count(r => r.Escalated));
        // The optional provider receives only aggregate counts. Internal facts and draft text remain separate.
        var generated = await ai.DraftBriefingAsync(new BriefingCounts(facts.ActiveCases, facts.CriticalCases, facts.OutstandingCases,
            facts.LowStockItems, facts.Capacity, facts.Occupied, facts.Reserved, facts.ActiveVolunteerTasks, facts.EscalatedCases), ct);
        return await store.TransactionAsync(async () =>
        {
            await Scope(crisisId, ct);
            var record = new CrisisBriefing { CrisisId = crisis.Id, PeriodFrom = from, PeriodTo = now, FactsJson = JsonSerializer.Serialize(facts, Json),
                Source = generated?.Source ?? "Deterministic fallback · briefing-rules-v1",
                Draft = generated?.Text ?? SuggestedActions(facts), CreatedByUserId = access.UserId };
            store.Add(record);
            operations.Audit("CrisisBriefingDrafted", record, record.Source, crisis.CountryCode);
            return new BriefingView(record, facts);
        }, ct);
    }

    public Task<BriefingView> Review(Guid crisisId, Guid id, ReviewNote input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var crisis = await Scope(crisisId, ct);
        var record = await store.FindAsync<CrisisBriefing>(id, ct) ?? throw new MissingException();
        if (record.CrisisId != crisisId) throw new MissingException();
        if (record.CreatedByUserId == access.UserId || !await access.CountryAccess(crisis.CountryCode, [], ct)) throw new AccessDeniedException();
        if (record.ReviewedAt != null) throw new RuleException("This briefing already has a review.");
        record.ReviewerUserId = access.UserId;
        record.ReviewedAt = DateTimeOffset.UtcNow;
        record.ReviewNote = Reason(input.Reason);
        operations.Audit("CrisisBriefingReviewed", record, record.ReviewNote, crisis.CountryCode);
        return View(record);
    }, ct);

    public Task<int> Scan(Guid crisisId, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var crisis = await Scope(crisisId, ct);
        var requests = (await access.Visible(ct)).Where(r => r.CrisisId == crisis.Id && !Terminal.Contains(r.Status));
        var cases = await store.ListAsync(requests.Select(r => new { r.Id, r.Quantity, r.Category, r.HouseholdSize, r.RequestedForSomeoneElse, r.RequesterRelationship }), ct);
        var duplicates = await store.ListAsync(store.Query<PotentialDuplicate>().Where(d => d.State == "Pending" &&
            requests.Any(r => r.Id == d.RequestId) && requests.Any(r => r.Id == d.CandidateId)).Select(d => d.RequestId).Distinct(), ct);
        var previous = await store.ListAsync(store.Query<InvestigationFlag>().Where(f => requests.Any(r => r.Id == f.RequestId)), ct);
        var keys = previous.Select(f => (f.RequestId!.Value, f.Category)).ToHashSet();
        int inserted = 0;
        foreach (var id in duplicates)
            Add(id, "Potential duplicate", InvestigationSeverity.Advisory, "A pending near-duplicate match exists within the crisis. Compare the scoped cases before deciding.");
        foreach (var group in cases.GroupBy(r => r.Category))
        {
            var normal = group.OrderBy(r => r.Quantity).ElementAt(group.Count() / 2).Quantity;
            foreach (var item in group)
            {
                if (group.Count() >= 5 && item.Quantity >= 10 && item.Quantity > 4 * normal)
                    Add(item.Id, "Unusual quantity", InvestigationSeverity.Elevated, "Requested quantity exceeds four times the active-case median for this category. Units and household need require review.");
                if (item.RequestedForSomeoneElse && string.IsNullOrWhiteSpace(item.RequesterRelationship))
                    Add(item.Id, "Missing representative context", InvestigationSeverity.Advisory, "The request was submitted on behalf of another person without a recorded relationship.");
            }
        }
        return inserted;
        void Add(Guid id, string category, InvestigationSeverity severity, string evidence)
        {
            if (!keys.Add((id, category))) return;
            var flag = new InvestigationFlag { RequestId = id, Category = category, Evidence = evidence, Severity = severity };
            store.Add(flag);
            operations.Audit("InvestigationFlagRaised", flag, category, crisis.CountryCode);
            inserted++;
        }
    }, ct);

    public Task<InvestigationFlag> Resolve(Guid crisisId, Guid id, InvestigationReview input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var crisis = await Scope(crisisId, ct);
        var flag = await store.FindAsync<InvestigationFlag>(id, ct) ?? throw new MissingException();
        var request = flag.RequestId is Guid requestId ? await access.Request(requestId, ct: ct) : throw new MissingException();
        if (request.CrisisId != crisisId) throw new MissingException();
        ResolveFlag(flag, input, crisis.CountryCode);
        return flag;
    }, ct);

    internal void ResolveFlag(InvestigationFlag flag, InvestigationReview input, string country)
    {
        if (flag.ReviewedAt != null) throw new RuleException("This flag already has a recorded decision.");
        flag.Outcome = input.Outcome;
        flag.Resolution = Reason(input.Reason);
        flag.ReviewedAt = DateTimeOffset.UtcNow;
        flag.ReviewerUserId = access.UserId;
        operations.Audit("InvestigationFlagReviewed", flag, flag.Resolution, country);
    }

    private async Task<Crisis> Scope(Guid id, CancellationToken ct)
    {
        var crisis = await store.FindAsync<Crisis>(id, ct) ?? throw new MissingException();
        if (access.SelectedCountry is string selected && selected != crisis.CountryCode || !await access.Coordinates(id, ct))
            throw new AccessDeniedException();
        return crisis;
    }

    private static ForecastView View(DemandForecast record)
    {
        var evidence = JsonSerializer.Deserialize<ForecastEvidence>(record.InputsJson, Json)!;
        if (evidence.Groups is null)
            evidence = evidence with { Weeks = evidence.Weeks.Select(w => w with { Requested = null, Fulfilled = null }).ToList() };
        return new(record, evidence);
    }
    private static BriefingView View(CrisisBriefing record) => new(record, JsonSerializer.Deserialize<BriefingFactSet>(record.FactsJson, Json)!);
    private static string Reason(string value) => !string.IsNullOrWhiteSpace(value) ? value.Trim() : throw new RuleException("Enter a review reason.");

    private static string SuggestedActions(BriefingFactSet facts)
    {
        var actions = new List<string>();
        if (facts.CriticalCases + facts.EscalatedCases > 0) actions.Add("Review critical and escalated cases first.");
        if (facts.LowStockItems > 0) actions.Add("Check whether replenishment or a verified partner handoff is required.");
        if (facts.Reserved > 0) actions.Add("Confirm shelter arrivals against active reservations.");
        if (facts.TasksAwaitingReview > 0) actions.Add("Assign independent reviewers to pending volunteer reports.");
        if (actions.Count == 0) actions.Add("Review newly submitted cases and confirm readiness at the next operations check.");
        return string.Join(" ", actions);
    }
}
