using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Api.Controllers;

[ApiController, Route("api/v1"), Authorize]
public sealed class OperationsController(Operations ops, AccessService access, CrisisDbContext db, UserManager<AppUser> users, IMappingProvider maps, IMemoryCache cache) : ControllerBase
{
    [AllowAnonymous, HttpGet("public/lookups")] public Task<object> Lookups(CancellationToken ct) => ops.PublicData(ct);
    [AllowAnonymous, HttpGet("alerts")] public Task<List<PublicAlert>> Alerts(CancellationToken ct) => ops.Alerts(ct);
    [AllowAnonymous, HttpGet("shelters")] public Task<List<Shelter>> Shelters(CancellationToken ct) => ops.PublicShelters(ct);
    [HttpGet("reports/metrics")] public Task<object> Metrics(CancellationToken ct) => ops.Metrics(ct);
    [HttpGet("resources")] public Task<List<Resource>> Resources(CancellationToken ct) => ops.Resources(ct);
    [HttpPost("resources")] public Task<Resource> Resource(ResourceInput input, CancellationToken ct) => ops.AddResource(input, ct);
    [HttpPost("resources/{id:guid}/replenish")]
    public async Task<IActionResult> Replenish(Guid id, MovementInput input, CancellationToken ct)
    {
        await ops.Replenish(id, input, ct);
        return NoContent();
    }
    [HttpGet("resources/{id:guid}/movements")] public Task<List<StockMovement>> Movements(Guid id, CancellationToken ct) => ops.StockHistory(id, ct);
    [HttpPost("allocations")] public Task<ResourceAllocation> Allocate(AllocateInput input, CancellationToken ct) => ops.Allocate(input, ct);
    [HttpPost("allocations/{id:guid}/{operation}")] public Task<ResourceAllocation> Allocation(Guid id, string operation, CancellationToken ct) => ops.UpdateAllocation(id, operation, ct);
    [HttpPost("shelters")] public Task<Shelter> AddShelter(ShelterInput input, CancellationToken ct) => ops.SaveShelter(null, input, ct);
    [HttpPut("shelters/{id:guid}")] public Task<Shelter> Shelter(Guid id, ShelterInput input, CancellationToken ct) => ops.SaveShelter(id, input, ct);
    [HttpPost("shelter-allocations")] public Task<ShelterAllocation> Place(ShelterPlaceInput input, CancellationToken ct) => ops.Place(input, ct);
    [HttpPost("shelter-allocations/{id:guid}/{operation}")] public Task<ShelterAllocation> Stay(Guid id, string operation, CancellationToken ct) => ops.UpdateStay(id, operation, ct);
    [HttpGet("volunteers")] public Task<object> Volunteers(CancellationToken ct) => ops.Volunteers(ct);
    [HttpPost("volunteers")] public Task<VolunteerProfile> Volunteer(VolunteerProfile input, CancellationToken ct) => ops.SaveVolunteer(input, ct);
    [HttpPost("volunteer-tasks")] public Task<VolunteerTask> Task(TaskInput input, CancellationToken ct) => ops.AssignTask(input, ct);
    [HttpPost("volunteer-tasks/{id:guid}")] public Task<VolunteerTask> UpdateTask(Guid id, TaskUpdateInput input, CancellationToken ct) => ops.UpdateTask(id, input, ct);
    [HttpGet("notifications")]
    public async Task<object> Notifications(CancellationToken ct) => await db.Set<Notification>().Where(x => x.UserId == access.UserId).OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync(ct);
    [HttpPost("notifications/{id:guid}/read")]
    public async Task<IActionResult> Read(Guid id, CancellationToken ct)
    {
        var n = await db.Set<Notification>().SingleOrDefaultAsync(x => x.Id == id && x.UserId == access.UserId, ct) ?? throw new MissingException();
        n.Read = true;
        await db.SaveChangesAsync(ct);
        return NoContent();
    }
    [HttpGet("crises")]
    public async Task<object> Crises(CancellationToken ct)
    {
        var assignments = await db.Set<CrisisAssignment>().Where(x => x.UserId == access.UserId).Select(x => x.CrisisId).ToListAsync(ct);
        return await db.Set<Crisis>().Where(x => assignments.Contains(x.Id)).OrderByDescending(x => x.CreatedAt).ToListAsync(ct);
    }
    [HttpPost("crises")]
    public async Task<Crisis> AddCrisis(Crisis input, CancellationToken ct)
    {
        if (!(await access.Memberships(ct)).Any(x => x.Role == Roles.Coordinator))
            throw new AccessDeniedException();
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 150 || input.Latitude is < -90 or > 90 || input.Longitude is < -180 or > 180)
            throw new RuleException("Provide a crisis name and valid coordinates.");
        var crisis = new Crisis { Name = input.Name, Type = input.Type, District = input.District, Latitude = input.Latitude, Longitude = input.Longitude, Active = input.Active };
        db.Add(crisis);
        db.Add(new CrisisAssignment { CrisisId = crisis.Id, UserId = access.UserId });
        ops.Audit("CrisisCreated", crisis);
        await db.SaveChangesAsync(ct);
        return crisis;
    }
    [HttpPut("crises/{id:guid}")]
    public async Task<Crisis> UpdateCrisis(Guid id, Crisis input, CancellationToken ct)
    {
        if (!await access.Coordinates(id, ct))
            throw new AccessDeniedException();
        var crisis = await db.Set<Crisis>().FindAsync([id], ct) ?? throw new MissingException();
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 150)
            throw new RuleException("Provide a valid crisis name.");
        crisis.Name = input.Name;
        crisis.Type = input.Type;
        crisis.District = input.District;
        crisis.Active = input.Active;
        ops.Audit("CrisisUpdated", crisis);
        await db.SaveChangesAsync(ct);
        return crisis;
    }
    [HttpGet("crises/{id:guid}/areas")]
    public async Task<object> Areas(Guid id, CancellationToken ct)
    {
        if (!await access.Coordinates(id, ct))
            throw new AccessDeniedException();
        return await db.Set<OperationalArea>().Where(x => x.CrisisId == id).ToListAsync(ct);
    }
    [HttpPost("crises/{id:guid}/areas")]
    public async Task<OperationalArea> AddArea(Guid id, OperationalArea input, CancellationToken ct)
    {
        if (!await access.Coordinates(id, ct))
            throw new AccessDeniedException();
        if (string.IsNullOrWhiteSpace(input.Name) || input.GeoJson.Length > 4000)
            throw new RuleException("Provide a name and a GeoJSON geometry under 4,000 characters.");
        try
        {
            using var json = System.Text.Json.JsonDocument.Parse(input.GeoJson);
            if (json.RootElement.GetProperty("type").GetString() is not ("Polygon" or "MultiPolygon"))
                throw new RuleException("Use a Polygon or MultiPolygon.");
        }
        catch (System.Text.Json.JsonException) { throw new RuleException("Invalid GeoJSON."); }
        var area = new OperationalArea { CrisisId = id, Name = input.Name, GeoJson = input.GeoJson };
        db.Add(area);
        ops.Audit("OperationalAreaCreated", area);
        await db.SaveChangesAsync(ct);
        return area;
    }
    [HttpPost("alerts")]
    public async Task<PublicAlert> Publish(PublicAlert input, CancellationToken ct)
    {
        if (!await access.Coordinates(input.CrisisId, ct))
            throw new AccessDeniedException();
        if (string.IsNullOrWhiteSpace(input.Title) || string.IsNullOrWhiteSpace(input.Message) || input.ExpiresAt <= DateTimeOffset.UtcNow || input.Title.Length > 150 || input.Message.Length > 2000)
            throw new RuleException("Provide a title, message and future expiry.");
        if (input.Published && new[] { input.SinhalaTitle, input.SinhalaMessage, input.TamilTitle, input.TamilMessage }.Any(string.IsNullOrWhiteSpace))
            throw new RuleException("Published public alerts require English, Sinhala and Tamil wording.");
        var alert = new PublicAlert { CrisisId = input.CrisisId, Title = input.Title, Message = input.Message, SinhalaTitle = input.SinhalaTitle, SinhalaMessage = input.SinhalaMessage, TamilTitle = input.TamilTitle, TamilMessage = input.TamilMessage, Severity = input.Severity, Area = input.Area, Authority = input.Authority, ExpiresAt = input.ExpiresAt, Published = input.Published };
        db.Add(alert);
        ops.Audit("PublicAlertCreated", alert);
        await db.SaveChangesAsync(ct);
        return alert;
    }
    [HttpPost("alerts/{id:guid}/unpublish")]
    public async Task<IActionResult> Unpublish(Guid id, CancellationToken ct)
    {
        var a = await db.Set<PublicAlert>().FindAsync([id], ct) ?? throw new MissingException();
        if (!await access.Coordinates(a.CrisisId, ct))
            throw new AccessDeniedException();
        a.Published = false;
        ops.Audit("PublicAlertUnpublished", a);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }
    [AllowAnonymous, EnableRateLimiting("maps"), HttpGet("maps/geocode")]
    public async Task<IActionResult> Geocode(string query, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(query) || query.Length > 150)
            return BadRequest();
        var result = await cache.GetOrCreateAsync("geo:" + query.Trim().ToLowerInvariant(), async entry => { entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(12); return await maps.GeocodeAsync(query, ct); });
        return result is null ? StatusCode(503, new ProblemDetails { Title = "Location search unavailable. Enter a location or select a map point.", Status = 503 }) : Ok(result);
    }
    [EnableRateLimiting("maps"), HttpGet("maps/route")]
    public async Task<IActionResult> Route(double startLat, double startLng, double endLat, double endLng, CancellationToken ct)
    {
        if (startLat is < -90 or > 90 || endLat is < -90 or > 90 || startLng is < -180 or > 180 || endLng is < -180 or > 180)
            return BadRequest();
        var result = await maps.RouteAsync(startLat, startLng, endLat, endLng, ct);
        return result is null ? StatusCode(503, new ProblemDetails { Title = "Routing unavailable. No route or safe-travel estimate is being assumed.", Status = 503 }) : Ok(result);
    }
    private async Task Admin(CancellationToken ct)
    {
        if (!await access.IsAdmin(ct))
            throw new AccessDeniedException();
    }
    [HttpGet("admin/users")]
    public async Task<object> Users(CancellationToken ct)
    {
        await Admin(ct);
        return await db.Users.OrderBy(x => x.DisplayName).Take(100).Select(x => new { x.Id, Name = x.DisplayName, x.Email, x.Language, Memberships = db.Set<Membership>().Where(m => m.UserId == x.Id).ToList() }).ToListAsync(ct);
    }
    [HttpPost("admin/users")]
    public async Task<object> AddStaff(StaffInput input, CancellationToken ct)
    {
        await Admin(ct);
        if (!Roles.All.Contains(input.Role) || input.Role == Roles.Citizen || !await db.Set<Organisation>().AnyAsync(x => x.Id == input.OrganisationId, ct))
            throw new RuleException("Choose a valid staff role and organisation.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var user = await users.FindByEmailAsync(input.Email);
        if (user is null)
        {
            user = new AppUser { UserName = input.Email, Email = input.Email, DisplayName = input.Name, LockoutEnabled = true };
            var result = await users.CreateAsync(user, input.Password);
            if (!result.Succeeded)
                throw new RuleException(string.Join(" ", result.Errors.Select(x => x.Description)));
        }
        if (!await users.IsInRoleAsync(user, input.Role))
            await users.AddToRoleAsync(user, input.Role);
        if (!await db.Set<Membership>().AnyAsync(x => x.UserId == user.Id && x.Role == input.Role && x.OrganisationId == input.OrganisationId, ct))
            db.Add(new Membership { UserId = user.Id, Role = input.Role, OrganisationId = input.OrganisationId });
        if (input.CrisisId.HasValue && !await db.Set<CrisisAssignment>().AnyAsync(x => x.UserId == user.Id && x.CrisisId == input.CrisisId, ct))
            db.Add(new CrisisAssignment { UserId = user.Id, CrisisId = input.CrisisId.Value });
        ops.Audit("StaffAccessGranted", new Organisation { Id = input.OrganisationId }, input.Role);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return new
        {
            user.Id,
            user.Email
        };
    }
    [HttpDelete("admin/memberships/{id:guid}")]
    public async Task<IActionResult> Revoke(Guid id, CancellationToken ct)
    {
        await Admin(ct);
        var membership = await db.Set<Membership>().FindAsync([id], ct) ?? throw new MissingException();
        if (membership.UserId == access.UserId && membership.Role == Roles.Administrator)
            throw new RuleException("You cannot revoke your own administrator access.");
        db.Remove(membership);
        ops.Audit("StaffAccessRevoked", membership);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }
    [HttpPost("admin/organisations")]
    public async Task<Organisation> AddOrg(Organisation input, CancellationToken ct)
    {
        await Admin(ct);
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 150)
            throw new RuleException("Provide an organisation name under 150 characters.");
        var org = new Organisation { Name = input.Name };
        db.Add(org);
        ops.Audit("OrganisationCreated", org);
        await db.SaveChangesAsync(ct);
        return org;
    }
    [HttpGet("admin/audit")]
    public async Task<object> Audit(CancellationToken ct, int page = 1)
    {
        await Admin(ct);
        return await db.Set<AuditEvent>().OrderByDescending(x => x.CreatedAt).Skip((Math.Max(1, page) - 1) * 50).Take(50).ToListAsync(ct);
    }
    [HttpGet("admin/deliveries")]
    public async Task<object> Deliveries(CancellationToken ct)
    {
        await Admin(ct);
        return await db.Set<OutboxMessage>().OrderByDescending(x => x.CreatedAt).Take(100).Select(x => new { x.Id, x.State, x.Attempts, x.LastError, x.CreatedAt }).ToListAsync(ct);
    }
}
