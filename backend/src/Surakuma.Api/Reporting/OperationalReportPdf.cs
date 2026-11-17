using System.Globalization;
using MigraDoc.DocumentObjectModel;
using MigraDoc.DocumentObjectModel.Tables;
using MigraDoc.Rendering;
using PdfSharp.Fonts;

namespace Surakuma.Api.Reporting;

internal static class OperationalReportPdf
{
    private static readonly Color Navy = Color.FromRgb(18, 33, 58);
    private static readonly Color Slate = Color.FromRgb(60, 79, 106);
    private static readonly Color Blue = Color.FromRgb(23, 101, 219);
    private static readonly Color PaleBlue = Color.FromRgb(233, 242, 253);
    private static readonly Color Rule = Color.FromRgb(217, 227, 240);
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;
    private static readonly Lazy<string> BrandImage = new(() => "base64:" + Convert.ToBase64String(ReadResource("Surakuma.ReportLogo.png")));
    private const string DefaultFont = "Noto Sans";
    private const double PageWidth = 18;

    static OperationalReportPdf() => GlobalFontSettings.FontResolver = new ReportFonts();

    public static byte[] Render(OperationalReport report)
    {
        var document = new Document();
        document.Info.Title = "Surakuma | Operational reports";
        document.Info.Author = "Surakuma";
        document.Styles[StyleNames.Normal]!.Font.Name = DefaultFont;
        document.Styles[StyleNames.Normal]!.Font.Size = 9;
        document.Styles[StyleNames.Normal]!.Font.Color = Navy;
        var section = document.AddSection();
        section.PageSetup.PageFormat = PageFormat.A4;
        section.PageSetup.LeftMargin = Unit.FromCentimeter(1.5);
        section.PageSetup.RightMargin = Unit.FromCentimeter(1.5);
        section.PageSetup.TopMargin = Unit.FromCentimeter(1.35);
        section.PageSetup.BottomMargin = Unit.FromCentimeter(2.2);
        section.PageSetup.FooterDistance = Unit.FromCentimeter(1.2);

        var footer = section.Footers.Primary.AddParagraph("SURAKUMA  /  OPERATIONAL REPORTS");
        footer.Format.Font.Size = 8;
        footer.Format.Font.Color = Slate;
        footer.Format.TabStops.AddTabStop(Unit.FromCentimeter(PageWidth), TabAlignment.Right);
        footer.AddTab();
        footer.AddText("Page ");
        footer.AddPageField();
        footer.AddText(" / ");
        footer.AddNumPagesField();

        var brand = section.AddTable();
        brand.AddColumn(Unit.FromCentimeter(1.12));
        brand.AddColumn(Unit.FromCentimeter(PageWidth - 1.12));
        var lockup = brand.AddRow();
        var image = lockup.Cells[0].AddImage(BrandImage.Value);
        image.Width = Unit.FromCentimeter(.83);
        image.LockAspectRatio = true;
        lockup.Cells[1].VerticalAlignment = VerticalAlignment.Center;
        var wordmark = lockup.Cells[1].AddParagraph("SURAKUMA");
        wordmark.Format.Font.Size = 10;
        wordmark.Format.Font.Bold = true;
        wordmark.Format.Font.Color = Blue;
        var title = section.AddParagraph("Operational reports");
        title.Format.Font.Size = 25;
        title.Format.Font.Bold = true;
        title.Format.SpaceBefore = 9;
        title.Format.SpaceAfter = 8;
        title.Format.KeepWithNext = true;

        var metadata = NewTable(section, 3.1, 14.9);
        AddRow(metadata, ["Scope", report.Scope]);
        AddRow(metadata, ["Countries", string.Join(", ", report.Countries.Select(c => c.Country))]);
        AddRow(metadata, ["Crisis", report.Crisis is { } crisis ? $"{crisis.Name} ({crisis.CountryCode})" : "All crises"]);
        AddRow(metadata, ["Reporting period", report.PeriodLabel]);
        AddRow(metadata, ["Generated", OperationalReport.Utc(report.GeneratedAt)]);

        Heading(section, "Operational KPI summary");
        var summary = NewTable(section, 3, 3, 3, 3, 3, 3);
        AddRow(summary, OperationalReport.MetricNames, header: true, numericFrom: 0);
        var totals = AddRow(summary, Metrics(report.Totals), highlighted: true, numericFrom: 0);
        totals.Format.Font.Size = 13;
        if (report.PreviousPeriod is { PercentChange: { } change } previous)
            Note(section, $"Submitted requests: {change.ToString("+0.#;-0.#;0", Invariant)}% versus the previous equal-length period. Previous count: {previous.Submitted.ToString("N0", Invariant)}.");

        Heading(section, "Country performance");
        var performance = NewTable(section, 4.15, 2.45, 2.3, 2.1, 2.5, 2.25, 2.25);
        AddRow(performance, ["Country", "Active crises", "Submitted", "Open", "Unassigned", "Overdue", "Resolved"],
            header: true, numericFrom: 1);
        foreach (var row in report.Countries)
            AddRow(performance, [row.Country, .. Metrics(row)], numericFrom: 1);
        if (report.Scope != "Selected country")
            AddRow(performance, ["Total", .. Metrics(report.Totals)], highlighted: true, numericFrom: 1);
        if (report.Totals.Submitted > 0)
            AddCaseChart(section, report);

        Heading(section, "Current stock snapshot");
        Note(section, "Inventory across the selected countries at generation time. Available is on hand minus reserved.");
        var countryNames = report.Countries.ToDictionary(c => c.CountryCode, c => c.Country);
        if (report.Stock.Count == 0)
            Note(section, "No stock recorded for this scope.");
        else
        {
            var stock = NewTable(section, 3, 6.1, 2.15, 2.25, 2.25, 2.25);
            AddRow(stock, ["Country", "Resource / category", "Unit", "On hand", "Reserved", "Available"],
                header: true, numericFrom: 3);
            foreach (var row in report.Stock)
                AddRow(stock, [countryNames[row.CountryCode], $"{row.Name}\n{OperationalReport.CategoryLabel(row.Category)}", row.Unit,
                    Quantity(row.Stock), Quantity(row.Reserved), Quantity(row.Available)], numericFrom: 3);
        }

        Heading(section, "Metric definitions and data limitations");
        Note(section, report.Definition);
        var definitions = NewTable(section, 3.55, 14.45);
        AddRow(definitions, ["Metric", "How it is counted"], header: true);
        foreach (var item in OperationalReport.MetricDefinitions)
            AddRow(definitions, [item.Name, item.Definition]);

        var renderer = new PdfDocumentRenderer { Document = document };
        renderer.RenderDocument();
        using var stream = new MemoryStream();
        renderer.PdfDocument.Save(stream, false);
        return stream.ToArray();
    }

    private static void AddCaseChart(Section section, OperationalReport report)
    {
        const int maxBars = 8;
        string[] labels;
        int[] values;
        if (report.Countries.Count > 1)
        {
            var countries = report.Countries.OrderByDescending(c => c.Submitted).ThenBy(c => c.CountryCode).Take(maxBars).ToArray();
            Note(section, report.Countries.Count > maxBars ? "Requests submitted by country (top 8)" : "Requests submitted by country");
            labels = countries.Select(c => c.CountryCode).ToArray();
            values = countries.Select(c => c.Submitted).ToArray();
        }
        else
        {
            Note(section, "Current status of submitted requests");
            var totals = report.Totals;
            labels = ["Open", "Resolved", "Rejected / cancelled"];
            values = [totals.Open, totals.Resolved, totals.Submitted - totals.Open - totals.Resolved];
        }
        var chart = NewTable(section, 5, 11, 2);
        var maximum = values.Max();
        for (var index = 0; index < labels.Length; index++)
        {
            var value = values[index];
            var row = AddRow(chart, [labels[index], "", value.ToString("N0", Invariant)], numericFrom: 2);
            row.Cells[1].VerticalAlignment = VerticalAlignment.Center;
            if (value == 0) continue;
            var bar = row.Cells[1].AddTextFrame();
            bar.Width = Unit.FromCentimeter(10.5 * value / maximum);
            bar.Height = Unit.FromPoint(8);
            bar.FillFormat.Color = Blue;
            bar.LineFormat.Visible = false;
        }
    }

    private static void Heading(Section section, string label)
    {
        var heading = section.AddParagraph(label);
        heading.Format.SpaceBefore = 13;
        heading.Format.SpaceAfter = 5;
        heading.Format.Font.Bold = true;
        heading.Format.Font.Size = 12;
        heading.Format.KeepWithNext = true;
    }

    private static void Note(Section section, string text)
    {
        var paragraph = section.AddParagraph(text);
        paragraph.Format.Font.Color = Slate;
        paragraph.Format.Font.Size = 8.5;
        paragraph.Format.SpaceBefore = 4;
        paragraph.Format.SpaceAfter = 4;
        paragraph.Format.KeepWithNext = true;
    }

    private static Table NewTable(Section section, params double[] widths)
    {
        var table = section.AddTable();
        table.Borders.Bottom.Color = Rule;
        table.Borders.Bottom.Width = .45;
        table.Rows.LeftIndent = Unit.Zero;
        foreach (var width in widths)
            table.AddColumn(Unit.FromCentimeter(width));
        return table;
    }

    private static Row AddRow(Table table, string[] values, bool header = false, bool highlighted = false,
        int numericFrom = int.MaxValue)
    {
        var row = table.AddRow();
        row.HeadingFormat = header;
        row.Format.Font.Bold = header || highlighted;
        row.TopPadding = 3.5;
        row.BottomPadding = 3.5;
        if (header || highlighted) row.Shading.Color = PaleBlue;
        for (var index = 0; index < values.Length; index++)
        {
            if (string.IsNullOrEmpty(values[index])) continue;
            var paragraph = row.Cells[index].AddParagraph();
            if (index >= numericFrom) paragraph.Format.Alignment = ParagraphAlignment.Right;
            AddText(paragraph, values[index]);
        }
        return row;
    }

    private static void AddText(Paragraph paragraph, string text)
    {
        foreach (var line in text.Split('\n'))
        {
            if (paragraph.Elements.Count > 0) paragraph.AddLineBreak();
            var start = 0;
            while (start < line.Length)
            {
                var font = FontFor(line[start]);
                var end = start + 1;
                while (end < line.Length && FontFor(line[end]) == font) end++;
                paragraph.AddFormattedText(line[start..end]).Font.Name = font;
                start = end;
            }
        }
    }

    private static string FontFor(char value) => value switch
    {
        >= '\u0900' and <= '\u097f' => "Noto Sans Devanagari",
        >= '\u0b80' and <= '\u0bff' => "Noto Sans Tamil",
        >= '\u0d80' and <= '\u0dff' => "Noto Sans Sinhala",
        _ => DefaultFont,
    };

    private static string Quantity(decimal value) => value.ToString("#,0.##", Invariant);
    private static string[] Metrics(ReportCounts counts) => counts.ExportValues().Select(value => value.ToString("N0", Invariant)).ToArray();

    private static byte[] ReadResource(string name)
    {
        using var resource = typeof(OperationalReportPdf).Assembly.GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"Missing PDF resource {name}.");
        using var stream = new MemoryStream();
        resource.CopyTo(stream);
        return stream.ToArray();
    }

    private sealed class ReportFonts : IFontResolver
    {
        public FontResolverInfo ResolveTypeface(string familyName, bool bold, bool italic) =>
            new(familyName switch
            {
                "Noto Sans Devanagari" => "NotoSansDevanagari-Regular",
                "Noto Sans Tamil" => "NotoSansTamil-Regular",
                "Noto Sans Sinhala" => "NotoSansSinhala-Regular",
                _ => bold ? "NotoSans-Bold" : "NotoSans-Regular",
            });

        public byte[] GetFont(string faceName) => ReadResource($"Surakuma.Api.Reporting.Fonts.{faceName}.ttf");
    }
}
