using System.Text.RegularExpressions;
using Surakuma.Domain;

namespace Surakuma.Application;

public static partial class AiPresentation
{
    public const string RetiredServicePrefix = "service:generativelanguage.googleapis.com:";

    [GeneratedRegex(@"\b(?:Google\s+)?Gemini(?:[-._][\w.-]+)?\b|\bgenerativelanguage\.googleapis\.com\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex RetiredBrand();

    public static string Text(string value) => RetiredBrand().Replace(value, "a retired AI provider");
    public static string Source(string value) => RetiredBrand().IsMatch(value) ? "Historical AI result" : value;
    public static string Model(string value) => RetiredBrand().IsMatch(value) ? "Retired model" : value;

    public static object Recommendation(Recommendation value) => new
    {
        value.Id, value.CreatedAt, value.UpdatedAt, value.Version, value.RequestId, value.Category, value.Priority,
        Explanation = Text(value.Explanation), Provider = Source(value.Provider), Model = Model(value.Model),
        value.SignalsJson, value.UrgencyFactorsJson, value.UrgencyScore, value.Confidence, value.ConfidenceKind,
        value.Fallback, value.ReviewState
    };
}
