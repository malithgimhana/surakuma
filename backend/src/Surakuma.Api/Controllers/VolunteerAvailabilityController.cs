using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Surakuma.Application;
using Surakuma.Domain;

namespace Surakuma.Api.Controllers;

[ApiController, Authorize(Roles = Roles.Volunteer), Route("api/v1/volunteers/me/availability")]
public sealed class VolunteerAvailabilityController(VolunteerAvailability availability) : ControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<AvailabilityWindowView>> List(CancellationToken ct) => availability.List(ct);

    [HttpPost]
    public async Task<IActionResult> Add(AvailabilityWindowInput window, CancellationToken ct)
    {
        var result = await availability.Add(window, ct);
        return Ok(new AvailabilityWindowView(result.Id, result.StartsAt, result.EndsAt));
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Remove(Guid id, CancellationToken ct)
    {
        await availability.Remove(id, ct);
        return NoContent();
    }
}
