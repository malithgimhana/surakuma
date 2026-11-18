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
    [HttpGet("/api/v1/staff/alert-workflow")]
    public async Task<object> Alerts(string countryCode, CancellationToken ct, string? search = null,
        string? severity = null, string status = "Published", Guid? crisisId = null, int page = 1, int pageSize = 4)
    {
        if (access.SelectedCountry is { } selected && selected != countryCode) throw new AccessDeniedException();
        var reviewer = await access.CountryAccess(countryCode, [], ct);
        var countryCrises = db.Set<Crisis>().Where(c => c.CountryCode == countryCode);
        if (!reviewer)
        {
            if (!Request.Path.StartsWithSegments("/api/v1/staff/alert-workflow")) throw new AccessDeniedException();
            var grants = (await access.Memberships(ct)).Where(m => m.CountryCode == countryCode && m.Role == Roles.Coordinator).ToArray();
            if (grants.Length == 0) throw new AccessDeniedException();
            var scopedCrises = grants.Where(m => m.CrisisId != null).Select(m => m.CrisisId!.Value).ToArray();
            var countryWide = grants.Any(m => m.CrisisId == null);
            countryCrises = countryCrises.Where(c => (countryWide || scopedCrises.Contains(c.Id)) &&
                db.Set<CrisisAssignment>().Any(a => a.CrisisId == c.Id && a.UserId == access.UserId));
        }
        var now = DateTimeOffset.UtcNow;
        var countryAlerts = db.Set<PublicAlert>().Where(a => countryCrises.Any(c => c.Id == a.CrisisId));
        var publishedCount = await countryAlerts.CountAsync(a => a.Published && a.ExpiresAt > now, ct);
        var audit = db.Set<AuditEvent>().Where(e => e.EntityType == nameof(PublicAlert) && e.Action == "PublicAlertUnpublished");
        var history = countryAlerts.Select(a => new
        {
            Alert = a,
            IsAuthor = a.CreatorUserId == access.UserId,
            CanReview = reviewer && a.CreatorUserId != access.UserId && a.EmergencyPublisherUserId != access.UserId,
            NeedsEmergencyReview = a.EmergencyPublisherUserId != null && a.ReviewerUserId == null,
            Status = a.Published ? (a.ExpiresAt <= now ? "Expired" : a.WorkflowState == "EmergencyPublished" ? "EmergencyPublished" : "Published")
                : a.WorkflowState ?? (audit.Any(e => e.EntityId == a.Id) ? "Withdrawn" : "Draft")
        });
        if (status != "All") history = history.Where(row => row.Status == status ||
            status == "Published" && row.Status == "EmergencyPublished" || status == "EmergencyReview" && row.NeedsEmergencyReview);
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
        return new { PublishedCount = publishedCount, Total = total, Page = page, Items = items, Reviewer = reviewer };
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
