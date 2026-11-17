using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Api.Controllers;

[ApiController, Authorize, Route("api/v1/admin/overview")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AdminOverviewController(CrisisDbContext db, AccessService access) : ControllerBase
{
    public sealed record StockReadiness(int BelowThreshold, int OutOfStock);
    public sealed record ShelterReadiness(int OpenShelters, long Capacity, long Occupancy, long Reserved)
    {
        public long Available => Capacity - Occupancy - Reserved;
    }
    public sealed record PendingWork(int Count, DateTimeOffset? OldestAt);

    [HttpGet]
    public async Task<object> Get(string countryCode, CancellationToken ct)
    {
        var global = await access.IsAdmin(ct);
        if (!global && !await access.CountryAccess(countryCode, [], ct)) throw new AccessDeniedException();
        if (!await db.Set<Country>().AnyAsync(c => c.Code == countryCode, ct)) throw new MissingException();

        var stock = await db.Set<Resource>().Where(r => r.CountryCode == countryCode).GroupBy(_ => 1)
            .Select(g => new StockReadiness(
                g.Count(r => r.LowStockThreshold != null && r.Stock - r.Reserved < r.LowStockThreshold),
                g.Count(r => r.Stock == 0))).SingleOrDefaultAsync(ct) ?? new(0, 0);
        var shelters = await db.Set<Shelter>().Where(s => s.CountryCode == countryCode && s.Open)
            .Where(s => db.Set<OrganisationCountry>().Any(link =>
                link.CountryCode == s.CountryCode && link.OrganisationId == s.OrganisationId))
            .GroupBy(_ => 1).Select(g => new ShelterReadiness(g.Count(),
                g.Sum(s => (long)s.Capacity), g.Sum(s => (long)s.Occupancy), g.Sum(s => (long)s.Reserved)))
            .SingleOrDefaultAsync(ct) ?? new(0, 0, 0, 0);
        var partnerVerification = await db.Set<OrganisationCountry>()
            .Where(link => link.CountryCode == countryCode && link.VerificationState == "Pending")
            .GroupBy(_ => 1).Select(g => new PendingWork(g.Count(), g.Min(link => link.CreatedAt)))
            .SingleOrDefaultAsync(ct) ?? new(0, null);
        PendingWork? systemAccess = null;
        if (global)
        {
            var now = DateTimeOffset.UtcNow;
            systemAccess = await db.Set<AdminProposal>()
                .Where(p => p.Kind == "GlobalAccess" && p.State == "Pending" && p.ExpiresAt > now)
                .GroupBy(_ => 1).Select(g => new PendingWork(g.Count(), g.Min(p => p.CreatedAt)))
                .SingleOrDefaultAsync(ct) ?? new(0, null);
        }

        return new { countryCode, stock, shelters, partnerVerification, systemAccess };
    }
}
