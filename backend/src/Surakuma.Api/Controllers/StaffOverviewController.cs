using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

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
        var country = role == Roles.CaseManager ? await access.CaseManagerCountry(ct) :
            access.SelectedCountry ?? throw new RuleException("Select an operating country.");
        if (role == Roles.CaseManager && access.SelectedCountry is { } selected && selected != country)
            throw new AccessDeniedException();
        var grants = db.Set<Membership>().Where(m => m.UserId == access.UserId && m.Role == role);
        if (!await grants.AnyAsync(ct)) throw new AccessDeniedException();
        var countryGrants = grants.Where(m => m.CountryCode == country);
        if (!await countryGrants.AnyAsync(ct)) return new { HasAccess = false };
        var assignments = db.Set<CrisisAssignment>().Where(a => a.UserId == access.UserId);
        var crises = db.Set<Crisis>().Where(c => c.CountryCode == country && countryGrants.Any(m => m.CrisisId == null || m.CrisisId == c.Id));
        var countryOrgs = countryGrants.Where(m => m.CrisisId == null).Select(m => m.OrganisationId);
        if (role == Roles.Coordinator)
            countryOrgs = countryOrgs.Union(access.AssignedCoordinatorGrants(country).Select(m => m.OrganisationId));
        var now = DateTimeOffset.UtcNow;
        var metrics = new Dictionary<string, long>();
        if (role == Roles.VolunteerCoordinator)
        {
            var roster = await operations.Volunteers(ct, role);
            foreach (var (key, value) in (await operations.VolunteerMetrics(roster, ct)).Metrics)
                metrics[key] = value;
        }
        if (role is Roles.ShelterAdmin or Roles.Coordinator)
        {
            var shelters = db.Set<Shelter>().Where(s => s.CountryCode == country && countryOrgs.Contains(s.OrganisationId));
            var near = Math.Clamp(config.GetValue("ShelterDashboard:NearPercent", 80), 1, 99);
            var stale = now.AddHours(-Math.Clamp(config.GetValue("ShelterDashboard:StaleAfterHours", 168), 1, 87600));
            metrics["pressure"] = await shelters.CountAsync(s => s.PendingVerification || s.Capacity - s.Occupancy - s.Reserved < 0 ||
                s.Capacity <= 0 || (long)s.Occupancy * 100 >= (long)s.Capacity * near ||
                !s.Open && s.Occupancy + s.Reserved > 0 || s.Open && (s.OperationalUpdatedAt ?? s.UpdatedAt) < stale, ct);
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
            metrics["critical"] = await open.CountAsync(r => r.Priority == Priority.Critical ||
                role == Roles.Coordinator && r.ImmediateDanger, ct);
            metrics["overdue"] = await open.CountAsync(r => r.CreatedAt < overdueBefore, ct);
            metrics["escalated"] = await cases.CountAsync(r => r.Escalated, ct);
            if (role == Roles.CaseManager)
            {
                metrics["assigned"] = await open.CountAsync(ct);
                metrics["verification"] = await open.CountAsync(r => r.Status == RequestStatus.UnderReview, ct);
                metrics["ai"] = await operations.PendingAiCases(open).CountAsync(ct);
                metrics["followUps"] = await operations.FollowUpCases(cases).CountAsync(ct);
                var needs = await open.GroupBy(r => r.Category)
                    .Select(group => new
                    {
                        Category = group.Key,
                        Cases = group.Count(),
                        HouseholdMembers = group.Sum(r => (long)r.HouseholdSize),
                        Critical = group.Count(r => r.Priority == Priority.Critical)
                    }).OrderByDescending(group => group.HouseholdMembers).ThenBy(group => group.Category).ToListAsync(ct);
                var attention = await cases.Where(r => r.Escalated ||
                        !CaseReporting.Ended.Contains(r.Status) && (r.Priority == Priority.Critical ||
                         r.CreatedAt < overdueBefore || r.Status == RequestStatus.Submitted || r.Status == RequestStatus.UnderReview ||
                         r.Unit == null && r.Category != AidCategory.Shelter))
                    .OrderByDescending(r => r.CreatedAt).ThenBy(r => r.Id).Take(4)
                    .Select(r => new { r.Id, r.Reference, r.Category, r.HouseholdSize, r.Priority, r.Status, r.CreatedAt, r.Unit, r.Escalated })
                    .ToListAsync(ct);
                var decisions = await (from decision in db.Set<HumanDecision>()
                                       join request in cases on decision.RequestId equals request.Id
                                       where decision.ActorId == access.UserId
                                       orderby decision.CreatedAt descending, decision.Id
                                       select new { request.Id, request.Reference, request.Category, decision.Action, decision.CreatedAt }).Take(4).ToListAsync(ct);
                var regions = await db.Set<AdministrativeDivision>().Where(d => d.CountryCode == country &&
                        cases.Any(r => r.AdministrativeDivisionId == d.Id))
                    .OrderBy(d => d.Name).ThenBy(d => d.Id).Select(d => new { d.Id, d.Name, d.LevelName }).ToListAsync(ct);
                return new { HasAccess = true, metrics, decisions, needs, attention, regions };
            }
            metrics["unassigned"] = await open.CountAsync(r => r.OrganisationId == null || r.AssignedCaseManagerId == null, ct);
            metrics["assignments"] = await open.CountAsync(r => r.AssignedCaseManagerId != null, ct);
            var shortageIds = await operations.ShortageCases(cases).Select(r => r.Id).ToArrayAsync(ct);
            metrics["shortages"] = shortageIds.Length;
            metrics["cases"] = await cases.CountAsync(ct);
            metrics["approved"] = await cases.CountAsync(r => r.Status == RequestStatus.Approved, ct);
            metrics["followUps"] = await operations.FollowUpCases(cases).CountAsync(ct);
            var authorization = open.Where(r => r.Status == RequestStatus.Approved &&
                r.RequiresCoordinatorAuthorization && r.AuthorizedAt == null);
            var coordinationActions = await Operations.OrderTriage(cases.Where(r => r.Escalated ||
                    shortageIds.Contains(r.Id) || authorization.Any(s => s.Id == r.Id) ||
                    !CaseReporting.Ended.Contains(r.Status) &&
                    (r.ImmediateDanger || r.Priority == Priority.Critical || r.CreatedAt < overdueBefore)))
                .Take(6).Select(r => new
                {
                    r.Id, r.Reference, r.Status, r.Priority, r.Category, r.LocationText, r.CreatedAt, r.Escalated,
                    Critical = !CaseReporting.Ended.Contains(r.Status) && (r.ImmediateDanger || r.Priority == Priority.Critical),
                    Overdue = !CaseReporting.Ended.Contains(r.Status) && r.CreatedAt < overdueBefore,
                    Shortage = shortageIds.Contains(r.Id),
                    AwaitingAuthorization = authorization.Any(s => s.Id == r.Id)
                }).ToListAsync(ct);
            var scopedCrises = crises.Where(c => assignments.Any(a => a.CrisisId == c.Id));
            var assignedCrises = await scopedCrises.OrderByDescending(c => c.Active)
                .ThenBy(c => c.Name).ThenBy(c => c.Id).Select(c => new
                {
                    c.Id, c.Name, c.Active, c.Type, c.District,
                    Centre = db.Set<Organisation>().Where(o => o.Id == c.PrimaryOrganisationId)
                        .Select(o => o.Name).FirstOrDefault(),
                    OpenCases = open.Count(r => r.CrisisId == c.Id)
                }).ToListAsync(ct);
            metrics["crises"] = assignedCrises.Count;
            var activity = await db.Set<AuditEvent>().Where(a => (a.CountryCode == null || a.CountryCode == country) &&
                    (a.EntityType == nameof(AssistanceRequest) && cases.Any(r => r.Id == a.EntityId) ||
                     a.EntityType == nameof(Crisis) && scopedCrises.Any(c => c.Id == a.EntityId)))
                .OrderByDescending(a => a.CreatedAt).ThenBy(a => a.Id).Take(5)
                .Select(a => new { a.Id, a.EntityId, a.EntityType, a.Action, a.CreatedAt,
                    Reference = cases.Where(r => r.Id == a.EntityId).Select(r => r.Reference).FirstOrDefault(),
                    Crisis = scopedCrises.Where(c => c.Id == a.EntityId).Select(c => c.Name).FirstOrDefault() })
                .ToListAsync(ct);
            return new { HasAccess = true, metrics, crises = assignedCrises, Attention = coordinationActions, activity };
        }
        return new { HasAccess = true, metrics };
    }
}
