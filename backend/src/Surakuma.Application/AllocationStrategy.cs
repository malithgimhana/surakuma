using Surakuma.Domain;

namespace Surakuma.Application;

public sealed record AllocationDemand(AssistanceRequest Request, decimal Committed, DateTimeOffset WaitingSince);
public sealed record RankedResource(Guid ResourceId, string Name, string Unit, decimal Available, decimal SuggestedQuantity, double Score, double? DistanceKm, bool TransportAvailable, bool ShortForRequest, string Reason);
public sealed record AllocationRecommendations(decimal Outstanding, IReadOnlyList<RankedResource> Candidates, bool Shortage, int QueuePosition, int CompetingRequests, string ShortageExplanation);

public interface IAllocationStrategy
{
    AllocationRecommendations Recommend(AssistanceRequest request, decimal committed, IReadOnlyList<Resource> resources, IReadOnlyList<AllocationDemand> competing);
}

public sealed class RankedAllocationStrategy : IAllocationStrategy
{
    public AllocationRecommendations Recommend(AssistanceRequest request, decimal committed, IReadOnlyList<Resource> resources, IReadOnlyList<AllocationDemand> competing)
    {
        decimal outstanding = Math.Max(0, request.Quantity - request.DeliveredQuantity - committed);
        var words = Tokens(request.Description + " " + request.AccessibilityNeeds);
        var candidates = resources.Where(x => x.Category == request.Category && x.Available > 0 && outstanding > 0).Select(resource =>
        {
            decimal suggested = Math.Min(outstanding, resource.Available);
            double coverage = (double)(suggested / outstanding);
            double? distance = request.Latitude.HasValue && request.Longitude.HasValue ? Distance(request.Latitude.Value, request.Longitude.Value, resource.Latitude, resource.Longitude) : null;
            var suitability = Tokens(resource.Name + " " + resource.Suitability);
            int matches = suitability.Intersect(words).Count();
            double urgency = (int)request.Priority * 3;
            double score = (resource.TransportAvailable ? 30 : 0) + coverage * 35 + Math.Min(matches, 5) * 3 + (distance.HasValue ? 15 / (1 + distance.Value / 25) : 0) + urgency;
            string reason = $"Category matches; {resource.Available:0.##} {resource.Unit} available for {outstanding:0.##} outstanding; " +
                (resource.TransportAvailable ? "transport available" : "transport unavailable (not reservable)") +
                $"; {matches} suitability word matches; " + (distance.HasValue ? $"{distance.Value:0.0} km straight-line distance" : "request coordinates unavailable") +
                $"; priority {request.Priority}. Staff must verify suitability.";
            return new RankedResource(resource.Id, resource.Name, resource.Unit, resource.Available, suggested, Math.Round(score, 2), distance.HasValue ? Math.Round(distance.Value, 1) : null, resource.TransportAvailable, resource.Available < outstanding, reason);
        }).OrderByDescending(x => x.TransportAvailable).ThenByDescending(x => x.Score).ThenBy(x => x.ResourceId).ToList();
        var queue = competing.Where(x => x.Request.Category == request.Category && x.Request.CrisisId == request.CrisisId && x.Request.OrganisationId == request.OrganisationId && x.Request.Status is RequestStatus.Approved or RequestStatus.InProgress or RequestStatus.PartiallyFulfilled)
            .Where(x => x.Request.Quantity - x.Request.DeliveredQuantity - x.Committed > 0)
            .OrderByDescending(x => x.Request.Priority).ThenBy(x => x.WaitingSince).ThenBy(x => x.Request.CreatedAt).ThenBy(x => x.Request.Id).ToList();
        int index = queue.FindIndex(x => x.Request.Id == request.Id);
        decimal demand = queue.Sum(x => Math.Max(0, x.Request.Quantity - x.Request.DeliveredQuantity - x.Committed));
        // Units on requests are not recorded; use each resource separately, never sum unlike units.
        decimal bestStock = candidates.Where(x => x.TransportAvailable).Select(x => x.Available).DefaultIfEmpty(0).Max();
        bool shortage = demand > bestStock && demand > 0;
        string explanation = index < 0
            ? "This request is not in the approved allocation queue. Shortage across competing requests cannot yet be assessed for it; compare its outstanding quantity with available stock after assignment and approval."
            : shortage
            ? $"Potential shortage: {queue.Count} eligible same-category requests need {demand:0.##} in total; the largest transport-ready resource has {bestStock:0.##}. Prioritise by urgency, approval wait, creation time and ID; escalate for review. Request units are not recorded, so staff must verify comparability."
            : "No shortage identified against the largest transport-ready resource. Request units are not recorded; staff must verify comparability.";
        return new(outstanding, candidates, shortage, index < 0 ? 0 : index + 1, queue.Count, explanation);
    }
    private static HashSet<string> Tokens(string text) => text.ToLowerInvariant().Split([' ', ',', '.', ';', ':', '/', '-', '\n', '\r'], StringSplitOptions.RemoveEmptyEntries).Where(x => x.Length >= 4).ToHashSet();
    private static double Distance(double lat1, double lon1, double lat2, double lon2)
    {
        const double radius = 6371;
        double a = Math.Pow(Math.Sin((lat2 - lat1) * Math.PI / 360), 2) + Math.Cos(lat1 * Math.PI / 180) * Math.Cos(lat2 * Math.PI / 180) * Math.Pow(Math.Sin((lon2 - lon1) * Math.PI / 360), 2);
        return radius * 2 * Math.Asin(Math.Min(1, Math.Sqrt(a)));
    }
}
