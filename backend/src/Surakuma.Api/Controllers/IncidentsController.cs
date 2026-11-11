using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Api.Controllers;

[ApiController, Authorize, Route("api/v1/incidents")]
public sealed class IncidentsController(CrisisDbContext db, AccessService access, Operations ops) : ControllerBase
{
    // Cross-border coordination is deliberately a global-administrator capability.
    // Linking never changes a national crisis's permissions or country.
    private async Task RequireGlobal(CancellationToken ct) { if (!await access.IsAdmin(ct)) throw new AccessDeniedException(); }
    [HttpGet]
    public async Task<object> List(CancellationToken ct)
    {
        await RequireGlobal(ct);
        return await db.Set<InternationalIncident>().OrderBy(x => x.Name).Select(x => new { x.Id, x.Name, Crises = db.Set<Crisis>().Where(c => c.InternationalIncidentId == x.Id).Select(c => new { c.Id, c.Name, c.CountryCode }).ToList() }).ToListAsync(ct);
    }
    [HttpPost]
    public async Task<InternationalIncident> Create(IncidentName input, CancellationToken ct)
    {
        await RequireGlobal(ct);
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 150) throw new RuleException("Provide an incident name under 150 characters.");
        var incident = new InternationalIncident { Name = input.Name.Trim() };
        db.Add(incident); ops.Audit("InternationalIncidentCreated", incident);
        await db.SaveChangesAsync(ct); return incident;
    }
    [HttpPut("{id:guid}/crises/{crisisId:guid}")]
    public async Task<IActionResult> Link(Guid id, Guid crisisId, CancellationToken ct)
    {
        await RequireGlobal(ct);
        if (!await db.Set<InternationalIncident>().AnyAsync(x => x.Id == id, ct)) throw new MissingException();
        var crisis = await db.Set<Crisis>().FindAsync([crisisId], ct) ?? throw new MissingException();
        if (crisis.InternationalIncidentId.HasValue && crisis.InternationalIncidentId != id) throw new RuleException("Unlink this crisis from its current incident first.");
        crisis.InternationalIncidentId = id; ops.Audit("CrisisLinkedToIncident", crisis, id.ToString());
        await db.SaveChangesAsync(ct); return NoContent();
    }
    [HttpDelete("{id:guid}/crises/{crisisId:guid}")]
    public async Task<IActionResult> Unlink(Guid id, Guid crisisId, CancellationToken ct)
    {
        await RequireGlobal(ct);
        var crisis = await db.Set<Crisis>().SingleOrDefaultAsync(x => x.Id == crisisId && x.InternationalIncidentId == id, ct) ?? throw new MissingException();
        crisis.InternationalIncidentId = null; ops.Audit("CrisisUnlinkedFromIncident", crisis, id.ToString());
        await db.SaveChangesAsync(ct); return NoContent();
    }
}
public sealed record IncidentName(string Name);
