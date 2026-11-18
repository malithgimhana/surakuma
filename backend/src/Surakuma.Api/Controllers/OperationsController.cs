using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using System.Data;
using System.Security.Claims;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Api.Controllers;

[ApiController, Route("api/v1"), Authorize]
public sealed partial class OperationsController(Operations ops, AccessService access, CrisisDbContext db, UserManager<AppUser> users, IMappingProvider maps, IMemoryCache cache, InternalNotifications notifications) : ControllerBase
{
    [AllowAnonymous, HttpGet("public/lookups")] public Task<PublicLookups> Lookups(CancellationToken ct, string countryCode = "LK") => ops.PublicData(ct, countryCode);
    [AllowAnonymous, HttpGet("alerts")] public Task<List<PublicAlert>> Alerts(CancellationToken ct, string countryCode = "LK") => ops.Alerts(ct, countryCode);
    [AllowAnonymous, HttpGet("shelters")] public Task<List<PublicShelter>> Shelters(CancellationToken ct, string countryCode = "LK") => ops.PublicShelters(ct, countryCode);
    [HttpGet("staff/shelters")] public async Task<object> StaffShelters(CancellationToken ct, bool dashboard = false) =>
        dashboard ? await ShelterDashboard(ct) : await ops.StaffShelters(ct);
    [HttpGet("reports/metrics")] public Task<object> Metrics(CancellationToken ct) => ops.Metrics(ct);
    [HttpGet("requests/{id:guid}/resources")] public Task<List<Resource>> CaseResources(Guid id, CancellationToken ct) => ops.CaseResources(id, ct);
    [HttpGet("requests/{id:guid}/shelters")] public Task<List<Shelter>> CaseShelters(Guid id, CancellationToken ct) => ops.CaseShelters(id, ct);
    [HttpGet("requests/{id:guid}/shelter-recommendations")]
    public Task<List<ShelterCandidate>> ShelterRecommendations(Guid id, CancellationToken ct) => ops.ShelterRecommendations(id, ct);
    [HttpGet("resources")] public Task<List<Resource>> Resources(CancellationToken ct) => ops.Resources(ct);
    [HttpPost("resources")] public Task<Resource> Resource(ResourceInput input, CancellationToken ct) => ops.AddResource(input, ct);
    [HttpPost("resources/{id:guid}/replenish")]
    public async Task<IActionResult> Replenish(Guid id, MovementInput input, CancellationToken ct)
    {
        await ops.Replenish(id, input, ct);
        return NoContent();
    }
    [HttpGet("resources/{id:guid}/movements")] public Task<List<StockMovement>> Movements(Guid id, CancellationToken ct) => ops.StockHistory(id, ct);
    [HttpGet("requests/{id:guid}/allocation-recommendations")] public Task<AllocationRecommendations> AllocationRecommendations(Guid id, CancellationToken ct) => ops.AllocationRecommendations(id, ct);
    [HttpPost("requests/{id:guid}/allocation-recommendations/ignore")] public async Task<IActionResult> IgnoreAllocationRecommendation(Guid id, IgnoreAllocationRecommendationInput input, CancellationToken ct) { await ops.IgnoreAllocationRecommendation(id, input.RecommendedResourceId, ct); return NoContent(); }
    [HttpPost("allocations")] public Task<ResourceAllocation> Allocate(AllocateInput input, CancellationToken ct) => ops.Allocate(input, ct);
    [HttpPost("allocations/{id:guid}/{operation}")]
    public Task<ResourceAllocation> Allocation(Guid id, string operation,
        [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] DeliveryInput? delivery,
        CancellationToken ct) => ops.UpdateAllocation(id, operation, ct, delivery: delivery);
    [HttpGet("allocations/{id:guid}/receipt")]
    public Task<DeliveryConfirmation> AllocationReceipt(Guid id, CancellationToken ct) => ops.AllocationReceipt(id, ct);
    [HttpPost("shelters")] public Task<Shelter> AddShelter(ShelterInput input, CancellationToken ct) => ops.SaveShelter(null, input, ct);
    [HttpPut("shelters/{id:guid}")] public Task<Shelter> Shelter(Guid id, ShelterInput input, CancellationToken ct) => ops.SaveShelter(id, input, ct);
    [HttpPost("shelter-allocations")] public Task<ShelterAllocation> Place(ShelterPlaceInput input, CancellationToken ct) => ops.Place(input, ct);
    [HttpPost("shelter-allocations/{id:guid}/{operation}")] public Task<ShelterAllocation> Stay(Guid id, string operation, CancellationToken ct) => ops.UpdateStay(id, operation, ct);
    [HttpGet("volunteers")]
    public async Task<object> Volunteers(CancellationToken ct)
    {
        var roster = await ops.Volunteers(ct);
        var userIds = roster.Profiles.Select(x => x.UserId).Distinct().ToArray();
        var names = await users.Users.Where(x => userIds.Contains(x.Id)).Select(x => new { x.Id, x.DisplayName }).ToDictionaryAsync(x => x.Id, x => x.DisplayName, ct);
        return new { roster.Profiles, roster.Tasks, roster.History, Names = names };
    }
    [HttpPost("volunteers")] public Task<VolunteerProfile> Volunteer(VolunteerProfile input, CancellationToken ct) => ops.SaveVolunteer(input, ct);
    [HttpGet("volunteer-tasks/cases")] public Task<List<VolunteerCase>> VolunteerCases(string? search, CancellationToken ct) => ops.VolunteerCases(search, ct);
    [HttpGet("volunteer-tasks/candidates")]
    public Task<List<VolunteerCandidate>> VolunteerRecommendations(Guid requestId,
        DateTimeOffset startsAt, DateTimeOffset dueAt, string? skill, CancellationToken ct)
        => ops.VolunteerRecommendations(requestId, startsAt, dueAt, skill, ct);
    [HttpPost("volunteer-tasks")] public Task<VolunteerTask> Task(TaskInput input, CancellationToken ct) => ops.AssignTask(input, ct);
    [HttpPost("volunteer-tasks/{id:guid}")] public Task<VolunteerTask> UpdateTask(Guid id, TaskUpdateInput input, CancellationToken ct) => ops.UpdateTask(id, input, ct);
    [HttpGet("notifications")]
    public async Task<List<Notification>> Notifications(CancellationToken ct, bool unreadOnly = false, bool partnerOnly = false)
    {
        var query = VisibleNotifications(partnerOnly);
        if (unreadOnly)
            query = query.Where(n => !n.Read);
        return await query.OrderByDescending(n => n.CreatedAt).Take(100).ToListAsync(ct);
    }
    [HttpGet("notifications/unread-count")]
    public async Task<object> UnreadNotifications(CancellationToken ct, bool partnerOnly = false)
        => new { count = await VisibleNotifications(partnerOnly).CountAsync(x => !x.Read, ct) };
    private IQueryable<Notification> VisibleNotifications(bool partnerOnly)
    {
        if (partnerOnly)
        {
            return notifications.Visible(access.UserId, access.SelectedCountry).Where(n => n.ScopeRole == Roles.Partner &&
                db.Set<Membership>().Any(m => m.UserId == access.UserId && m.Role == Roles.Partner &&
                    m.OrganisationId == n.ScopeOrganisationId && m.CountryCode == n.ScopeCountryCode &&
                    (m.CrisisId == null || m.CrisisId == n.CrisisId) &&
                    db.Set<OrganisationCountry>().Any(o => o.OrganisationId == m.OrganisationId && o.CountryCode == m.CountryCode &&
                        (o.VerificationState == "Verified" || o.VerificationState == "LegacyActive"))));
        }
        if (!NotificationChannels.ReceivesCitizenEmail(User.FindAll(ClaimTypes.Role).Select(c => c.Value)))
            return notifications.Visible(access.UserId, access.SelectedCountry);
        var citizen = db.Set<Notification>().Where(n => !n.IsInternal && n.UserId == access.UserId
            && db.Set<AssistanceRequest>().Any(r => r.Id == n.RequestId && r.CitizenId == access.UserId
                && db.Set<Crisis>().Any(c => c.Id == r.CrisisId
                    && (access.SelectedCountry == null || c.CountryCode == access.SelectedCountry))));
        return citizen.Union(notifications.Visible(access.UserId, access.SelectedCountry));
    }
    [HttpPost("notifications/{id:guid}/read")]
    public async Task<IActionResult> Read(Guid id, CancellationToken ct, bool partnerOnly = false)
    {
        var visible = VisibleNotifications(partnerOnly).Where(n => n.Id == id);
        if (await MarkNotificationsRead(visible, ct) == 0 && !await visible.AnyAsync(ct))
            throw new MissingException();
        return NoContent();
    }
    [HttpPost("notifications/read-all")]
    public async Task<IActionResult> ReadAll(CancellationToken ct, bool partnerOnly = false)
    {
        await MarkNotificationsRead(VisibleNotifications(partnerOnly), ct);
        return NoContent();
    }
    private Task<int> MarkNotificationsRead(IQueryable<Notification> visible, CancellationToken ct)
    {
        var visibleIds = visible.Select(n => n.Id);
        var updatedAt = DateTimeOffset.UtcNow;
        return db.Set<Notification>().Where(n => !n.Read && visibleIds.Contains(n.Id))
            .ExecuteUpdateAsync(update => update.SetProperty(n => n.Read, true)
                .SetProperty(n => n.UpdatedAt, updatedAt), ct);
    }
    [HttpGet("crises")]
    public async Task<object> Crises(CancellationToken ct, string? countryCode = null)
    {
        var assignments = await db.Set<CrisisAssignment>().Where(x => x.UserId == access.UserId).Select(x => x.CrisisId).ToListAsync(ct);
        var memberships = await access.Memberships(ct);
        var admin = await access.IsAdmin(ct);
        var countries = memberships.Where(x => x.Role == Roles.CountryAdministrator).Select(x => x.CountryCode).ToArray();
        var grants = db.Set<Membership>().Where(x => x.UserId == access.UserId && x.Role == Roles.Coordinator);
        return await db.Set<Crisis>().Where(x => countryCode == null || x.CountryCode == countryCode).Where(x => admin || countries.Contains(x.CountryCode) || (assignments.Contains(x.Id) && grants.Any(m => m.CountryCode == x.CountryCode && (m.CrisisId == null || m.CrisisId == x.Id)))).OrderByDescending(x => x.CreatedAt).ToListAsync(ct);
    }
    [HttpPut("crises/{id:guid}/centre")]
    public async Task<Crisis> SetCentre(Guid id, CentreRoutingInput input, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var crisis = await CoordinatedCrisis(id, ct);
        if (input.OrganisationId.HasValue && !await db.Set<OrganisationCountry>().AnyAsync(x => x.OrganisationId == input.OrganisationId && x.CountryCode == crisis.CountryCode, ct)) throw new RuleException("Centre not found.");
        if (input.OrganisationId.HasValue) await access.RequirePartner(input.OrganisationId.Value, crisis.CountryCode, ct);
        var previous = crisis.PrimaryOrganisationId;
        crisis.PrimaryOrganisationId = input.OrganisationId;
        ops.Audit("CrisisCentreChanged", crisis, $"From {previous?.ToString() ?? "unassigned"} to {input.OrganisationId?.ToString() ?? "unassigned"}");
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return crisis;
    }
    [HttpGet("case-manager/availability")]
    public async Task<object> ManagerAvailability(CancellationToken ct) => await db.Set<Membership>().Where(x => x.UserId == access.UserId && x.Role == Roles.CaseManager).Select(x => new { x.Id, x.OrganisationId, x.AvailableForAssignment }).ToListAsync(ct);
    [HttpPut("case-manager/availability/{membershipId:guid}")]
    public async Task<IActionResult> SetManagerAvailability(Guid membershipId, AvailabilityInput input, CancellationToken ct)
    {
        var membership = await db.Set<Membership>().FindAsync([membershipId], ct) ?? throw new MissingException();
        if (membership.Role != Roles.CaseManager || (membership.UserId != access.UserId
            && !await access.CountryAccess(membership.CountryCode, [], ct)
            && !(await access.Memberships(ct)).Any(x => x.Role == Roles.Coordinator && x.OrganisationId == membership.OrganisationId && x.CountryCode == membership.CountryCode && x.CrisisId == null))) throw new AccessDeniedException();
        membership.AvailableForAssignment = input.Available;
        ops.Audit("CaseManagerAvailabilityChanged", membership, input.Available ? "Available" : "Unavailable");
        await db.SaveChangesAsync(ct);
        return NoContent();
    }
    [HttpPost("crises")]
    public async Task<Crisis> AddCrisis(Crisis input, CancellationToken ct)
    {
        if (OutsideSelectedCountry(input.CountryCode) || !await access.CountryAccess(input.CountryCode, [Roles.Coordinator], ct))
            throw new AccessDeniedException();
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 150 || input.Latitude is < -90 or > 90 || input.Longitude is < -180 or > 180)
            throw new RuleException("Provide a crisis name and valid coordinates.");
        if (input.InternationalIncidentId.HasValue) throw new RuleException("Create a separate crisis for each country.");
        if (input.AdministrativeDivisionId is Guid divisionId && !await db.Set<AdministrativeDivision>()
            .AnyAsync(x => x.Id == divisionId && x.CountryCode == input.CountryCode, ct))
            throw new RuleException("Select an administrative division in the chosen country.");
        var crisis = new Crisis { CountryCode = input.CountryCode, AdministrativeDivisionId = input.AdministrativeDivisionId, Name = input.Name, Type = input.Type, District = input.District, Latitude = input.Latitude, Longitude = input.Longitude, Active = input.Active };
        db.Add(crisis);
        db.Add(new CrisisAssignment { CrisisId = crisis.Id, UserId = access.UserId });
        ops.Audit("CrisisCreated", crisis);
        await notifications.CrisisCreated(crisis, ct);
        await db.SaveChangesAsync(ct);
        return crisis;
    }
    [HttpPut("crises/{id:guid}")]
    public async Task<Crisis> UpdateCrisis(Guid id, Crisis input, CancellationToken ct)
    {
        var crisis = await CoordinatedCrisis(id, ct);
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
    [HttpPut("crises/{id:guid}/response-status")]
    public async Task<Crisis> SetResponseStatus(Guid id, ResponseStatusInput input, CancellationToken ct)
    {
        var crisis = await CoordinatedCrisis(id, ct);
        if (input.Active is not bool active) throw new RuleException("Specify the response status.");
        if (crisis.Active == active) return crisis;
        crisis.Active = active;
        ops.Audit("CrisisUpdated", crisis, active ? "Response reopened" : "Response ended");
        await db.SaveChangesAsync(ct);
        return crisis;
    }

    private bool OutsideSelectedCountry(string country) =>
        access.SelectedCountry is { } selected && selected != country;

    private async Task<Crisis> CoordinatedCrisis(Guid id, CancellationToken ct)
    {
        if (!await access.Coordinates(id, ct)) throw new AccessDeniedException();
        var crisis = await db.Set<Crisis>().FindAsync([id], ct) ?? throw new MissingException();
        if (OutsideSelectedCountry(crisis.CountryCode)) throw new AccessDeniedException();
        return crisis;
    }

    public sealed record ResponseStatusInput(bool? Active);

    [HttpGet("crises/{id:guid}/areas")]
    public async Task<object> Areas(Guid id, CancellationToken ct)
    {
        await CoordinatedCrisis(id, ct);
        return await db.Set<OperationalArea>().Where(x => x.CrisisId == id).OrderBy(x => x.Name).ToListAsync(ct);
    }
    [HttpPost("crises/{id:guid}/areas")]
    public async Task<OperationalArea> AddArea(Guid id, OperationalArea input, CancellationToken ct)
    {
        var crisis = await CoordinatedCrisis(id, ct);
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 150 || string.IsNullOrWhiteSpace(input.GeoJson) || input.GeoJson.Length > 4000)
            throw new RuleException("Provide a name and a GeoJSON geometry under 4,000 characters.");
        try
        {
            using var json = System.Text.Json.JsonDocument.Parse(input.GeoJson);
            if (json.RootElement.ValueKind != System.Text.Json.JsonValueKind.Object
                || !json.RootElement.TryGetProperty("type", out var type)
                || type.ValueKind != System.Text.Json.JsonValueKind.String
                || type.GetString() is not ("Polygon" or "MultiPolygon")
                || !json.RootElement.TryGetProperty("coordinates", out var coordinates)
                || coordinates.ValueKind != System.Text.Json.JsonValueKind.Array || coordinates.GetArrayLength() == 0)
                throw new RuleException("Use a Polygon or MultiPolygon.");
        }
        catch (System.Text.Json.JsonException) { throw new RuleException("Invalid GeoJSON."); }
        var area = new OperationalArea { CrisisId = id, Name = input.Name.Trim(), GeoJson = input.GeoJson };
        db.Add(area);
        db.Entry(crisis).Property(x => x.UpdatedAt).IsModified = true;
        ops.Audit("OperationalAreaCreated", area, countryCode: crisis.CountryCode);
        await db.SaveChangesAsync(ct);
        return area;
    }
    [HttpDelete("crises/{id:guid}/areas/{areaId:guid}")]
    public async Task<IActionResult> RemoveArea(Guid id, Guid areaId, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var crisis = await CoordinatedCrisis(id, ct);
        var area = await db.Set<OperationalArea>().SingleOrDefaultAsync(x => x.Id == areaId && x.CrisisId == id, ct)
            ?? throw new MissingException();
        if (await db.Set<LogisticsOrder>().AnyAsync(x => x.OperationalAreaId == areaId, ct))
            throw new RuleException("This area is linked to a logistics order and must be kept for its history.");
        db.Remove(area);
        db.Entry(crisis).Property(x => x.UpdatedAt).IsModified = true;
        ops.Audit("OperationalAreaRemoved", area, area.Name, crisis.CountryCode);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return NoContent();
    }

    [AllowAnonymous, EnableRateLimiting("maps"), HttpGet("maps/geocode")]
    public async Task<IActionResult> Geocode(string query, CancellationToken ct, string countryCode = "LK")
    {
        if (string.IsNullOrWhiteSpace(query) || query.Length > 150 || countryCode is not ("LK" or "IN" or "NP"))
            return BadRequest();
        var result = await cache.GetOrCreateAsync("geo:" + countryCode + ":" + query.Trim().ToLowerInvariant(),
            async entry => { entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(12); return await maps.GeocodeAsync(query, ct, countryCode); });
        return result is null ? StatusCode(503, new ProblemDetails { Title = "Location search unavailable. Enter a location or select a map point.", Status = 503 }) : Ok(result);
    }
    [EnableRateLimiting("maps"), HttpPost("maps/reverse-geocode")]
    public async Task<IActionResult> ReverseGeocode(ReverseGeocodeInput input, CancellationToken ct, string? countryCode = null)
    {
        if (input.Latitude is not double lat || input.Longitude is not double lng ||
            !double.IsFinite(lat) || !double.IsFinite(lng) || lat is < -90 or > 90 || lng is < -180 or > 180 ||
            countryCode is not (null or "LK" or "IN" or "NP"))
            return BadRequest();
        Response.Headers.CacheControl = "no-store";
        var result = await maps.ReverseGeocodeAsync(lat, lng, ct, countryCode);
        return result is null ? StatusCode(503, new ProblemDetails { Title = "Reverse geocoding unavailable. Enter a location manually.", Status = 503 }) : Ok(result);
    }
    [EnableRateLimiting("maps"), HttpGet("maps/route")]
    public async Task<IActionResult> Route(double startLat, double startLng, double endLat, double endLng, CancellationToken ct)
    {
        if (!double.IsFinite(startLat) || !double.IsFinite(startLng) || !double.IsFinite(endLat) || !double.IsFinite(endLng) ||
            startLat is < -90 or > 90 || endLat is < -90 or > 90 || startLng is < -180 or > 180 || endLng is < -180 or > 180)
            return BadRequest();
        var result = await maps.RouteAsync(startLat, startLng, endLat, endLng, ct);
        Response.Headers["X-Surakuma-Route-Type"] = "ordinary-driving";
        return result is null ? StatusCode(503, new ProblemDetails { Title = "Routing unavailable. No route or safe-travel estimate is being assumed.", Status = 503 }) : Ok(result);
    }
    private async Task Admin(CancellationToken ct)
    {
        if (!await access.IsAdmin(ct))
            throw new AccessDeniedException();
    }
    [HttpGet("admin/users")]
    public async Task<object> Users(CancellationToken ct, string? countryCode = null, string? search = null,
        string? role = null, int page = 1, int pageSize = 10, bool includeTotal = false)
    {
        bool global = await access.IsAdmin(ct);
        if (!global && (countryCode == null || !await access.CountryAccess(countryCode, [], ct))) throw new AccessDeniedException();
        var visible = db.Set<Membership>().IgnoreQueryFilters().Where(m => (countryCode == null || m.CountryCode == countryCode) && m.Role != Roles.Administrator);
        var localRequesters = from request in db.Set<AssistanceRequest>()
                              join crisis in db.Set<Crisis>() on request.CrisisId equals crisis.Id
                              where crisis.CountryCode == countryCode
                              select request.CitizenId;
        var usersQuery = db.Users.Where(u => (global || !u.IsSystemAdministrator)
            && (countryCode == null || u.IsSystemAdministrator || visible.Any(m => m.UserId == u.Id) || localRequesters.Contains(u.Id)));
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            usersQuery = usersQuery.Where(u => u.DisplayName.Contains(term) || (u.Email != null && u.Email.Contains(term)));
        }
        if (role == "NoStaffRoles")
            usersQuery = usersQuery.Where(u => !u.IsSystemAdministrator && !visible.Any(m => m.UserId == u.Id));
        else if (role == Roles.Administrator)
            usersQuery = usersQuery.Where(u => u.IsSystemAdministrator);
        else if (!string.IsNullOrEmpty(role))
            usersQuery = usersQuery.Where(u => visible.Any(m => m.UserId == u.Id && m.Role == role));

        var accountEvents = db.Set<AuditEvent>().Where(a => a.Action == "CitizenRegistered" || a.Action == "StaffAccountCreated");
        var directory = usersQuery.Select(u => new
        {
            u.Id, Name = u.DisplayName, u.Email, u.Language, u.Disabled, u.IsSystemAdministrator,
            CreatedAt = accountEvents.Where(a => (a.Action == "CitizenRegistered" && a.ActorId == u.Id)
                || (a.Action == "StaffAccountCreated" && a.EntityId.ToString() == u.Id))
                .Min(a => (DateTimeOffset?)a.CreatedAt),
            FirstGrantAt = visible.Where(m => m.UserId == u.Id).Min(m => (DateTimeOffset?)m.CreatedAt),
            FirstActivityAt = db.Set<AuditEvent>().Where(a => a.ActorId == u.Id && (countryCode == null || a.CountryCode == countryCode)).Min(a => (DateTimeOffset?)a.CreatedAt)
        });
        int total = includeTotal ? await usersQuery.CountAsync(ct) : 0;
        pageSize = includeTotal ? Math.Clamp(pageSize, 1, 100) : 100;
        page = includeTotal ? Math.Clamp(page, 1, Math.Max(1, (int)Math.Ceiling(total / (double)pageSize))) : 1;
        var items = await directory
            .OrderByDescending(u => u.CreatedAt ?? (u.FirstActivityAt == null || u.FirstGrantAt < u.FirstActivityAt
                ? u.FirstGrantAt : u.FirstActivityAt))
            .ThenBy(u => u.Name).ThenBy(u => u.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(u => new
            {
                u.Id, u.Name, u.Email, u.Language, u.Disabled, u.IsSystemAdministrator, u.CreatedAt,
                FirstRecordedAt = u.FirstActivityAt == null || u.FirstGrantAt < u.FirstActivityAt
                    ? u.FirstGrantAt : u.FirstActivityAt,
                Memberships = visible.Where(m => m.UserId == u.Id).ToList()
            }).ToListAsync(ct);
        return includeTotal ? new { items, total, pageNumber = page, pageSize } : (object)items;
    }
    [HttpPost("admin/users")]
    public async Task<object> AddStaff(StaffInput input, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var administratorRole = input.Role is Roles.CountryAdministrator or Roles.Administrator;
        var global = await access.IsAdmin(ct);
        if (!global && (administratorRole || !await access.CountryAccess(input.CountryCode, [], ct))) throw new AccessDeniedException();
        if (input.CrisisId.HasValue && administratorRole) throw new RuleException("Administrator grants cannot be limited to a crisis. Choose a crisis staff role instead.");
        if (!await db.Set<Country>().AnyAsync(x => x.Code == input.CountryCode, ct) || (input.CrisisId.HasValue && !await db.Set<Crisis>().AnyAsync(x => x.Id == input.CrisisId && x.CountryCode == input.CountryCode, ct))) throw new RuleException("Invalid country or crisis scope.");
        if (!Roles.All.Contains(input.Role) || input.Role == Roles.Citizen) throw new RuleException("Choose a valid staff role.");
        var organisationId = administratorRole ? null : input.OrganisationId;
        if (!administratorRole)
        {
            if (!organisationId.HasValue) throw new RuleException("Choose a staff organisation.");
            await access.RequirePartner(organisationId.Value, input.CountryCode, ct);
        }
        var user = await users.FindByEmailAsync(input.Email);
        if (input.Role == Roles.Administrator)
        {
            var target = user ?? throw new RuleException("Choose an existing account for system administrator access.");
            if (target.Disabled) throw new RuleException("Reactivate the account first.");
            if (target.IsSystemAdministrator) throw new RuleException("The account already has system administrator access.");
            var proposal = new AdminProposal { Kind = "GlobalAccess", CountryCode = input.CountryCode, RequesterUserId = access.UserId, Reason = "Global administrator access requested", OriginalVersion = target.SecurityStamp ?? "", Payload = System.Text.Json.JsonSerializer.Serialize(new AdministrationController.GrantPayload(target.Id)) };
            db.Add(proposal);
            ops.Audit("AdministrationProposalCreated", proposal);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return new { proposal.Id, proposal.State };
        }
        if (!global && user?.IsSystemAdministrator == true) throw new AccessDeniedException();
        if (user is null)
        {
            if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 100 || input.Password is null || input.Password.Length < 10)
                throw new RuleException("Provide a name and an initial password of at least 10 characters for the new account.");
            user = new AppUser { UserName = input.Email, Email = input.Email, DisplayName = input.Name, LockoutEnabled = true };
            var result = await users.CreateAsync(user, input.Password);
            if (!result.Succeeded)
                throw new RuleException(string.Join(" ", result.Errors.Select(x => x.Description)));
            db.Add(new AuditEvent
            {
                Action = "StaffAccountCreated", ActorId = access.UserId,
                EntityType = "User", EntityId = Guid.Parse(user.Id), CountryCode = input.CountryCode, Detail = "Staff account created."
            });
        }
        if (!await users.IsInRoleAsync(user, input.Role))
            await users.AddToRoleAsync(user, input.Role);
        var grant = await db.Set<Membership>().IgnoreQueryFilters().SingleOrDefaultAsync(x => x.UserId == user.Id
            && x.Role == input.Role && x.OrganisationId == organisationId && x.CountryCode == input.CountryCode && x.CrisisId == input.CrisisId, ct);
        if (grant is null)
        {
            grant = new Membership { UserId = user.Id, Role = input.Role, OrganisationId = organisationId, CountryCode = input.CountryCode, CrisisId = input.CrisisId };
            db.Add(grant);
        }
        else if (grant.Suspended)
            throw new RuleException("Reactivate the existing grant from Account actions.");
        if (input.CrisisId.HasValue && input.Role != Roles.FundingOfficer &&
            !await db.Set<CrisisAssignment>().AnyAsync(x => x.UserId == user.Id && x.CrisisId == input.CrisisId, ct))
            db.Add(new CrisisAssignment { UserId = user.Id, CrisisId = input.CrisisId.Value });
        if (!(await users.UpdateSecurityStampAsync(user)).Succeeded) throw new RuleException("Could not invalidate sessions.");
        foreach (var session in await db.Set<RefreshSession>().Where(x => x.UserId == user.Id && !x.Revoked).ToListAsync(ct)) session.Revoked = true;
        ops.Audit("StaffAccessGranted", grant, input.Role);
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
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
        var membership = await db.Set<Membership>().IgnoreQueryFilters().SingleOrDefaultAsync(m => m.Id == id, ct) ?? throw new MissingException();
        var global = await access.IsAdmin(ct);
        if (!global && !await access.CountryAccess(membership.CountryCode, [], ct)) throw new AccessDeniedException();
        if (membership.UserId == access.UserId)
            throw new RuleException("Ask another administrator to change your access.");
        var user = await users.FindByIdAsync(membership.UserId) ?? throw new MissingException();
        if (!global && (user.IsSystemAdministrator || membership.Role is Roles.Administrator or Roles.CountryAdministrator)) throw new AccessDeniedException();
        bool otherMembership = await db.Set<Membership>().IgnoreQueryFilters().AnyAsync(x => x.Id != id && x.UserId == membership.UserId && x.Role == membership.Role, ct);
        db.Remove(membership);
        if (!otherMembership && await users.IsInRoleAsync(user, membership.Role))
        {
            var result = await users.RemoveFromRoleAsync(user, membership.Role);
            if (!result.Succeeded) throw new RuleException("Could not remove the user's role.");
        }
        var stampResult = await users.UpdateSecurityStampAsync(user);
        if (!stampResult.Succeeded) throw new RuleException("Could not invalidate the user's sessions.");
        foreach (var session in await db.Set<RefreshSession>().Where(x => x.UserId == user.Id && !x.Revoked).ToListAsync(ct))
            session.Revoked = true;
        ops.Audit("StaffAccessRevoked", membership);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return NoContent();
    }
    [HttpGet("admin/organisations")]
    public async Task<object> Organisations(string countryCode, CancellationToken ct)
    {
        var global = await access.IsAdmin(ct);
        if (!global && !await access.CountryAccess(countryCode, [], ct)) throw new AccessDeniedException();
        if (!await db.Set<Country>().AnyAsync(x => x.Code == countryCode, ct)) throw new MissingException();
        var enabled = db.Set<OrganisationCountry>().Where(x => x.CountryCode == countryCode);
        return await db.Set<Organisation>().Where(x => enabled.Any(e => e.OrganisationId == x.Id))
            .OrderBy(x => x.Name).ThenBy(x => x.Id)
            .Select(x => new
            {
                x.Id, x.Name,
                Verification = enabled.Where(e => e.OrganisationId == x.Id).FirstOrDefault(),
                Enabled = enabled.Any(e => e.OrganisationId == x.Id),
                PrimaryCrises = db.Set<Crisis>()
                    .Where(c => c.CountryCode == countryCode && c.Active && c.PrimaryOrganisationId == x.Id)
                    .OrderBy(c => c.Name).ThenBy(c => c.Id).Select(c => new { c.Id, c.Name }).ToList()
            }).ToListAsync(ct);
    }

    [HttpPost("admin/organisations")]
    public async Task<Organisation> AddOrg(OrganisationInput input, CancellationToken ct)
    {
        await Admin(ct);
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 150)
            throw new RuleException("Provide an organisation name under 150 characters.");
        if (!await db.Set<Country>().AnyAsync(x => x.Code == input.CountryCode, ct)) throw new RuleException("Choose a supported country.");
        var org = new Organisation { Name = input.Name.Trim() };
        db.Add(org);
        db.Add(new OrganisationCountry { OrganisationId = org.Id, CountryCode = input.CountryCode });
        ops.Audit("OrganisationCreated", org, countryCode: input.CountryCode);
        await db.SaveChangesAsync(ct);
        return org;
    }
    [HttpGet("admin/audit")]
    public async Task<object> Audit(CancellationToken ct, int page = 1, int pageSize = 50, bool includeTotal = false, string? countryCode = null,
        string? action = null, string? actor = null, string? search = null, DateTimeOffset? from = null, DateTimeOffset? to = null,
        DateTimeOffset? today = null)
    {
        await Admin(ct);
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 50);
        var scope = db.Set<AuditEvent>().Where(x => countryCode == null || x.CountryCode == countryCode);
        var query = scope.Where(x => (action == null || x.Action == action) && (from == null || x.CreatedAt >= from)
            && (to == null || x.CreatedAt < to)).Select(x => new
        {
            x.Id, x.ActorId, x.Action, x.EntityType, x.EntityId, x.Detail, x.CountryCode, x.CreatedAt, x.UpdatedAt, x.Version,
            ActorName = db.Users.Where(u => u.Id == x.ActorId).Select(u => u.DisplayName).FirstOrDefault()
        }).Where(x => (actor == null || x.ActorId == actor || (x.ActorName != null && x.ActorName.Contains(actor)))
            && (search == null || x.Action.Contains(search) || x.Detail.Contains(search) || x.EntityType.Contains(search)
                || x.EntityId.ToString().Contains(search) || (x.EntityType == nameof(AssistanceRequest)
                    && db.Set<AssistanceRequest>().Any(r => r.Id == x.EntityId && r.Reference.Contains(search)))));
        var total = includeTotal ? await query.CountAsync(ct) : 0;
        var items = await query.OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        if (includeTotal && today is { } start)
        {
            string[] highRiskActions = ["SystemAdministratorGranted", "SystemAdministratorRevoked", "StaffAccessRevoked", "StaffSuspended",
                "AccountDisabled", "AccountDeleted", "OrganisationArchived", "CountryServicesConfigured", "DeliveryRetry", "DeliveryAccepted"];
            var todayEvents = scope.Where(x => x.CreatedAt >= start && x.CreatedAt < start.AddDays(1));
            var summary = await todayEvents.GroupBy(_ => 1).Select(g => new { EventsToday = g.Count(),
                HighRiskToday = g.Count(e => highRiskActions.Contains(e.Action)) }).FirstOrDefaultAsync(ct);
            return new { items, total, pageNumber = page, pageSize, summary };
        }
        return includeTotal ? new { items, total, pageNumber = page, pageSize } : (object)items;
    }
    [HttpGet("admin/deliveries")]
    public async Task<object> Deliveries(CancellationToken ct, int page = 1, int pageSize = 100, bool includeTotal = false, string? countryCode = null,
        string? state = null, string? search = null, DateTimeOffset? from = null, DateTimeOffset? to = null, bool dashboard = false)
    {
        await Admin(ct);
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var scope = db.DeliveriesInCountry(countryCode);
        var attempts = db.Set<DeliveryAttempt>();
        var query = scope.Where(x => (state == null || x.State == state) && (from == null || x.CreatedAt >= from)
            && (to == null || x.CreatedAt < to)).Select(x => new
        {
            x.Id, x.State, x.Attempts, x.LastError, x.CreatedAt,
            EventMessage = x.Message,
            RecipientName = db.Users.Where(u => u.Id == x.UserId).Select(u => u.DisplayName).FirstOrDefault(),
            CaseReference = db.Set<AssistanceRequest>().Where(r => r.Id == x.RequestId).Select(r => r.Reference).FirstOrDefault(),
            Provider = db.Set<NotificationDelivery>().Where(d => d.EventId == x.Id && d.RecipientId == x.UserId).Select(d => d.Provider).FirstOrDefault(),
            InAppStored = dashboard && db.Set<Notification>().Any(n => n.EventId == x.Id && n.UserId == x.UserId && n.RequestId == x.RequestId),
            Recovered = dashboard && x.State == "Sent" && attempts.Any(a => a.EventId == x.Id && (a.State == "Failed" || a.State == "Retry" || a.State == "Review")),
        }).Where(x => search == null || x.EventMessage.Contains(search) || (x.CaseReference != null && x.CaseReference.Contains(search))
            || (x.RecipientName != null && x.RecipientName.Contains(search)));
        var total = includeTotal ? await query.CountAsync(ct) : 0;
        var items = await query.OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        if (includeTotal && dashboard)
        {
            var failed = await scope.CountAsync(x => x.State == "Failed", ct);
            var recovered = await scope.CountAsync(x => x.State == "Sent" && attempts.Any(a => a.EventId == x.Id && (a.State == "Failed" || a.State == "Retry" || a.State == "Review")), ct);
            var retrying = await scope.CountAsync(x => x.State == "Retry" || (x.Attempts > 0 && (x.State == "Pending" || x.State == "Processing")), ct);
            var causes = await scope.Where(x => x.State == "Failed").GroupBy(x => x.LastError)
                .Select(g => new { Reason = g.Key, Count = g.Count() }).OrderByDescending(x => x.Count).ThenBy(x => x.Reason).Take(3).ToListAsync(ct);
            return new { items, total, pageNumber = page, pageSize, summary = new { failed, recovered, retrying, causes } };
        }
        return includeTotal ? new { items, total, pageNumber = page, pageSize } : (object)items;
    }
}

public sealed record AlertTranslation(string Title, string Message);
public sealed record OrganisationInput(string Name, string CountryCode = "LK");
