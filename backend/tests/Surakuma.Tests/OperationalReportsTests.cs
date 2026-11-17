using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PdfSharp.Pdf.IO;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class OperationalReportsTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task CountsDateCohortAndStockAndExportsTheSameAuthorizedFigures()
    {
        using var admin = await fixture.Login("admin");
        const string reports = "/api/v1/admin/reports";
        var from = DateTimeOffset.Parse("2025-01-02T00:00:00Z");
        var through = from.AddDays(2);
        var flood = new Crisis { Name = "Flood response", CountryCode = "BT", Active = true };
        var otherCrisis = new Crisis { Name = "Other response", CountryCode = "BT", Active = true };
        var nepalCrisis = new Crisis { Name = "Nepal response", CountryCode = "NP", Active = true };
        const string resourceName = "=1+1 \"Food parcels\"";
        Guid organisationId;
        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var citizen = await db.Users.SingleAsync(u => u.Email == "citizen@surakuma.test");
            organisationId = await db.Set<Organisation>().Select(o => o.Id).FirstAsync();
            db.Add(new Country { Code = "BT", Name = "Bhutan" });
            db.AddRange(flood, otherCrisis, nepalCrisis);
            void Case(Crisis crisis, DateTimeOffset created, RequestStatus status, bool assigned = false) =>
                db.Add(new AssistanceRequest { CrisisId = crisis.Id, CitizenId = citizen.Id, CreatedAt = created,
                    SubmissionKey = Guid.NewGuid().ToString(), Status = status, OrganisationId = assigned ? organisationId : null,
                    AssignedCaseManagerId = assigned ? citizen.Id : null });

            Case(flood, from, RequestStatus.UnderReview);
            Case(flood, from.AddHours(1), RequestStatus.Approved, assigned: true);
            Case(flood, through.AddTicks(-1), RequestStatus.Fulfilled);
            Case(flood, from.AddHours(2), RequestStatus.Rejected);
            Case(flood, from.AddHours(3), RequestStatus.Cancelled);
            Case(flood, from.AddDays(-2), RequestStatus.Closed); // First instant in the comparison period.
            Case(flood, from.AddDays(-2).AddTicks(-1), RequestStatus.Submitted);
            Case(flood, through, RequestStatus.Submitted); // Exclusive end.
            Case(otherCrisis, from, RequestStatus.Submitted);
            Case(nepalCrisis, from, RequestStatus.Closed);
            void Stock(string name, string unit, decimal amount, decimal reserved) =>
                db.Add(new Resource { OrganisationId = organisationId, CountryCode = "BT",
                    Name = name, Category = AidCategory.FoodWater, Unit = unit, Stock = amount, Reserved = reserved });
            Stock(resourceName, "packs", 8, 2);
            Stock(resourceName, "packs", 2, 1);
            Stock(resourceName, "kg", 18, 4);
            Stock("Drinking water", "packs", 7, 2);
            await db.SaveChangesAsync();
        }

        string dates = $"from={Uri.EscapeDataString(from.ToString("O"))}&to={Uri.EscapeDataString(through.ToString("O"))}";
        string filters = $"scope=country&countryCode=BT&crisisId={flood.Id}&{dates}";
        var report = await admin.GetFromJsonAsync<JsonElement>($"{reports}?{filters}");
        var totals = report.GetProperty("totals");
        Assert.Equal(1, totals.GetProperty("activeCrises").GetInt32());
        Assert.Equal(5, totals.GetProperty("submitted").GetInt32());
        Assert.Equal(2, totals.GetProperty("open").GetInt32());
        Assert.Equal(1, totals.GetProperty("unassigned").GetInt32());
        Assert.Equal(2, totals.GetProperty("overdue").GetInt32());
        Assert.Equal(1, totals.GetProperty("resolved").GetInt32());
        Assert.Equal(400m, report.GetProperty("previousPeriod").GetProperty("percentChange").GetDecimal());
        var stock = report.GetProperty("stock").EnumerateArray().ToArray();
        Assert.Equal(3, stock.Length);
        var parcels = Assert.Single(stock, row => row.GetProperty("name").GetString() == resourceName && row.GetProperty("unit").GetString() == "packs");
        Assert.Equal(10, parcels.GetProperty("stock").GetDecimal());
        Assert.Equal(3, parcels.GetProperty("reserved").GetDecimal());
        Assert.Equal(7, parcels.GetProperty("available").GetDecimal());

        var version = report.GetProperty("version").GetString();
        var csv = await admin.GetStringAsync($"{reports}/export?{filters}&version={version}");
        Assert.Contains("\"BT\",\"Bhutan\",1,5,2,1,2,1", csv);
        Assert.Contains("\"'=1+1 \"\"Food parcels\"\"\"", csv);
        Assert.Contains("\"packs\",10,3,7", csv);
        Assert.Contains("\"Requests submitted change (%)\",400", csv);

        var global = await admin.GetFromJsonAsync<JsonElement>($"{reports}?scope=all&{dates}");
        Assert.Equal(7, global.GetProperty("totals").GetProperty("submitted").GetInt32());
        Assert.Contains(global.GetProperty("countries").EnumerateArray(), c => c.GetProperty("countryCode").GetString() == "BT");
        var noBaseline = await admin.GetFromJsonAsync<JsonElement>($"{reports}?scope=country&countryCode=NP&{dates}");
        Assert.Equal(JsonValueKind.Null, noBaseline.GetProperty("previousPeriod").GetProperty("percentChange").ValueKind);
        var globalVersion = global.GetProperty("version").GetString();
        using var pdfResponse = await admin.GetAsync($"{reports}/export/pdf?scope=all&{dates}&version={globalVersion}");
        Assert.Equal(HttpStatusCode.OK, pdfResponse.StatusCode);
        Assert.Equal("application/pdf", pdfResponse.Content.Headers.ContentType?.MediaType);
        var pdf = await pdfResponse.Content.ReadAsByteArrayAsync();
        using var document = PdfReader.Open(new MemoryStream(pdf), PdfDocumentOpenMode.Import);
        Assert.Equal("Surakuma | Operational reports", document.Info.Title);
        Assert.InRange(document.Pages[0].Width.Point, 595, 596);
        Assert.InRange(document.Pages[0].Height.Point, 841, 843);
        if (Environment.GetEnvironmentVariable("SURAKUMA_REPORT_TEST_ARTIFACTS") is { Length: > 0 } artifactDirectory)
        {
            Directory.CreateDirectory(artifactDirectory);
            await File.WriteAllBytesAsync(Path.Combine(artifactDirectory, "operational-report.pdf"), pdf);
            await File.WriteAllBytesAsync(Path.Combine(artifactDirectory, "crisis-report.pdf"),
                await admin.GetByteArrayAsync($"{reports}/export/pdf?{filters}&version={version}"));
            await File.WriteAllTextAsync(Path.Combine(artifactDirectory, "operational-report.csv"),
                await admin.GetStringAsync($"{reports}/export?scope=all&{dates}&version={globalVersion}"));
        }

        using (var scope = fixture.Factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var water = await db.Set<Resource>().SingleAsync(r => r.CountryCode == "BT" && r.Name == "Drinking water");
            water.Stock++;
            await db.SaveChangesAsync();
        }
        foreach (var endpoint in new[] { "export", "export/pdf" })
            Assert.Equal(HttpStatusCode.Conflict, (await admin.GetAsync($"{reports}/{endpoint}?{filters}&version={version}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"{reports}?scope=country&countryCode=NP&crisisId={flood.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync($"{reports}?scope=all&from=2025-01-02")).StatusCode);

        using var staffGrant = await admin.PostAsJsonAsync("/api/v1/admin/users", new
        {
            email = "reports-national@surakuma.test", name = "Bhutan administrator", password = fixture.Password,
            role = Roles.CountryAdministrator, countryCode = "BT",
        });
        staffGrant.EnsureSuccessStatusCode();
        using var national = await fixture.Login("reports-national");
        var choices = await national.GetFromJsonAsync<JsonElement>($"{reports}/filters");
        Assert.False(choices.GetProperty("isSystemAdministrator").GetBoolean());
        Assert.Equal("BT", Assert.Single(choices.GetProperty("countries").EnumerateArray()).GetProperty("code").GetString());
        Assert.All(choices.GetProperty("crises").EnumerateArray(), c => Assert.Equal("BT", c.GetProperty("countryCode").GetString()));
        Assert.Equal(HttpStatusCode.Forbidden, (await national.GetAsync($"{reports}/export/pdf?scope=country&countryCode=NP")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await national.GetAsync($"{reports}/export?scope=all&crisisId={nepalCrisis.Id}")).StatusCode);
        var nationalReport = await national.GetFromJsonAsync<JsonElement>($"{reports}?scope=all&{dates}");
        Assert.Equal(6, nationalReport.GetProperty("totals").GetProperty("submitted").GetInt32());
        Assert.Equal("BT", Assert.Single(nationalReport.GetProperty("countries").EnumerateArray()).GetProperty("countryCode").GetString());
        using var citizenClient = await fixture.Login("citizen");
        Assert.Equal(HttpStatusCode.Forbidden, (await citizenClient.GetAsync($"{reports}/filters")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await citizenClient.GetAsync($"{reports}/export/pdf?scope=all")).StatusCode);
    }
}
