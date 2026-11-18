using System.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Api.Controllers;

[ApiController, Authorize, Route("api/v1/admin/organisations/{id:guid}")]
public sealed class OrganisationDeletionController(CrisisDbContext db, AccessService access, Operations ops) : ControllerBase
{
    public sealed record DeletionImpact(List<string> Countries, List<string> Blockers, bool CanArchiveLinked);

    [HttpGet("deletion")]
    public async Task<DeletionImpact> Preview(Guid id, CancellationToken ct)
    {
        if (!await access.IsAdmin(ct)) throw new AccessDeniedException();
        var blockers = await DeletionBlockers(id, ct);
        var countries = await (
            from link in db.Set<OrganisationCountry>()
            join country in db.Set<Country>() on link.CountryCode equals country.Code
            where link.OrganisationId == id
            orderby country.Name
            select country.Name).ToListAsync(ct);
        return new(countries, blockers, blockers.Count > 0);
    }

    [HttpGet("countries/{countryCode}/deletion")]
    public async Task<DeletionImpact> PreviewCountry(Guid id, string countryCode, CancellationToken ct)
    {
        await RequireCountryRegistration(id, countryCode, ct);
        var country = await db.Set<Country>().Where(c => c.Code == countryCode).Select(c => c.Name).SingleAsync(ct);
        var blockers = await DeletionBlockers(id, ct, countryCode);
        return new([country], blockers, blockers.Count > 0);
    }

    [HttpDelete("countries/{countryCode}")]
    public async Task<IActionResult> RemoveFromCountry(Guid id, string countryCode, CancellationToken ct)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var registration = await RequireCountryRegistration(id, countryCode, ct);
        if (registration.ArchivedAt.HasValue) return NoContent();
        var organisation = await db.Set<Organisation>().SingleAsync(o => o.Id == id, ct);
        await ArchiveOperations(organisation, ct, countryCode);
        registration.ArchivedAt = DateTimeOffset.UtcNow;
        ops.Audit("OrganisationCountryRemoved", registration, organisation.Name);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return NoContent();
    }

    [HttpDelete]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct, bool archiveLinked = false)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        if (!await access.IsAdmin(ct)) throw new AccessDeniedException();

        var organisation = await db.Set<Organisation>().FindAsync([id], ct) ?? throw new MissingException();
        if (organisation.ArchivedAt.HasValue)
        {
            if (archiveLinked) return NoContent();
            throw new MissingException();
        }
        var blockers = await DeletionBlockers(id, ct);
        if (!archiveLinked && blockers.Count > 0)
            return Conflict(new ProblemDetails
            {
                Title = "Organisation is in use",
                Detail = string.Join(" ", blockers),
                Status = 409
            });

        var links = await db.Set<OrganisationCountry>().IgnoreQueryFilters().Where(link => link.OrganisationId == id).ToListAsync(ct);
        if (archiveLinked)
        {
            await ArchiveOperations(organisation, ct);
            organisation.ArchivedAt = DateTimeOffset.UtcNow;
        }
        else
        {
            db.RemoveRange(links);
            db.Remove(organisation);
        }
        var action = archiveLinked ? "OrganisationArchived" : "OrganisationDeleted";
        if (links.Count == 0)
            ops.Audit(action, organisation, organisation.Name);
        foreach (var link in links)
            ops.Audit(action, organisation, organisation.Name, link.CountryCode);

        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return NoContent();
    }

    private async Task<OrganisationCountry> RequireCountryRegistration(Guid id, string countryCode, CancellationToken ct)
    {
        if (!await access.CountryAccess(countryCode, [], ct)) throw new AccessDeniedException();
        return await db.Set<OrganisationCountry>().IgnoreQueryFilters().SingleOrDefaultAsync(link =>
            link.OrganisationId == id && link.CountryCode == countryCode
            && db.Set<Organisation>().Any(o => o.Id == id && o.ArchivedAt == null), ct) ?? throw new MissingException();
    }

    private async Task ArchiveOperations(Organisation organisation, CancellationToken ct, string? countryCode = null)
    {
        var id = organisation.Id;
        foreach (var campaign in await db.Set<FundingCampaign>().Where(c => c.OrganisationId == id && c.Open
            && (countryCode == null || c.CountryCode == countryCode)).ToListAsync(ct))
        {
            campaign.Open = false;
            ops.Audit("FundingCampaignClosedWithOrganisation", campaign, countryCode: campaign.CountryCode);
        }
        var grants = await db.Set<Membership>().IgnoreQueryFilters()
            .Where(m => m.OrganisationId == id && !m.Suspended && m.Role != Roles.Administrator && m.Role != Roles.CountryAdministrator
                && (countryCode == null || m.CountryCode == countryCode)).ToListAsync(ct);
        var affectedUsers = grants.Select(m => m.UserId).Distinct().ToArray();
        foreach (var grant in grants)
        {
            grant.Suspended = true;
            grant.SuspensionReason = "Organisation archived";
        }
        foreach (var user in await db.Users.Where(u => affectedUsers.Contains(u.Id)).ToListAsync(ct))
            user.SecurityStamp = Guid.NewGuid().ToString("N");
        await db.Set<RefreshSession>().Where(s => affectedUsers.Contains(s.UserId) && !s.Revoked)
            .ExecuteUpdateAsync(change => change.SetProperty(s => s.Revoked, true), ct);

        foreach (var crisis in await db.Set<Crisis>().Where(c => c.PrimaryOrganisationId == id && c.Active
            && (countryCode == null || c.CountryCode == countryCode)).ToListAsync(ct))
        {
            crisis.PrimaryOrganisationId = null;
            ops.Audit("CrisisCentreChanged", crisis, $"Primary centre removed after {organisation.Name} was archived.");
        }
        var cases = await (
            from request in db.Set<AssistanceRequest>()
            join crisis in db.Set<Crisis>() on request.CrisisId equals crisis.Id
            where request.OrganisationId == id && (countryCode == null || crisis.CountryCode == countryCode) && request.Status != RequestStatus.Closed
                && request.Status != RequestStatus.Fulfilled && request.Status != RequestStatus.Cancelled
                && request.Status != RequestStatus.Rejected
            select new { Request = request, crisis.CountryCode }).ToListAsync(ct);
        foreach (var item in cases)
        {
            var request = item.Request;
            var note = $"{organisation.Name} was removed as the response centre. The case is awaiting reassignment.";
            request.OrganisationId = null;
            request.AssignedCaseManagerId = null;
            request.AssignmentStatus = AssignmentStatus.Unassigned;
            db.Add(new RequestHistory { RequestId = request.Id, ActorId = access.UserId, Status = request.Status.ToString(), Note = note });
            ops.Audit("RequestUnassigned", request, note, item.CountryCode);
        }
    }

    private async Task<List<string>> DeletionBlockers(Guid id, CancellationToken ct, string? countryCode = null)
    {
        var crises = db.Set<Crisis>().Where(c => countryCode == null || c.CountryCode == countryCode);
        var cases = db.Set<AssistanceRequest>().Where(r => crises.Any(c => c.Id == r.CrisisId));
        var linked = await db.Set<Organisation>().Where(o => o.Id == id && o.ArchivedAt == null).Select(o => new
        {
            Memberships = db.Set<Membership>().IgnoreQueryFilters().Any(m => m.OrganisationId == o.Id && (countryCode == null || m.CountryCode == countryCode)),
            Crises = crises.Any(c => c.PrimaryOrganisationId == o.Id),
            Cases = cases.Any(r => r.OrganisationId == o.Id),
            SharedCases = db.Set<CaseShare>().Any(s => s.OrganisationId == o.Id && cases.Any(r => r.Id == s.RequestId)),
            Resources = db.Set<Resource>().Any(r => r.OrganisationId == o.Id && (countryCode == null || r.CountryCode == countryCode)),
            Depots = db.Set<Depot>().Any(d => d.OrganisationId == o.Id && (countryCode == null || d.CountryCode == countryCode)),
            Shelters = db.Set<Shelter>().Any(s => s.OrganisationId == o.Id && (countryCode == null || s.CountryCode == countryCode)),
            Volunteers = db.Set<VolunteerProfile>().Any(v => v.OrganisationId == o.Id && (countryCode == null || v.CountryCode == countryCode)),
            Funding = db.Set<FundingCampaign>().Any(c => c.OrganisationId == o.Id && (countryCode == null || c.CountryCode == countryCode)),
            Supply = db.Set<SupplyRequest>().Any(r => (r.RequestingOrganisationId == o.Id || r.TargetOrganisationId == o.Id) &&
                (countryCode == null || r.CountryCode == countryCode))
        }).SingleOrDefaultAsync(ct) ?? throw new MissingException();

        var blockers = new List<string>();
        if (linked.Memberships) blockers.Add("This organisation has user access grants, including any suspended grants.");
        if (linked.Crises) blockers.Add("This organisation is the primary centre for one or more crises.");
        if (linked.Cases || linked.SharedCases) blockers.Add("This organisation has assigned or shared cases.");
        if (linked.Resources) blockers.Add("This organisation has resource records.");
        if (linked.Depots) blockers.Add("This organisation has depot records.");
        if (linked.Shelters) blockers.Add("This organisation has shelter records.");
        if (linked.Volunteers) blockers.Add("This organisation has volunteer records.");
        if (linked.Funding) blockers.Add("This organisation has a funding ledger.");
        if (linked.Supply) blockers.Add("This organisation has supply support records.");
        return blockers;
    }
}
