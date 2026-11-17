using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Api.Controllers;

[ApiController, Authorize, Route("api/v1/admin/crisis-operations")]
public sealed class CrisisAdministrationController(CrisisDbContext db, AccessService access) : ControllerBase
{
    [HttpGet("alerts")]
    public async Task<object> Alerts(string countryCode, CancellationToken ct, string? search = null,
        string? severity = null, string status = "Published", Guid? crisisId = null, int page = 1, int pageSize = 4)
    {
        if (!await access.CountryAccess(countryCode, [], ct)) throw new AccessDeniedException();
        var now = DateTimeOffset.UtcNow;
        var countryAlerts = db.Set<PublicAlert>().Where(a => db.Set<Crisis>()
            .Any(c => c.Id == a.CrisisId && c.CountryCode == countryCode));
        var publishedCount = await countryAlerts.CountAsync(a => a.Published && a.ExpiresAt > now, ct);
        var audit = db.Set<AuditEvent>().Where(e => e.EntityType == nameof(PublicAlert) && e.Action == "PublicAlertUnpublished");
        var history = countryAlerts.Select(a => new
        {
            Alert = a,
            Status = a.Published ? (a.ExpiresAt > now ? "Published" : "Expired")
                : audit.Any(e => e.EntityId == a.Id) ? "Withdrawn" : "Draft"
        });
        if (status != "All") history = history.Where(row => row.Status == status);
        if (crisisId is Guid id) history = history.Where(row => row.Alert.CrisisId == id);
        if (!string.IsNullOrWhiteSpace(severity)) history = history.Where(row => row.Alert.Severity == severity);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            history = history.Where(row => row.Alert.Title.Contains(term) || row.Alert.Area.Contains(term)
                || row.Alert.SinhalaTitle.Contains(term) || row.Alert.TamilTitle.Contains(term)
                || row.Alert.TranslationsJson.Contains(term));
        }
        var total = await history.CountAsync(ct);
        pageSize = Math.Clamp(pageSize, 1, 50);
        page = Math.Clamp(page, 1, Math.Max(1, (int)Math.Ceiling((double)total / pageSize)));
        var items = await history.OrderByDescending(row => row.Alert.CreatedAt).ThenBy(row => row.Alert.Id)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        return new { PublishedCount = publishedCount, Total = total, Page = page, Items = items };
    }

    [HttpGet("crises/{id:guid}/snapshot")]
    public async Task<object> Snapshot(Guid id, string countryCode, CancellationToken ct)
    {
        if (!await access.CountryAccess(countryCode, [], ct)) throw new AccessDeniedException();
        var crisis = await db.Set<Crisis>().SingleOrDefaultAsync(c => c.Id == id && c.CountryCode == countryCode, ct)
            ?? throw new MissingException();
        var stays = from stay in db.Set<ShelterAllocation>()
                    join request in db.Set<AssistanceRequest>() on stay.RequestId equals request.Id
                    join shelter in db.Set<Shelter>() on stay.ShelterId equals shelter.Id
                    where request.CrisisId == id && shelter.CountryCode == countryCode
                    select new { stay.ShelterId, stay.Status, stay.People, stay.UpdatedAt, shelter.Open };
        var activeShelters = await stays.Where(x => x.Open && (x.Status == StayStatus.CheckedIn || x.Status == StayStatus.Reserved))
            .Select(x => x.ShelterId).Distinct().CountAsync(ct);
        var shelteredPeople = await stays.Where(x => x.Status == StayStatus.CheckedIn).SumAsync(x => (long)x.People, ct);
        var lastStayUpdate = await stays.MaxAsync(x => (DateTimeOffset?)x.UpdatedAt, ct);
        return new { ActiveShelters = activeShelters, ShelteredPeople = shelteredPeople,
            LastUpdated = lastStayUpdate > crisis.UpdatedAt ? lastStayUpdate : crisis.UpdatedAt };
    }
}
