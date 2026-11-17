using System.Globalization;
using System.Text;

namespace Surakuma.Api.Reporting;

internal static class OperationalReportCsv
{
    public static byte[] Render(OperationalReport report)
    {
        var csv = new StringBuilder();
        void Row(params object[] cells) => csv.AppendJoin(',', cells.Select(Cell)).Append("\r\n");
        void Counts(string code, string country, ReportCounts values) => Row(code, country, values.ActiveCrises,
            values.Submitted, values.Open, values.Unassigned, values.Overdue, values.Resolved);

        Row("Surakuma", "Operational reports");
        Row("Report scope", report.Scope);
        Row("Countries", string.Join(", ", report.Countries.Select(c => c.Country)));
        Row("Crisis", report.Crisis is { } crisis ? $"{crisis.Name} ({crisis.CountryCode})" : "All crises");
        Row("Reporting period", report.PeriodLabel);
        Row("Generated at UTC", report.GeneratedAt.ToString("O", CultureInfo.InvariantCulture));
        Row();
        Row("Operational KPI summary");
        foreach (var (label, value) in OperationalReport.MetricNames.Zip(report.Totals.ExportValues()))
            Row(label, value);
        if (report.PreviousPeriod is { PercentChange: { } change } previous)
        {
            Row("Previous period (UTC, exclusive end)", $"{OperationalReport.Utc(previous.From)} to {OperationalReport.Utc(previous.To)}");
            Row("Previous period requests submitted", previous.Submitted);
            Row("Requests submitted change (%)", change);
        }
        Row();
        Row("Country performance");
        Row("Country code", "Country", "Active crises", "Submitted", "Open", "Unassigned", "Overdue", "Resolved");
        foreach (var country in report.Countries)
            Counts(country.CountryCode, country.Country, country);
        if (report.Scope != "Selected country")
            Counts("", "Total", report.Totals);
        Row();
        Row("Current stock snapshot");
        Row("Country code", "Country", "Resource", "Category", "Unit", "On hand", "Reserved", "Available");
        var countries = report.Countries.ToDictionary(c => c.CountryCode, c => c.Country);
        foreach (var item in report.Stock)
            Row(item.CountryCode, countries[item.CountryCode], item.Name, OperationalReport.CategoryLabel(item.Category),
                item.Unit, item.Stock, item.Reserved, item.Available);
        if (report.Stock.Count == 0) Row("No stock recorded for this scope.");
        Row();
        Row("Metric definitions and data limitations");
        Row("Reporting method", report.Definition);
        foreach (var item in OperationalReport.MetricDefinitions)
            Row(item.Name, item.Definition);
        return [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(csv.ToString())];
    }

    private static string Cell(object value)
    {
        if (value is decimal quantity) return quantity.ToString("0.##", CultureInfo.InvariantCulture);
        if (value is not string text) return Convert.ToString(value, CultureInfo.InvariantCulture) ?? "";
        // Quote and escape the entire cell, then neutralize spreadsheet formula prefixes.
        var significant = text.AsSpan().TrimStart();
        while (!significant.IsEmpty && (char.IsControl(significant[0]) || significant[0] == '\uFEFF'))
            significant = significant[1..].TrimStart();
        if ((!significant.IsEmpty && significant[0] is '=' or '+' or '-' or '@' or '＝' or '＋' or '－' or '＠')
            || (text.Length > 0 && text[0] is '\t' or '\r' or '\n'))
            text = "'" + text;
        return "\"" + text.Replace("\"", "\"\"") + "\"";
    }
}
