using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Surakuma.Application;
using Surakuma.Domain;

namespace Surakuma.Api.Controllers;

[ApiController, Authorize, Route("api/v1/crises/{crisisId:guid}/decision-support"),
 ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class DecisionSupportController(DecisionSupportService service) : ControllerBase
{
    [HttpGet]
    public Task<DecisionWorkspace> Workspace(Guid crisisId, CancellationToken ct) => service.Workspace(crisisId, ct);
    [HttpPost("forecasts"), EnableRateLimiting("ai-drafts")]
    public Task<ForecastView> Forecast(Guid crisisId, ForecastInput input, CancellationToken ct) => service.Forecast(crisisId, input, ct);
    [HttpPost("briefings"), EnableRateLimiting("ai-drafts")]
    public Task<BriefingView> Briefing(Guid crisisId, BriefingInput input, CancellationToken ct) => service.Briefing(crisisId, input, ct);
    [HttpPost("briefings/{id:guid}/review")]
    public Task<BriefingView> Review(Guid crisisId, Guid id, ReviewNote input, CancellationToken ct) => service.Review(crisisId, id, input, ct);
    [HttpPost("investigations/scan")]
    public Task<int> Scan(Guid crisisId, CancellationToken ct) => service.Scan(crisisId, ct);
    [HttpPost("investigations/{id:guid}/review")]
    public Task<InvestigationFlag> Resolve(Guid crisisId, Guid id, InvestigationReview input, CancellationToken ct) => service.Resolve(crisisId, id, input, ct);
}
