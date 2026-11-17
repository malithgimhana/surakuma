using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Surakuma.Application;
using Surakuma.Domain;

namespace Surakuma.Api.Controllers;

public sealed partial class OperationsController
{
    private sealed record ShelterWarning(string Kind, string Severity);

    private async Task<string> RequireShelterAdministration(CancellationToken ct)
    {
        var country = access.SelectedCountry ?? throw new RuleException("Select a shelter country.");
        if (!await access.CountryAccess(country, [], ct)) throw new AccessDeniedException();
        return country;
    }

    private async Task<object> ShelterDashboard(CancellationToken ct)
    {
        var country = await RequireShelterAdministration(ct);
        var configuration = HttpContext.RequestServices.GetRequiredService<IConfiguration>();
        var near = Math.Clamp(configuration.GetValue("ShelterDashboard:NearPercent", 80), 1, 99);
        var critical = Math.Clamp(configuration.GetValue("ShelterDashboard:CriticalPercent", 95), near + 1, 100);
        var staleHours = Math.Clamp(configuration.GetValue("ShelterDashboard:StaleAfterHours", 168), 1, 87600);
        var staleBefore = DateTimeOffset.UtcNow.AddHours(-staleHours);
        var scoped = db.Set<Shelter>().Where(s => s.CountryCode == country);
        var shelters = await scoped.OrderBy(s => s.Name).ToListAsync(ct);
        var active = await (
            from stay in db.Set<ShelterAllocation>()
            join request in db.Set<AssistanceRequest>() on stay.RequestId equals request.Id
            join crisis in db.Set<Crisis>() on request.CrisisId equals crisis.Id
            where scoped.Any(s => s.Id == stay.ShelterId) && crisis.CountryCode == country
                && (stay.Status == StayStatus.Reserved || stay.Status == StayStatus.CheckedIn)
            select new { stay.ShelterId, stay.RequestId, stay.Status, Crisis = new { crisis.Id, crisis.Name } }
        ).ToListAsync(ct);
        var activeByShelter = active.ToLookup(x => x.ShelterId);
        var eligibleOrgs = await db.Set<OrganisationCountry>().Where(o => o.CountryCode == country &&
            (o.VerificationState == "Verified" || o.VerificationState == "LegacyActive"))
            .Select(o => o.OrganisationId).ToListAsync(ct);
        var eligible = eligibleOrgs.ToHashSet();
        var entries = shelters.Select(s => new
        {
            Shelter = s,
            Eligible = s.Open && eligible.Contains(s.OrganisationId) && s.Available > 0,
            Crises = activeByShelter[s.Id].Select(x => x.Crisis).DistinctBy(c => c.Id).OrderBy(c => c.Name).ToArray(),
            Warnings = Warnings(s, near, critical, staleBefore).ToArray(),
        }).ToArray();

        return new
        {
            Entries = entries,
            Statistics = new
            {
                Total = entries.Length,
                Available = entries.Where(e => e.Eligible).Sum(e => (long)e.Shelter.Available),
                Occupied = shelters.Sum(s => (long)s.Occupancy),
                // One shelter request represents one household, even when the same citizen files for others.
                Households = active.Where(x => x.Status == StayStatus.CheckedIn).Select(x => x.RequestId).Distinct().Count(),
                Attention = entries.Count(e => e.Warnings.Length > 0),
            },
        };
    }

    private static IEnumerable<ShelterWarning> Warnings(Shelter shelter, int near, int critical, DateTimeOffset staleBefore)
    {
        if (shelter.Available < 0) yield return new("overcapacity", "critical");
        else if (shelter.Capacity <= 0) yield return new("unknownCapacity", "warning");
        else if ((long)shelter.Occupancy * 100 >= (long)shelter.Capacity * critical)
            yield return new(shelter.Occupancy == shelter.Capacity ? "full" : "criticalCapacity", "critical");
        else if ((long)shelter.Occupancy * 100 >= (long)shelter.Capacity * near)
            yield return new("nearCapacity", "warning");

        if (!shelter.Open && (shelter.Occupancy > 0 || shelter.Reserved > 0))
            yield return new("closedWithPlacements", "critical");
        if (shelter.Open && shelter.UpdatedAt < staleBefore)
            yield return new("stale", "warning");
    }

    [HttpGet("staff/shelters/{id:guid}")]
    public async Task<object> ShelterDetails(Guid id, CancellationToken ct, bool allocation = false)
    {
        var country = await RequireShelterAdministration(ct);
        var shelter = await db.Set<Shelter>().SingleOrDefaultAsync(s => s.Id == id && s.CountryCode == country, ct)
            ?? throw new MissingException();
        if (allocation)
        {
            if (!shelter.Open || shelter.Available <= 0 || !await access.PartnerEligible(shelter.OrganisationId, country, ct))
                throw new RuleException("This shelter is not currently accepting reservations.");
            return await (
                from request in db.Set<AssistanceRequest>()
                join crisis in db.Set<Crisis>() on request.CrisisId equals crisis.Id
                where crisis.CountryCode == country && request.Category == AidCategory.Shelter
                    && (request.Status == RequestStatus.Approved || request.Status == RequestStatus.InProgress)
                    && request.Quantity == 1 && request.DeliveredQuantity == 0
                    && request.HouseholdSize > 0 && request.HouseholdSize <= shelter.Available
                    && (shelter.Accessible || request.AccessibilityNeeds.Length == 0)
                    && !db.Set<ShelterAllocation>().Any(s => s.RequestId == request.Id &&
                        (s.Status == StayStatus.Reserved || s.Status == StayStatus.CheckedIn))
                orderby request.CreatedAt descending
                select new { request.Id, request.Reference, People = request.HouseholdSize, Crisis = crisis.Name }
            ).ToListAsync(ct);
        }

        var households = await (
            from stay in db.Set<ShelterAllocation>()
            join request in db.Set<AssistanceRequest>() on stay.RequestId equals request.Id
            join crisis in db.Set<Crisis>() on request.CrisisId equals crisis.Id
            where stay.ShelterId == id && crisis.CountryCode == country
            orderby stay.CreatedAt descending
            select new { stay.Id, request.Reference, stay.People, stay.Status, stay.CreatedAt, stay.UpdatedAt }
        ).ToListAsync(ct);
        var stayIds = households.Select(h => h.Id).ToArray();
        var activity = await db.Set<AuditEvent>().Where(a => (a.CountryCode == null || a.CountryCode == country) &&
            ((a.EntityType == nameof(Shelter) && a.EntityId == id) ||
             (a.EntityType == nameof(ShelterAllocation) && stayIds.Contains(a.EntityId))))
            .OrderByDescending(a => a.CreatedAt)
            .Select(a => new { a.EntityId, a.Action, a.Detail, a.CreatedAt }).ToListAsync(ct);
        var checkIns = activity.Where(a => a.Action == "ShelterCheckIn").ToLookup(a => a.EntityId);
        return new
        {
            Households = households.Select(h => new
            {
                h.Id, h.Reference, h.People, h.Status, h.CreatedAt, h.UpdatedAt,
                CheckInAt = checkIns[h.Id].FirstOrDefault()?.CreatedAt
                    ?? (h.Status == StayStatus.CheckedIn ? h.UpdatedAt : (DateTimeOffset?)null),
            }),
            Activity = activity.Take(100),
        };
    }
}
