using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Api.Controllers;

[ApiController, Authorize, Route("api/v1/partner")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class PartnerController(CrisisDbContext db, IStore store, AccessService access, Operations operations,
    InternalNotifications notifications, SupplySupportService supply) : ControllerBase
{
    public sealed record OfferInput(Guid OrganisationId, [Required, MaxLength(160)] string Title, string Kind,
        [Required, MaxLength(40)] string Unit, decimal Quantity, [Required, MaxLength(2000)] string Description, Guid? OperationId = null,
        AidCategory? Category = null, Guid? SupportRequestId = null);
    public sealed record ContributionAction([Required, MaxLength(1000)] string Note, decimal? Quantity = null);
    public sealed record WorkInput([MaxLength(160)] string? Title, [MaxLength(1000)] string? Instructions);

    [HttpGet]
    public async Task<object> Workspace(CancellationToken ct)
    {
        var grants = (await access.Memberships(ct)).Where(m => m.Role == Roles.Partner && m.OrganisationId != null).ToArray();
        if (grants.Length == 0) throw new AccessDeniedException();
        var country = RequireCountry();
        var orgIds = grants.Select(m => m.OrganisationId!.Value).Distinct().ToArray();
        var profiles = await (from o in db.Set<Organisation>()
                              join link in db.Set<OrganisationCountry>() on o.Id equals link.OrganisationId
                              where orgIds.Contains(o.Id)
                              select new { o.Id, o.Name, link.CountryCode, link.VerificationState }).ToListAsync(ct);
        var organisations = profiles.Where(o => grants.Any(m => m.OrganisationId == o.Id && m.CountryCode == o.CountryCode))
            .Select(o => new { o.Id, o.Name, o.CountryCode, o.VerificationState,
                CanOffer = Eligible(o.VerificationState) && grants.Any(m => m.OrganisationId == o.Id && m.CountryCode == o.CountryCode && m.CrisisId == null) }).ToArray();
        var currentGrants = grants.Where(m => m.CountryCode == country).ToArray();
        var verified = organisations.Where(o => o.CountryCode == country && Eligible(o.VerificationState)).Select(o => o.Id).ToArray();
        var fullScope = organisations.Where(o => o.CountryCode == country && o.CanOffer).Select(o => o.Id).ToArray();
        var work = await (from share in db.Set<CaseShare>()
                          join request in db.Set<AssistanceRequest>() on share.RequestId equals request.Id
                          join crisis in db.Set<Crisis>() on request.CrisisId equals crisis.Id
                          where crisis.CountryCode == country && verified.Contains(share.OrganisationId)
                          orderby request.UpdatedAt descending
                          select new { share.OrganisationId, crisisId = crisis.Id, crisis = crisis.Name, request.Reference,
                              share.WorkTitle, share.WorkInstructions, request.Category, request.Status, request.Quantity,
                              request.DeliveredQuantity, request.Unit, request.UpdatedAt })
            .ToListAsync(ct);
        var contributions = await db.Set<PartnerContribution>().Where(c => c.CountryCode == country && fullScope.Contains(c.OrganisationId))
            .OrderByDescending(c => c.UpdatedAt).ToListAsync(ct);
        var contributionIds = contributions.Select(c => c.Id).ToArray();
        var history = await db.Set<AuditEvent>().Where(a => a.CountryCode == country &&
                a.EntityType == nameof(PartnerContribution) && contributionIds.Contains(a.EntityId))
            .OrderByDescending(a => a.CreatedAt).Select(a => new { a.EntityId, a.Action, a.Detail, a.CreatedAt }).ToListAsync(ct);
        var contact = await db.Users.Where(u => u.Id == access.UserId).Select(u => new { u.DisplayName, u.Email }).SingleAsync(ct);
        return new { organisations, work = work.Where(w => currentGrants.Any(m => m.OrganisationId == w.OrganisationId &&
                (m.CrisisId == null || m.CrisisId == w.crisisId))), contributions, history, contact,
            memberships = grants.Select(m => new { m.OrganisationId, m.CountryCode, m.CrisisId }) };
    }

    [HttpPost("contributions")]
    [HttpPut("contributions/{id:guid}")]
    public Task<PartnerContribution> SaveOffer(OfferInput input, [FromServices] ResourceUnitCatalog units, CancellationToken ct, Guid? id = null) => store.TransactionAsync(async () =>
    {
        var country = RequireCountry();
        await RequirePartner(input.OrganisationId, country, ct);
        if (input.Kind is not ("Resource" or "Service")) throw new RuleException("Choose a resource or service offer.");
        var category = input.Kind == "Resource" ? input.Category : null;
        var unit = input.Kind == "Resource" ? units.Require(input.Unit) : input.Unit.Trim();
        QuantityUnits.ValidateInventory(input.Quantity, unit);
        if (input.Quantity is <= 0 or > 10000000) throw new RuleException("Enter an offer quantity from 0.01 to 10,000,000.");
        if (input.OperationId == Guid.Empty) throw new RuleException("Provide a unique offer reference.");
        if (id == null && input.OperationId is { } key && await store.FindAsync<PartnerContribution>(key, ct) is { } existing)
        {
            if (existing.OrganisationId != input.OrganisationId || existing.CountryCode != country) throw new AccessDeniedException();
            if (existing.Title != input.Title.Trim() || existing.Kind != input.Kind ||
                (input.Kind == "Resource" ? QuantityUnits.Normalize(existing.Unit) : existing.Unit) != unit ||
                existing.Quantity != input.Quantity || existing.Description != input.Description.Trim() ||
                existing.Category != category || existing.SupportRequestId != input.SupportRequestId)
                throw new RuleException("This offer reference has already been used.");
            return existing;
        }
        var contribution = id is { } offerId ? await FindContribution(offerId, country, ct) :
            new PartnerContribution { Id = input.OperationId ?? Guid.NewGuid(), OrganisationId = input.OrganisationId, CountryCode = country };
        if (contribution.OrganisationId != input.OrganisationId) throw new AccessDeniedException();
        if (contribution.Status != ContributionStatus.Offered) throw new RuleException("Only pending offers can be edited.");
        if (input.SupportRequestId is Guid supportId)
            await supply.ValidateOffer(country, supportId, input.OrganisationId, input.Category, input.Kind, unit, input.Quantity, ct);
        contribution.SupportRequestId = input.SupportRequestId;
        contribution.Category = category;
        contribution.Title = input.Title.Trim();
        contribution.Kind = input.Kind;
        contribution.Unit = unit;
        contribution.Quantity = input.Quantity;
        contribution.Description = input.Description.Trim();
        if (id == null) db.Add(contribution);
        await RecordContribution(contribution, id == null ? "Offered" : "Edited", "", true, ct);
        return contribution;
    }, ct);

    [HttpGet("commitments")]
    public async Task<object> AdminQueue(CancellationToken ct)
    {
        var country = RequireCountry();
        if (!await access.CountryAccess(country, [], ct)) throw new AccessDeniedException();
        return await (from contribution in db.Set<PartnerContribution>()
                      join organisation in db.Set<Organisation>() on contribution.OrganisationId equals organisation.Id
                      where contribution.CountryCode == country
                      orderby contribution.UpdatedAt descending
                      select new { contribution, organisation = organisation.Name }).ToListAsync(ct);
    }

    [HttpPost("contributions/{id:guid}/{operation}")]
    public Task<PartnerContribution> ChangeContribution(Guid id, string operation, ContributionAction input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var country = RequireCountry();
        var contribution = await FindContribution(id, country, ct);
        var administration = operation is "accept" or "decline";
        if (administration)
        {
            if (!await access.CountryAccess(country, [], ct)) throw new AccessDeniedException();
            if (operation == "accept") await access.RequirePartner(contribution.OrganisationId, country, ct);
            if (operation == "accept" && contribution.SupportRequestId is Guid supportId)
            {
                var request = await supply.ValidateOffer(country, supportId, contribution.OrganisationId, contribution.Category,
                    contribution.Kind, contribution.Unit, contribution.Quantity, ct);
                var commitments = await db.Set<PartnerContribution>().Where(c => c.Id != id && c.SupportRequestId == supportId &&
                    (c.Status == ContributionStatus.Accepted || c.Status == ContributionStatus.InProgress || c.Status == ContributionStatus.Fulfilled))
                    .Select(c => new { c.Quantity, c.Unit }).ToListAsync(ct);
                var committed = commitments.Sum(c => QuantityUnits.Convert(c.Quantity, c.Unit, request.Unit));
                if (committed + QuantityUnits.Convert(contribution.Quantity, contribution.Unit, request.Unit) > request.Quantity)
                    throw new RuleException("This offer exceeds the remaining support commitment.");
            }
        }
        else await RequirePartner(contribution.OrganisationId, country, ct);
        var note = input.Note.Trim();
        contribution.Status = (operation, contribution.Status) switch
        {
            ("accept", ContributionStatus.Offered) => ContributionStatus.Accepted,
            ("decline", ContributionStatus.Offered) => ContributionStatus.Declined,
            ("withdraw", ContributionStatus.Offered) => ContributionStatus.Withdrawn,
            ("progress", ContributionStatus.Accepted or ContributionStatus.InProgress) => RecordProgress(contribution, input.Quantity),
            _ => throw new RuleException("This action is unavailable for the current contribution status."),
        };
        await RecordContribution(contribution, contribution.Status.ToString(), note, !administration, ct);
        if (operation == "accept" && contribution.SupportRequestId is Guid acceptedSupport)
        {
            var request = await supply.FindRequest(acceptedSupport, country, ct);
            await notifications.PartnerChanged(request.RequestingOrganisationId, country, request.CrisisId,
                "A contribution was approved for your supply request.", false, ct);
        }
        return contribution;
    }, ct);

    [HttpGet("cases/{requestId:guid}/shares")]
    public async Task<object> Shares(Guid requestId, CancellationToken ct)
    {
        await RequireShareAccess(requestId, ct);
        return await db.Set<CaseShare>().Where(s => s.RequestId == requestId).Select(s => s.OrganisationId).ToListAsync(ct);
    }

    [HttpPut("cases/{requestId:guid}/shares/{organisationId:guid}")]
    [HttpDelete("cases/{requestId:guid}/shares/{organisationId:guid}")]
    public Task<IActionResult> ChangeShare(Guid requestId, Guid organisationId, CancellationToken ct,
        [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] WorkInput? input) => store.TransactionAsync<IActionResult>(async () =>
    {
        var request = await RequireShareAccess(requestId, ct);
        var country = RequireCountry();
        var share = await db.Set<CaseShare>().SingleOrDefaultAsync(s => s.RequestId == requestId && s.OrganisationId == organisationId, ct);
        if (HttpMethods.IsDelete(Request.Method))
        {
            if (share == null) return NoContent();
            db.Remove(share);
            operations.Audit("PartnerCaseShareRevoked", request, organisationId.ToString(), country);
            return NoContent();
        }
        await access.RequirePartner(organisationId, country, ct);
        if (share != null) return NoContent();
        if (request.Status is not (RequestStatus.Approved or RequestStatus.InProgress or RequestStatus.PartiallyFulfilled))
            throw new RuleException("Verify and approve the case before assigning partner work.");
        db.Add(new CaseShare { RequestId = requestId, OrganisationId = organisationId,
            WorkTitle = input?.Title?.Trim(), WorkInstructions = input?.Instructions?.Trim() });
        operations.Audit("PartnerCaseShared", request, organisationId.ToString(), country);
        await notifications.PartnerChanged(organisationId, country, request.CrisisId, $"New partner assignment · {request.Reference}.", false, ct);
        return NoContent();
    }, ct);

    private async Task<AssistanceRequest> RequireShareAccess(Guid requestId, CancellationToken ct)
    {
        var country = RequireCountry();
        var request = await access.Request(requestId, [Roles.Coordinator], ct);
        if (!await access.Coordinates(request.CrisisId, ct) || !await db.Set<Crisis>().AnyAsync(c => c.Id == request.CrisisId && c.CountryCode == country, ct))
            throw new AccessDeniedException();
        return request;
    }

    private async Task RequirePartner(Guid organisationId, string country, CancellationToken ct)
    {
        if (!(await access.Memberships(ct)).Any(m => m.Role == Roles.Partner && m.OrganisationId == organisationId &&
            m.CountryCode == country && m.CrisisId == null) || !await access.PartnerEligible(organisationId, country, ct))
            throw new AccessDeniedException();
    }

    private string RequireCountry() => access.SelectedCountry ?? throw new RuleException("Select the partner country.");
    private static bool Eligible(string state) => state is "Verified" or "LegacyActive";
    private async Task<PartnerContribution> FindContribution(Guid id, string country, CancellationToken ct)
        => await db.Set<PartnerContribution>().SingleOrDefaultAsync(c => c.Id == id && c.CountryCode == country, ct) ?? throw new MissingException();

    private async Task RecordContribution(PartnerContribution contribution, string action, string note, bool notifyAdministrators, CancellationToken ct)
    {
        operations.Audit("Contribution" + action, contribution, note, contribution.CountryCode);
        await notifications.PartnerChanged(contribution.OrganisationId, contribution.CountryCode, null,
            $"Partner contribution {action.ToLowerInvariant()} · {contribution.Title}.", notifyAdministrators, ct);
    }

    private static ContributionStatus RecordProgress(PartnerContribution contribution, decimal? quantity)
    {
        if (quantity is null || quantity <= contribution.FulfilledQuantity || quantity > contribution.Quantity)
            throw new RuleException("Enter a cumulative fulfilment quantity above prior progress and within the commitment.");
        QuantityUnits.ValidateInventory(quantity.Value, contribution.Unit);
        contribution.FulfilledQuantity = quantity.Value;
        return quantity == contribution.Quantity ? ContributionStatus.Fulfilled : ContributionStatus.InProgress;
    }
}
