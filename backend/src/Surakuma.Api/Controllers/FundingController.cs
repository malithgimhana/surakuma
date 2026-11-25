using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Surakuma.Application;
using Surakuma.Domain;

namespace Surakuma.Api.Controllers;

[ApiController, Authorize, Route("api/v1/funding"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class FundingController(FundingService funding) : ControllerBase
{
    [HttpGet("{country}/workspace")]
    public Task<FundingWorkspace> Workspace([RegularExpression("LK|IN|NP")] string country, bool manage, CancellationToken ct)
    {
        if (!manage && !User.IsInRole(Roles.Donor)) throw new AccessDeniedException();
        return funding.Workspace(country, manage, ct);
    }

    [HttpPut("profile"), Authorize(Roles = Roles.Donor)]
    public Task<DonorProfile> UpdateProfile(DonorInput input, CancellationToken ct) => funding.UpdateProfile(input, ct);

    [HttpGet("{country}/options")]
    public Task<FundingOptions> Options([RegularExpression("LK|IN|NP")] string country, Guid? campaignId, CancellationToken ct)
        => funding.Options(country, campaignId, ct);

    [HttpPost("{country}/campaigns")]
    public Task<FundingCampaign> Create([RegularExpression("LK|IN|NP")] string country, CampaignInput input, CancellationToken ct)
        => funding.CreateCampaign(country, input, ct);

    [HttpPut("{country}/campaigns/{id:guid}")]
    public Task<FundingCampaign> Update([RegularExpression("LK|IN|NP")] string country, Guid id, CampaignUpdateInput input, CancellationToken ct)
        => funding.UpdateCampaign(country, id, input, ct);

    [HttpPut("{country}/campaigns/{id:guid}/state")]
    public Task<FundingCampaign> SetState([RegularExpression("LK|IN|NP")] string country, Guid id, CampaignStateInput input, CancellationToken ct)
        => funding.SetCampaignState(country, id, input, ct);

    [HttpPost("{country}/donations"), Authorize(Roles = Roles.Donor)]
    public Task<DonationView> Pledge([RegularExpression("LK|IN|NP")] string country, PledgeInput input, CancellationToken ct)
        => funding.Pledge(country, input, ct);

    [HttpPost("{country}/donations/{id:guid}/cancel"), Authorize(Roles = Roles.Donor)]
    public Task<DonationView> Cancel([RegularExpression("LK|IN|NP")] string country, Guid id, CancellationToken ct)
        => funding.Cancel(country, id, ct);

    [HttpPost("{country}/donations/{id:guid}/confirm")]
    public Task<Donation> Confirm([RegularExpression("LK|IN|NP")] string country, Guid id, FundingReceiptInput input, CancellationToken ct)
        => funding.Confirm(country, id, input, ct);

    [HttpPost("{country}/donations/{id:guid}/allocations")]
    public Task<DonationAllocation> Allocate([RegularExpression("LK|IN|NP")] string country, Guid id, FundingAllocationInput input, CancellationToken ct)
        => funding.Allocate(country, id, input, ct);

    [HttpPost("{country}/allocations/{id:guid}/expenses")]
    public Task<DonationExpenditure> Expend([RegularExpression("LK|IN|NP")] string country, Guid id, FundingExpenseInput input, CancellationToken ct)
        => funding.Expend(country, id, input, ct);

    [HttpPost("{country}/campaigns/{id:guid}/scan")]
    public Task<int> ScanLedger([RegularExpression("LK|IN|NP")] string country, Guid id, CancellationToken ct)
        => funding.ScanLedger(country, id, ct);

    [HttpPost("{country}/investigations/{id:guid}/review")]
    public Task<InvestigationFlag> ReviewFlag([RegularExpression("LK|IN|NP")] string country, Guid id, InvestigationReview input, CancellationToken ct)
        => funding.ReviewFlag(country, id, input, ct);
}
