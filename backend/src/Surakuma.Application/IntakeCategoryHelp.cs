using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Surakuma.Domain;

namespace Surakuma.Application;

public sealed record IntakeCategoryClue(string Signal, AidCategory Category);
public sealed record IntakeCategoryAssessment(AidCategory? Category, string? Model = null);
public sealed record IntakeCategoryText(string Description, string CountryCode);
public sealed record IntakeCategoryReceipt(string UserId, string CountryCode, string DraftKey,
    AidCategory? SuggestedCategory, AidCategory[] Options, string Source);

public static partial class IntakeCategoryHelp
{
    public const int HelpDescriptionLimit = 600;
    private sealed record VocabularyEntry(AidCategory Category, string Signal, string[] Terms);
    private static readonly VocabularyEntry[] Vocabulary = LoadVocabulary();

    private static VocabularyEntry[] LoadVocabulary()
    {
        using var stream = typeof(IntakeCategoryHelp).Assembly.GetManifestResourceStream("RequestCategoryVocabulary.json")
            ?? throw new InvalidOperationException("Request category vocabulary is missing.");
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsonStringEnumConverter<AidCategory>());
        return JsonSerializer.Deserialize<VocabularyEntry[]>(stream, options)
            ?? throw new InvalidOperationException("Request category vocabulary is empty.");
    }

    public static IntakeCategoryClue[] Recognise(string description)
    {
        var text = description.Normalize().ToLowerInvariant();
        return Vocabulary.Where(entry => entry.Terms.Any(term => text.Contains(term, StringComparison.Ordinal)))
            .Select(entry => new IntakeCategoryClue(entry.Signal, entry.Category)).ToArray();
    }

    [GeneratedRegex(@"https?://[^\s]+|[^\s@]+@[^\s@]+\.[^\s@]+|\+?\d(?:[\s.()\-]*\d){6,}",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex ContactDetails();

    public static string? ProviderDescription(string description)
    {
        var redacted = ContactDetails().Replace(description.Normalize(), " ").Trim();
        if (redacted.Length == 0) return null;
        return string.Concat(redacted.EnumerateRunes().Take(HelpDescriptionLimit).Select(rune => rune.ToString()));
    }

    public static string Describe(IntakeCategoryReceipt receipt, AidCategory chosen)
    {
        var source = receipt.Source == "OpenAI" ? "AI category guidance" : "Local category guidance";
        var suggestion = receipt.SuggestedCategory is { } category
            ? $"suggested {CategoryName(category)}"
            : $"offered {string.Join(", ", receipt.Options.Select(CategoryName))}";
        return $"{source} {suggestion}. Citizen chose {CategoryName(chosen)}.";
    }

    private static string CategoryName(AidCategory value) => value switch
    {
        AidCategory.FoodWater => "food and water",
        AidCategory.Medical => "medicine and medical support",
        AidCategory.Shelter => "shelter",
        AidCategory.Transportation => "transportation",
        AidCategory.Accessibility => "accessibility support",
        _ => "other support"
    };
}
