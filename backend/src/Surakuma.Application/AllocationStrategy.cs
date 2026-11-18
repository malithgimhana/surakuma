using Surakuma.Domain;

namespace Surakuma.Application;

public sealed record AllocationDemand(AssistanceRequest Request, decimal Committed, DateTimeOffset WaitingSince);
public sealed record RankedResource(Guid ResourceId, string Name, string Unit, decimal Available, decimal SuggestedQuantity, double Score, double? DistanceKm, bool TransportAvailable, bool ShortForRequest, string Reason, decimal AvailableInRequestUnit, decimal RemainingAfterReservation);
public sealed record AllocationRecommendations(decimal Outstanding, IReadOnlyList<RankedResource> Candidates, bool Shortage, int QueuePosition, int CompetingRequests, string ShortageExplanation, string? Unit, bool UnitRequiresClarification);

public interface IAllocationStrategy
{
    AllocationRecommendations Recommend(AssistanceRequest request, decimal committed, IReadOnlyList<Resource> resources, IReadOnlyList<AllocationDemand> competing);
}

public sealed class RankedAllocationStrategy : IAllocationStrategy
{
    public AllocationRecommendations Recommend(AssistanceRequest request, decimal committed, IReadOnlyList<Resource> resources, IReadOnlyList<AllocationDemand> competing)
    {
        decimal outstanding = Math.Max(0, request.Quantity - request.DeliveredQuantity - committed);
        if (request.UnitRequiresClarification || request.Category == AidCategory.Shelter)
            return new(outstanding, [], false, 0, 0, request.UnitRequiresClarification
                ? "Confirm the requested unit before assessing stock or reserving aid."
                : "Use the household placement workflow for this request.", request.Unit, request.UnitRequiresClarification);
        var words = Tokens(request.Description + " " + request.AccessibilityNeeds);
        var compatible = resources.Where(x => x.Category == request.Category && x.Available > 0 && QuantityUnits.Compatible(x.Unit, request.Unit)).ToList();
        var candidates = compatible.Where(_ => outstanding > 0).Select(resource =>
        {
            decimal available = QuantityUnits.Convert(resource.Available, resource.Unit, request.Unit);
            decimal suggested = QuantityUnits.FloorToInventory(Math.Min(QuantityUnits.Convert(outstanding, request.Unit, resource.Unit), resource.Available), resource.Unit);
            decimal remaining = outstanding - QuantityUnits.Convert(suggested, resource.Unit, request.Unit);
            double coverage = (double)(1 - remaining / outstanding);
            double? distance = request.Latitude.HasValue && request.Longitude.HasValue ? Distance(request.Latitude.Value, request.Longitude.Value, resource.Latitude, resource.Longitude) : null;
            var suitability = Tokens(resource.Name + " " + resource.Suitability);
            int matches = suitability.Intersect(words).Count();
            double urgency = (int)request.Priority * 3;
            double score = (resource.TransportAvailable ? 30 : 0) + coverage * 35 + Math.Min(matches, 5) * 3 + (distance.HasValue ? 15 / (1 + distance.Value / 25) : 0) + urgency;
            string reason = $"Category and unit match; {available:0.#####} {request.Unit} available for {outstanding:0.#####} {request.Unit} outstanding; " +
                (resource.TransportAvailable ? "transport available" : "transport unavailable (not reservable)") +
                $"; {matches} suitability word matches; " + (distance.HasValue ? $"{distance.Value:0.0} km straight-line distance" : "request coordinates unavailable") +
                $"; priority {request.Priority}. Staff must verify suitability.";
            return new RankedResource(resource.Id, resource.Name, resource.Unit, resource.Available, suggested, Math.Round(score, 2), distance.HasValue ? Math.Round(distance.Value, 1) : null, resource.TransportAvailable, remaining > 0, reason, available, remaining);
        }).Where(x => x.SuggestedQuantity > 0).OrderByDescending(x => x.TransportAvailable).ThenByDescending(x => x.Score).ThenBy(x => x.ResourceId).ToList();
        var queue = competing.Where(x => x.Request.Category == request.Category && x.Request.CrisisId == request.CrisisId && x.Request.OrganisationId == request.OrganisationId && x.Request.Status is RequestStatus.Approved or RequestStatus.InProgress or RequestStatus.PartiallyFulfilled)
            .Where(x => QuantityUnits.Compatible(x.Request.Unit, request.Unit) && x.Request.Quantity - x.Request.DeliveredQuantity - x.Committed > 0)
            .OrderByDescending(x => x.Request.Priority).ThenBy(x => x.WaitingSince).ThenBy(x => x.Request.CreatedAt).ThenBy(x => x.Request.Id).ToList();
        int index = queue.FindIndex(x => x.Request.Id == request.Id);
        decimal demand = queue.Sum(x => QuantityUnits.Convert(x.Request.Quantity - x.Request.DeliveredQuantity - x.Committed, x.Request.Unit, request.Unit));
        var readyStock = compatible.Where(x => x.TransportAvailable && x.OrganisationId == request.OrganisationId).ToList();
        decimal stock = readyStock.Sum(x => QuantityUnits.Convert(x.Available, x.Unit, request.Unit));
        var baseUnit = QuantityUnits.BaseUnit(request.Unit);
        // Hundredths of a kg or litre can cover only multiples of ten grams or millilitres.
        bool precisionShortage = QuantityUnits.IsMeasured(request.Unit) &&
            queue.Sum(x => QuantityUnits.Convert(x.Request.Quantity - x.Request.DeliveredQuantity - x.Committed, x.Request.Unit, baseUnit) % 10m) >
            readyStock.Where(x => QuantityUnits.Normalize(x.Unit) == baseUnit).Sum(x => x.Available);
        bool shortage = index >= 0 && (demand > stock || precisionShortage);
        string explanation = index < 0
            ? "This request is not in the approved allocation queue. Shortage across competing requests cannot yet be assessed for it; compare its outstanding quantity with available stock after assignment and approval."
            : precisionShortage
            ? $"Available inventory cannot reserve the exact quantities required by the queue in {request.Unit}. Use stock recorded in {baseUnit} for the small quantities."
            : shortage
            ? $"Potential shortage: {queue.Count} eligible cases need {demand:0.#####} {request.Unit} in total; the assigned organisation has {stock:0.#####} {request.Unit} in compatible transport-ready stock. Prioritise by urgency and waiting time. Escalate for review if needed."
            : $"{stock:0.#####} {request.Unit} of compatible stock is available against {demand:0.#####} {request.Unit} of queued demand. Check product suitability before reserving.";
        return new(outstanding, candidates, shortage, index < 0 ? 0 : index + 1, queue.Count, explanation, request.Unit, false);
    }
    private static HashSet<string> Tokens(string text) => text.ToLowerInvariant().Split([' ', ',', '.', ';', ':', '/', '-', '\n', '\r'], StringSplitOptions.RemoveEmptyEntries).Where(x => x.Length >= 4).ToHashSet();
    internal static double Distance(double lat1, double lon1, double lat2, double lon2)
    {
        const double radius = 6371;
        double a = Math.Pow(Math.Sin((lat2 - lat1) * Math.PI / 360), 2) + Math.Cos(lat1 * Math.PI / 180) * Math.Cos(lat2 * Math.PI / 180) * Math.Pow(Math.Sin((lon2 - lon1) * Math.PI / 360), 2);
        return radius * 2 * Math.Asin(Math.Min(1, Math.Sqrt(a)));
    }
}
