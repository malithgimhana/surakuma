using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Surakuma.Domain;

namespace Surakuma.Api.Reporting;

public record ReportCounts(int ActiveCrises, int Submitted, int Open, int Unassigned, int Overdue, int Resolved)
{
    public static ReportCounts Total(IEnumerable<ReportCounts> rows) =>
        rows.Aggregate(new ReportCounts(0, 0, 0, 0, 0, 0), (total, row) => new(
            total.ActiveCrises + row.ActiveCrises, total.Submitted + row.Submitted,
            total.Open + row.Open, total.Unassigned + row.Unassigned,
            total.Overdue + row.Overdue, total.Resolved + row.Resolved));

    internal int[] ExportValues() => [ActiveCrises, Submitted, Open, Unassigned, Overdue, Resolved];
}

public sealed record ReportCountry(string CountryCode, string Country, int ActiveCrises, int Submitted,
    int Open, int Unassigned, int Overdue, int Resolved)
    : ReportCounts(ActiveCrises, Submitted, Open, Unassigned, Overdue, Resolved);

public sealed record ReportStock(string CountryCode, AidCategory Category, string Name, string Unit, decimal Stock, decimal Reserved)
{
    public decimal Available => Stock - Reserved;
}

public sealed record ReportCrisis(Guid Id, string Name, string CountryCode);
public sealed record SubmittedComparison(DateTimeOffset From, DateTimeOffset To, int Submitted, decimal? PercentChange);

public sealed record OperationalReport(DateTimeOffset GeneratedAt, string Scope, DateTimeOffset? From, DateTimeOffset? To,
    ReportCrisis? Crisis, ReportCounts Totals, IReadOnlyList<ReportCountry> Countries,
    IReadOnlyList<ReportStock> Stock, SubmittedComparison? PreviousPeriod)
{
    public string Timezone => "UTC";
    public string Definition => "Cases are filtered by submission date and show their current status. Active crises and stock are current snapshots.";

    // Exclude the generation time so that a fresh export is valid whenever its data matches the displayed report.
    public string Version => Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(
        new { Scope, From, To, Crisis, Totals, Countries, Stock, PreviousPeriod })));

    internal string PeriodLabel => From is { } first && To is { } end
        ? $"{Utc(first)} to {Utc(end)} (exclusive)"
        : "All submission dates";

    internal static string Utc(DateTimeOffset date) =>
        date.UtcDateTime.ToString("dd MMM yyyy, HH:mm:ss 'UTC'", CultureInfo.InvariantCulture);

    internal static string CategoryLabel(AidCategory category) => category switch
    {
        AidCategory.FoodWater => "Food & water",
        AidCategory.Medical => "Medical help",
        AidCategory.Shelter => "Shelter supplies",
        AidCategory.Transportation => "Transport",
        AidCategory.Accessibility => "Accessibility",
        _ => category.ToString(),
    };

    internal static readonly string[] MetricNames =
        ["Active crises", "Requests submitted", "Open", "Unassigned", "Overdue", "Resolved"];

    internal static readonly (string Name, string Definition)[] MetricDefinitions =
    [
        ("Active crises", "Crises currently marked active within the selected country and crisis scope."),
        ("Requests submitted", "All requests submitted during the reporting period, regardless of current status."),
        ("Open cases", "Requests excluding fulfilled, closed, rejected and cancelled cases."),
        ("Unassigned cases", "Open cases missing a response centre, a case manager, or both."),
        ("Overdue cases", "Cases still open more than 24 hours after submission."),
        ("Resolved cases", "Requests currently marked fulfilled or closed."),
        ("Stock", "Current inventory across the selected countries. Available is stock on hand minus reserved. Each resource and unit is counted separately."),
        ("Comparisons", "Submitted requests can be compared with the immediately preceding period of equal length when it had submissions. Historical status, crisis activity and inventory snapshots are unavailable."),
    ];
}
