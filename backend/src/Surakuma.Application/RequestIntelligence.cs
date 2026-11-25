using System.Text.Json;
using Surakuma.Domain;

namespace Surakuma.Application;

public sealed record ForecastSummary(string Category, string Method, decimal Estimate, decimal? Lower, decimal? Upper,
    string StockRisk, int Weeks);

public sealed record UrgencyFactor(string Label, int Points);

public static class RequestSignals
{
    private static readonly Dictionary<string, string[]> Terms = new()
    {
        ["food"] = ["food", "rice", "ආහාර", "உணவு", "भोजन", "खाना"],
        ["drinking water"] = ["drinking water", "clean water", "පානීය ජල", "குடிநீர்", "पीने का पानी", "पिउने पानी"],
        ["medicine"] = ["medicine", "medical", "බෙහෙත්", "மருந்து", "दवा", "औषधि"],
        ["evacuation"] = ["evacuat", "rescue", "निकासी", "उद्धार"],
        ["shelter"] = ["shelter", "temporary housing", "தங்குமிடம்", "आश्रय", "आवास"],
        ["step-free access"] = ["step-free", "wheelchair", "रैम्प", "ह्वीलचेयर", "சக்கர நாற்காலி"],
        ["accessible toilet"] = ["accessible toilet", "accessible bathroom"],
        ["electricity"] = ["electricity", "power supply", "विद्युत", "बिजुली"],
        ["infant supplies"] = ["infant", "baby formula", "शिशु", "குழந்தை"],
        ["dietary suitability"] = ["allergy", "allergies", "dietary", "gluten", "एलर्जी"],
        ["cold storage"] = ["refrigerat", "cold chain", "insulin"],
        ["first aid"] = ["first aid", "wound", "प्राथमिक उपचार"],
        ["translation"] = ["interpreter", "translator", "translation", "अनुवाद"],
        ["driving"] = ["driver", "driving", "vehicle transport"],
        ["distribution"] = ["distribut", "hand out", "food pack delivery", "food delivery", "බෙදා", "விநியோகம்", "वितरण"],
        ["shelter setup"] = ["shelter setup", "set up shelter", "assemble tents", "tent installation"],
        ["registration"] = ["registration", "register arrivals", "check in households", "पंजीकरण", "दर्ता"],
        ["immediate danger"] = ["unconscious", "trapped", "cannot breathe", "life threatening", "life-threatening",
            "හුස්ම ගන්න බැ", "சுவாசிக்க முடியவில்லை", "सांस नहीं ले", "सास फेर्न सक्दैन"],
        ["essential supply interruption"] = ["no drinking water", "no food", "ran out of medicine", "பட்டினி", "भूख"]
    };

    public static string[] Allowed => Terms.Keys.ToArray();
    public static string[] Local(string text) => Terms.Where(pair => pair.Value.Any(term =>
        text.Contains(term, StringComparison.OrdinalIgnoreCase))).Select(pair => pair.Key).ToArray();
    public static string[] Validate(IEnumerable<string> values) => values.Where(Terms.ContainsKey).Distinct().Order().ToArray();
    public static string[] Read(string? json) => json is null ? [] : JsonSerializer.Deserialize<string[]>(json) ?? [];

    public static AidCategory Category(AssistanceRequest request, IReadOnlyCollection<string> signals)
    {
        if (signals.Contains("medicine") || signals.Contains("first aid")) return AidCategory.Medical;
        if (signals.Contains("evacuation")) return AidCategory.Transportation;
        if (signals.Contains("shelter")) return AidCategory.Shelter;
        if (signals.Contains("food") || signals.Contains("drinking water")) return AidCategory.FoodWater;
        return request.Category;
    }

    public static (int Score, Priority Priority, IReadOnlyList<UrgencyFactor> Factors) Urgency(
        AssistanceRequest request, AidCategory suggestedCategory, IReadOnlyCollection<string> signals)
    {
        int baseline = request.Priority switch { Priority.Critical => 100, Priority.High => 55, Priority.Normal => 25, _ => 10 };
        var factors = new List<UrgencyFactor> { new($"Reported priority ({request.Priority})", baseline) };
        if (signals.Contains("immediate danger")) factors.Add(new("Immediate danger indicator", 100));
        if (signals.Contains("essential supply interruption")) factors.Add(new("Essential supply interruption", 20));
        if (suggestedCategory is AidCategory.Medical or AidCategory.Transportation) factors.Add(new("Medical or transport need", 15));
        if (!string.IsNullOrWhiteSpace(request.AccessibilityNeeds) || signals.Contains("step-free access"))
            factors.Add(new("Accessibility need", 10));
        if (signals.Contains("infant supplies")) factors.Add(new("Infant supply need", 10));
        // Reserve Critical for explicit emergency indicators or the caller's emergency override.
        var emergency = baseline == 100 || signals.Contains("immediate danger");
        var score = emergency ? 100 : Math.Min(89, factors.Sum(f => f.Points));
        return (score, emergency ? Priority.Critical : score >= 55 ? Priority.High : score >= 25 ? Priority.Normal : Priority.Low, factors);
    }
}

public sealed record AnalysisJobState(string State, int Attempts, string? FailureReason);
public sealed record CaseAnalysis(AiResult Result, string[] Signals, SemanticVector? Embedding);

public sealed class RequestIntelligence(IStore store, IAiProvider provider)
{
    public async Task<CaseAnalysis> Analyze(AssistanceRequest request, CancellationToken ct)
    {
        var result = await provider.RecommendAsync(request, ct);
        if (request.IntakeJson is not null) return new(result, [], null);
        var signals = RequestSignals.Validate((result.Signals ?? []).Concat(
            RequestSignals.Local(request.Description + " " + request.AccessibilityNeeds)));
        return new(result, signals, await provider.EmbedAsync(result.Category, signals, ct));
    }

    public async Task<Recommendation> Save(AssistanceRequest request, CaseAnalysis analysis, IQueryable<AssistanceRequest> scope,
        string actor, CancellationToken ct)
    {
        var decisionIds = store.Query<HumanDecision>().Select(d => d.RecommendationId);
        var drafts = await store.ListAsync(store.Query<Recommendation>().Where(x => x.RequestId == request.Id &&
            x.ReviewState == "Pending" && !decisionIds.Contains(x.Id)), ct);
        foreach (var draft in drafts) store.Remove(draft);

        var result = analysis.Result;
        var publishAdvice = request.IntakeJson is null || !result.Fallback;
        // A model suggestion may identify a shelter need. A separate household request is still required.
        var urgency = request.IntakeJson is null ? RequestSignals.Urgency(request, result.Category, analysis.Signals) :
            (Score: 0, request.Priority, Factors: (IReadOnlyList<UrgencyFactor>)[]);
        var recommendation = new Recommendation { RequestId = request.Id, Category = result.Category, Priority = urgency.Priority,
            Explanation = result.Explanation, Provider = result.Provider, Model = result.Model, Fallback = result.Fallback,
            Confidence = result.Confidence, ConfidenceKind = result.ConfidenceKind ?? "Unavailable",
            SignalsJson = JsonSerializer.Serialize(analysis.Signals), UrgencyScore = request.IntakeJson is null ? urgency.Score : null,
            UrgencyFactorsJson = JsonSerializer.Serialize(urgency.Factors, new JsonSerializerOptions(JsonSerializerDefaults.Web)) };
        if (publishAdvice) store.Add(recommendation);

        var embedding = await store.ListAsync(store.Query<RequestEmbedding>().Where(e => e.RequestId == request.Id), ct);
        if (analysis.Embedding is { } vector)
        {
            var entry = embedding.SingleOrDefault() ?? new RequestEmbedding { RequestId = request.Id };
            if (embedding.Count == 0) store.Add(entry);
            entry.Model = vector.Model;
            entry.Vector = new byte[sizeof(float) * vector.Values.Length];
            Buffer.BlockCopy(vector.Values, 0, entry.Vector, 0, entry.Vector.Length);
        }
        else if (embedding.Count > 0 && recommendation.Category != drafts.FirstOrDefault()?.Category)
            store.Remove(embedding[0]);

        var country = (await store.FindAsync<Crisis>(request.CrisisId, ct))?.CountryCode;
        var since = request.CreatedAt.AddDays(-2);
        var until = request.CreatedAt.AddDays(2);
        var candidates = await store.ListAsync(scope.Where(r => r.Id != request.Id && r.CrisisId == request.CrisisId &&
            (request.OrganisationId != null ? r.OrganisationId == request.OrganisationId : r.CitizenId == request.CitizenId) &&
            r.CreatedAt >= since && r.CreatedAt <= until && r.Status != RequestStatus.Cancelled && r.Status != RequestStatus.Rejected)
            .OrderByDescending(r => r.CreatedAt).ThenBy(r => r.Id).Take(100), ct);
        var candidateIds = candidates.Select(c => c.Id).ToArray();
        var vectors = analysis.Embedding is null ? new Dictionary<Guid, RequestEmbedding>() : (await store.ListAsync(
            store.Query<RequestEmbedding>().Where(e => candidateIds.Contains(e.RequestId) && e.Model == analysis.Embedding.Model), ct))
            .ToDictionary(e => e.RequestId);
        var existing = (await store.ListAsync(store.Query<PotentialDuplicate>()
            .Where(d => d.RequestId == request.Id || (d.CandidateId == request.Id && candidateIds.Contains(d.RequestId))), ct))
            .Select(d => d.RequestId == request.Id ? d.CandidateId : d.RequestId).ToHashSet();
        var flags = await store.ListAsync(store.Query<InvestigationFlag>().Where(f => f.RequestId == request.Id), ct);

        foreach (var candidate in candidates.Where(c => !existing.Contains(c.Id)))
        {
            var days = Math.Abs((request.CreatedAt - candidate.CreatedAt).TotalDays);
            double? km = request.Latitude is double a && request.Longitude is double b && candidate.Latitude is double c && candidate.Longitude is double d
                ? RankedAllocationStrategy.Distance(a, b, c, d) : null;
            var sameRegion = request.AdministrativeDivisionId != null && request.AdministrativeDivisionId == candidate.AdministrativeDivisionId;
            var local = km.HasValue ? km <= 5 : sameRegion;
            var identicalLocation = !string.IsNullOrWhiteSpace(request.LocationText) &&
                string.Equals(request.LocationText.Trim(), candidate.LocationText.Trim(), StringComparison.OrdinalIgnoreCase);
            var locality = local || identicalLocation;
            var lexical = Operations.Similarity(request.Description, candidate.Description);
            double? semantic = vectors.TryGetValue(candidate.Id, out var stored) && analysis.Embedding is { } current
                ? Cosine(current.Values, stored.Vector) : null;
            // Similar topics alone are common during crises. Require independent evidence for semantic matches.
            var sameCitizen = candidate.CitizenId == request.CitizenId;
            var semanticMatch = semantic >= 0.88 && (locality || sameCitizen) &&
                (lexical >= 0.2 || sameCitizen || identicalLocation && lexical >= 0.1) && days <= 1;
            var textMatch = request.Category == candidate.Category && lexical >= 0.35 && (locality || sameCitizen || lexical >= 0.80);
            if (!semanticMatch && !textMatch) continue;
            var basis = semanticMatch ? analysis.Embedding!.Model : "token-overlap-v2";
            var location = km.HasValue ? $"{km.Value:0.0} km apart" : sameRegion ? "same recorded region" :
                identicalLocation ? "matching recorded locality" : "no corroborating location";
            var reason = $"{(semanticMatch ? $"Semantic similarity {semantic:P0}; " : "")}text overlap {lexical:P0}; {location}; " +
                $"{days * 24:0.#} hours apart. Staff comparison required.";
            store.Add(new PotentialDuplicate { RequestId = request.Id, CandidateId = candidate.Id, Model = basis,
                Similarity = semanticMatch ? semantic!.Value : lexical, Reason = reason });
            Flag("Potential duplicate", InvestigationSeverity.Advisory, "A possible match exists within the assigned response scope. Compare the case evidence.");
        }
        if (request.RequestedForSomeoneElse && string.IsNullOrWhiteSpace(request.RequesterRelationship))
            Flag("Missing representative context", InvestigationSeverity.Advisory, "Relationship to the recipient is missing.");
        var repeated = candidates.Count(c => c.CitizenId == request.CitizenId &&
            Math.Abs((request.CreatedAt - c.CreatedAt).TotalHours) <= 6);
        if (repeated >= 4)
            Flag("Rapid repeated submissions", InvestigationSeverity.Advisory,
                $"{repeated + 1} submissions from the same account are recorded within six hours of this request. Check whether separate households or needs explain the pattern.");
        var comparable = candidates.Where(c => c.Category == request.Category && QuantityUnits.Compatible(c.Unit, request.Unit))
            .Select(c => QuantityUnits.Convert(c.Quantity, c.Unit, request.Unit)).Order().ToArray();
        if (comparable.Length >= 5 && request.Quantity >= 10 && request.Quantity > 4 * comparable[comparable.Length / 2])
            Flag("Unusual quantity", InvestigationSeverity.Elevated,
                $"Quantity exceeds four times the recent same-category median of {comparable[comparable.Length / 2]:0.#####} {request.Unit}. Verify the need and unit.");

        if (publishAdvice) Audit("AiGenerated", recommendation, result.Provider);
        return recommendation;

        void Flag(string category, InvestigationSeverity severity, string evidence)
        {
            if (flags.Any(f => f.Category == category)) return;
            var flag = new InvestigationFlag { RequestId = request.Id, Category = category, Severity = severity, Evidence = evidence };
            store.Add(flag);
            flags.Add(flag);
            Audit("InvestigationFlagRaised", flag, category);
        }

        void Audit(string action, Record entity, string detail) => store.Add(new AuditEvent
        {
            Action = action, EntityType = entity.GetType().Name, EntityId = entity.Id,
            ActorId = actor, CountryCode = country, Detail = detail
        });
    }

    private static double? Cosine(float[] current, byte[] bytes)
    {
        if (bytes.Length != current.Length * sizeof(float)) return null;
        var other = new float[current.Length];
        Buffer.BlockCopy(bytes, 0, other, 0, bytes.Length);
        double product = 0, left = 0, right = 0;
        for (int i = 0; i < current.Length; i++)
        {
            product += (double)current[i] * other[i];
            left += (double)current[i] * current[i];
            right += (double)other[i] * other[i];
        }
        return left > 0 && right > 0 ? Math.Clamp(product / Math.Sqrt(left * right), 0, 1) : null;
    }
}
