using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Surakuma.Application;
using Surakuma.Domain;

namespace Surakuma.Api.Controllers;

public sealed partial class OperationsController
{
    [HttpGet("staff/coordinator/inventory")]
    public async Task<object> CoordinatorStock(CancellationToken ct)
    {
        var country = await access.CoordinatorCountry(ct);
        var inventory = access.CoordinatorInventory(country);
        var rows = await inventory.OrderBy(r => r.Name).ThenBy(r => r.Id).Select(r => new
        {
            Resource = r,
            Organisation = db.Set<Organisation>().Where(o => o.Id == r.OrganisationId).Select(o => o.Name).FirstOrDefault(),
            Warehouse = db.Set<Depot>().Where(d => d.Id == r.DepotId && d.CountryCode == country &&
                d.OrganisationId == r.OrganisationId).Select(d => d.Name).FirstOrDefault()
        }).ToListAsync(ct);
        var cases = (await access.StaffCases(Roles.Coordinator, ct)).Where(r => r.OrganisationId != null &&
            (r.Status == RequestStatus.Approved || r.Status == RequestStatus.InProgress || r.Status == RequestStatus.PartiallyFulfilled));
        var compatibleNeeds = await (from item in db.Set<CaseNeed>()
                                     join request in cases on item.RequestId equals request.Id
                                     where item.ApprovedQuantity > item.DeliveredQuantity
                                     select new { request.OrganisationId, item.Category, item.Unit }).Distinct().ToListAsync(ct);
        var legacyNeeds = await cases.Where(r => r.Category != AidCategory.Shelter && r.Unit != null &&
                r.Quantity > r.DeliveredQuantity && !db.Set<CaseNeed>().Any(n => n.RequestId == r.Id))
            .Select(r => new { r.OrganisationId, r.Category, Unit = r.Unit! }).Distinct().ToListAsync(ct);
        var demand = compatibleNeeds.Concat(legacyNeeds)
            .Select(n => (n.OrganisationId, n.Category, Unit: QuantityUnits.BaseUnit(n.Unit))).ToHashSet();
        return rows.Select(row => new
        {
            row.Resource, row.Organisation, row.Warehouse,
            MatchesApprovedNeed = demand.Contains((row.Resource.OrganisationId, row.Resource.Category,
                QuantityUnits.BaseUnit(row.Resource.Unit)))
        });
    }
}
