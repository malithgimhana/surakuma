using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Surakuma.Api.Reporting;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Api.Controllers;

[ApiController, Authorize, Route("api/v1/admin/reports")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class ReportsController(CrisisDbContext db, AccessService access) : ControllerBase
{
    [HttpGet("filters")]
    public async Task<object> Filters(CancellationToken ct)
    {
        var (global, authorized) = await AuthorizedCountries(ct);
        var countries = await authorized.OrderBy(c => c.Name).ThenBy(c => c.Code)
            .Select(c => new { c.Code, c.Name }).ToListAsync(ct);
        var crises = await db.Set<Crisis>().Where(c => authorized.Any(country => country.Code == c.CountryCode))
            .OrderBy(c => c.Name).ThenBy(c => c.Id)
            .Select(c => new ReportCrisis(c.Id, c.Name, c.CountryCode)).ToListAsync(ct);
        return new { isSystemAdministrator = global, countries, crises };
    }

    [HttpGet]
    public async Task<OperationalReport> Summary(CancellationToken ct, string scope = "country", string? countryCode = null,
        Guid? crisisId = null, DateTimeOffset? from = null, DateTimeOffset? to = null)
    {
        if (scope is not ("all" or "country")) throw new RuleException("Choose all or country scope.");
        if ((from == null) != (to == null) || (from != null && from >= to))
            throw new RuleException("Provide a valid start and exclusive end date.");
        from = from?.ToUniversalTime();
        to = to?.ToUniversalTime();
        var now = DateTimeOffset.UtcNow;
        var overdueBefore = CaseReporting.OverdueBefore(now);
        var (global, authorized) = await AuthorizedCountries(ct);
        var selected = scope == "country" ? authorized.Where(c => c.Code == countryCode) : authorized;
        var countries = await selected.OrderBy(c => c.Name).ThenBy(c => c.Code)
            .Select(c => new { c.Code, c.Name }).ToListAsync(ct);
        if (scope == "country" && countries.Count == 0)
        {
            if (!global || string.IsNullOrEmpty(countryCode)) throw new AccessDeniedException();
            throw new MissingException();
        }

        var codes = countries.Select(c => c.Code).ToArray();
        var crises = db.Set<Crisis>().Where(c => codes.Contains(c.CountryCode) && (crisisId == null || c.Id == crisisId));
        ReportCrisis? crisis = null;
        if (crisisId != null)
            crisis = await crises.Select(c => new ReportCrisis(c.Id, c.Name, c.CountryCode)).SingleOrDefaultAsync(ct)
                ?? throw new MissingException();

        var active = await crises.Where(c => c.Active).GroupBy(c => c.CountryCode)
            .Select(g => new { CountryCode = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.CountryCode, g => g.Count, ct);

        DateTimeOffset? previousStart = null;
        if (from is { } start && to is { } end && start - DateTimeOffset.MinValue >= end - start)
            previousStart = start - (end - start);
        var periodStart = from ?? DateTimeOffset.MinValue;
        var requests = db.Set<AssistanceRequest>().AsQueryable();
        if ((previousStart ?? from) is { } windowStart) requests = requests.Where(r => r.CreatedAt >= windowStart);
        if (to is { } windowEnd) requests = requests.Where(r => r.CreatedAt < windowEnd);
        var cases = from request in requests
                    join c in crises on request.CrisisId equals c.Id
                    select new
                    {
                        c.CountryCode,
                        Current = request.CreatedAt >= periodStart,
                        IsOpen = !CaseReporting.Ended.Contains(request.Status),
                        MissingAssignment = request.OrganisationId == null || request.AssignedCaseManagerId == null,
                        IsOverdue = request.CreatedAt < overdueBefore,
                        IsResolved = request.Status == RequestStatus.Fulfilled || request.Status == RequestStatus.Closed,
                    };
        var counts = await cases.GroupBy(c => c.CountryCode).Select(g => new
        {
            CountryCode = g.Key,
            Submitted = g.Count(c => c.Current),
            Open = g.Count(c => c.Current && c.IsOpen),
            Unassigned = g.Count(c => c.Current && c.IsOpen && c.MissingAssignment),
            Overdue = g.Count(c => c.Current && c.IsOpen && c.IsOverdue),
            Resolved = g.Count(c => c.Current && c.IsResolved),
            Previous = g.Count(c => !c.Current),
        }).ToDictionaryAsync(g => g.CountryCode, ct);
        var rows = countries.Select(c =>
        {
            var local = counts.GetValueOrDefault(c.Code);
            return new ReportCountry(c.Code, c.Name, active.GetValueOrDefault(c.Code), local?.Submitted ?? 0,
                local?.Open ?? 0, local?.Unassigned ?? 0, local?.Overdue ?? 0, local?.Resolved ?? 0);
        }).ToArray();
        var totals = ReportCounts.Total(rows);
        var previousCount = counts.Values.Sum(c => c.Previous);
        var comparison = previousStart is { } previous && from is { } through
            ? new SubmittedComparison(previous, through, previousCount,
                previousCount > 0 ? Math.Round((totals.Submitted - previousCount) * 100m / previousCount, 1) : null)
            : null;

        var stock = await db.Set<Resource>().Where(r => codes.Contains(r.CountryCode))
            .GroupBy(r => new { r.CountryCode, r.Category, r.Name, r.Unit })
            .OrderBy(g => g.Key.Category).ThenBy(g => g.Key.Name).ThenBy(g => g.Key.Unit).ThenBy(g => g.Key.CountryCode)
            .Select(g => new ReportStock(g.Key.CountryCode, g.Key.Category, g.Key.Name, g.Key.Unit,
                g.Sum(r => r.Stock), g.Sum(r => r.Reserved))).ToListAsync(ct);
        var scopeLabel = scope == "country" ? "Selected country" : global ? "All countries" : "Assigned countries";
        return new(now, scopeLabel, from, to, crisis, totals, rows, stock, comparison);
    }

    [HttpGet("export")]
    public async Task<IActionResult> Export(CancellationToken ct, string scope = "country", string? countryCode = null,
        Guid? crisisId = null, DateTimeOffset? from = null, DateTimeOffset? to = null, string? version = null)
    {
        var report = await Summary(ct, scope, countryCode, crisisId, from, to);
        if (version != null && version != report.Version) return ReportChanged();
        return File(OperationalReportCsv.Render(report), "text/csv", "surakuma-country-report.csv");
    }

    [HttpGet("export/pdf")]
    public async Task<IActionResult> ExportPdf(CancellationToken ct, string scope = "country", string? countryCode = null,
        Guid? crisisId = null, DateTimeOffset? from = null, DateTimeOffset? to = null, string? version = null)
    {
        var report = await Summary(ct, scope, countryCode, crisisId, from, to);
        if (version != null && version != report.Version) return ReportChanged();
        return File(OperationalReportPdf.Render(report), "application/pdf", "surakuma-operational-report.pdf");
    }

    private IActionResult ReportChanged() =>
        Problem(statusCode: StatusCodes.Status409Conflict, title: "Report data changed",
            detail: "Refresh the report and download it again to export the displayed figures.");

    private async Task<(bool Global, IQueryable<Country> Countries)> AuthorizedCountries(CancellationToken ct)
    {
        var countries = db.Set<Country>().AsQueryable();
        if (await access.IsAdmin(ct)) return (true, countries);
        var allowed = (await access.Memberships(ct)).Where(m => m.Role == Roles.CountryAdministrator && m.CrisisId == null)
            .Select(m => m.CountryCode).Distinct().ToArray();
        if (allowed.Length == 0) throw new AccessDeniedException();
        return (false, countries.Where(c => allowed.Contains(c.Code)));
    }
}
