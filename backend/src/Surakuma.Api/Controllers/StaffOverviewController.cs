using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;
using VolunteerStatus = Surakuma.Domain.TaskStatus;

namespace Surakuma.Api.Controllers;

[ApiController, Authorize, Route("api/v1/staff/overview")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class StaffOverviewController(CrisisDbContext db, AccessService access, Operations operations, IConfiguration config) : ControllerBase
{
    [HttpGet("{role}")]
    public async Task<object> Overview(string role, CancellationToken ct)
    {
        if (role is not (Roles.Coordinator or Roles.CaseManager or Roles.Logistics or Roles.ShelterAdmin or Roles.VolunteerCoordinator))
            throw new AccessDeniedException();
        var country = access.SelectedCountry ?? throw new RuleException("Select an operating country.");
        var grants = db.Set<Membership>().Where(m => m.UserId == access.UserId && m.Role == role);
        if (!await grants.AnyAsync(ct)) throw new AccessDeniedException();
        var countryGrants = grants.Where(m => m.CountryCode == country);
        if (!await countryGrants.AnyAsync(ct)) return new { HasAccess = false };
        var assignments = db.Set<CrisisAssignment>().Where(a => a.UserId == access.UserId);
        var crises = db.Set<Crisis>().Where(c => c.CountryCode == country && countryGrants.Any(m => m.CrisisId == null || m.CrisisId == c.Id));
        var countryOrgs = countryGrants.Where(m => m.CrisisId == null).Select(m => m.OrganisationId);
        var now = DateTimeOffset.UtcNow;
        var metrics = new Dictionary<string, long>();
        if (role == Roles.VolunteerCoordinator)
        {
            var roster = await operations.Volunteers(ct, role);
            var open = roster.Tasks.Where(t => t.Status is not (VolunteerStatus.Completed or VolunteerStatus.Declined)).ToArray();
            metrics["verified"] = roster.Profiles.Count(v => v.Verified);
            metrics["available"] = roster.Profiles.Count(v => v.Verified && v.Available);
            metrics["open"] = open.Length;
            metrics["deployments"] = open.Count(t => t.Status is VolunteerStatus.Accepted or VolunteerStatus.InProgress);
            metrics["reports"] = open.Count(t => t.Status == VolunteerStatus.AwaitingVerification);
            metrics["overdue"] = open.Count(t => t.DueAt < now);
        }
        if (role is Roles.ShelterAdmin or Roles.Coordinator)
        {
            var shelters = db.Set<Shelter>().Where(s => s.CountryCode == country && countryOrgs.Contains(s.OrganisationId));
            var near = Math.Clamp(config.GetValue("ShelterDashboard:NearPercent", 80), 1, 99);
            var stale = now.AddHours(-Math.Clamp(config.GetValue("ShelterDashboard:StaleAfterHours", 168), 1, 87600));
            metrics["pressure"] = await shelters.CountAsync(s => s.Capacity - s.Occupancy - s.Reserved < 0 ||
                s.Capacity <= 0 || (long)s.Occupancy * 100 >= (long)s.Capacity * near ||
                !s.Open && s.Occupancy + s.Reserved > 0 || s.Open && s.UpdatedAt < stale, ct);
            if (role == Roles.ShelterAdmin)
            {
                var stays = db.Set<ShelterAllocation>().Where(p => shelters.Any(s => s.Id == p.ShelterId) &&
                    db.Set<AssistanceRequest>().Any(r => r.Id == p.RequestId && crises.Any(c => c.Id == r.CrisisId)));
                metrics["shelters"] = await shelters.CountAsync(ct);
                metrics["capacity"] = await shelters.SumAsync(s => (long)s.Capacity, ct);
                metrics["occupancy"] = await shelters.SumAsync(s => (long)s.Occupancy, ct);
                metrics["reserved"] = await shelters.SumAsync(s => (long)s.Reserved, ct);
                metrics["accessible"] = await shelters.CountAsync(s => s.Open && s.Accessible, ct);
                metrics["arrivals"] = await stays.CountAsync(p => p.Status == StayStatus.Reserved, ct);
                metrics["checkins"] = await stays.CountAsync(p => p.Status == StayStatus.CheckedIn, ct);
            }
        }
        if (role == Roles.Logistics)
        {
            var inventory = db.Set<Resource>().Where(r => r.CountryCode == country && countryOrgs.Contains(r.OrganisationId));
            var cases = await access.StaffCases(role, ct);
            var allocations = db.Set<ResourceAllocation>().Where(a => cases.Any(c => c.Id == a.RequestId) && inventory.Any(r => r.Id == a.ResourceId));
            var orders = db.Set<LogisticsOrder>().Where(o => inventory.Any(r => r.Id == o.ResourceId) &&
                (o.DestinationResourceId == null || inventory.Any(r => r.Id == o.DestinationResourceId)) &&
                (o.CrisisId == null || crises.Any(c => c.Id == o.CrisisId)));
            metrics["inventory"] = await inventory.CountAsync(ct);
            metrics["low"] = await inventory.CountAsync(r => r.LowStockThreshold != null && r.Stock - r.Reserved < r.LowStockThreshold, ct);
            metrics["reservations"] = await allocations.CountAsync(a => a.Status == AllocationStatus.Reserved, ct);
            metrics["dispatch"] = await orders.CountAsync(o => o.Status == AllocationStatus.Reserved && o.Kind == LogisticsOrderKind.Dispatch, ct);
            metrics["transit"] = await orders.CountAsync(o => o.Status == AllocationStatus.Dispatched, ct);
            metrics["receipts"] = await allocations.CountAsync(a => a.Status == AllocationStatus.Dispatched, ct);
            metrics["exceptions"] = await db.Set<DeliveryConfirmation>().CountAsync(d => d.ExceptionDetail != "" &&
                (allocations.Any(a => a.Id == d.AllocationId) || orders.Any(o => o.Id == d.LogisticsOrderId)), ct);
        }
        if (role is Roles.Coordinator or Roles.CaseManager)
        {
            var cases = await access.StaffCases(role, ct);
            if (role == Roles.CaseManager) cases = cases.Where(r => r.AssignedCaseManagerId == access.UserId);
            var open = cases.Where(r => !CaseReporting.Ended.Contains(r.Status));
            var overdueBefore = CaseReporting.OverdueBefore(now);
            metrics["critical"] = await open.CountAsync(r => r.Priority == Priority.Critical, ct);
            metrics["overdue"] = await open.CountAsync(r => r.CreatedAt < overdueBefore, ct);
            metrics["escalated"] = await cases.CountAsync(r => r.Escalated, ct);
            if (role == Roles.CaseManager)
            {
                metrics["assigned"] = await open.CountAsync(ct);
                metrics["verification"] = await open.CountAsync(r => r.Status == RequestStatus.UnderReview, ct);
                metrics["ai"] = await open.CountAsync(r => db.Set<Recommendation>().Any(a => a.RequestId == r.Id &&
                    (a.ReviewState == "Pending" || a.ReviewState == "Defer")), ct);
                var decisions = await (from decision in db.Set<HumanDecision>()
                                       join request in cases on decision.RequestId equals request.Id
                                       orderby decision.CreatedAt descending
                                       select new { request.Id, request.Reference, decision.Action, decision.CreatedAt }).Take(6).ToListAsync(ct);
                return new { HasAccess = true, metrics, decisions };
            }
            metrics["unassigned"] = await open.CountAsync(r => r.OrganisationId == null || r.AssignedCaseManagerId == null, ct);
            metrics["assignments"] = await open.CountAsync(r => r.AssignedCaseManagerId != null, ct);
            metrics["shortages"] = await operations.ShortageCases(cases).CountAsync(ct);
            var assignedCrises = await crises.Where(c => assignments.Any(a => a.CrisisId == c.Id)).OrderByDescending(c => c.Active)
                .ThenBy(c => c.Name).Select(c => new { c.Id, c.Name, c.Active }).ToListAsync(ct);
            metrics["crises"] = assignedCrises.Count;
            return new { HasAccess = true, metrics, crises = assignedCrises };
        }
        return new { HasAccess = true, metrics };
    }
}
