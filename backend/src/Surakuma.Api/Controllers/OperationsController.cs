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
public sealed class OperationsController(Operations ops, AccessService access, CrisisDbContext db, UserManager<AppUser> users, IMappingProvider maps, IMemoryCache cache, InternalNotifications notifications) : ControllerBase
{
    [AllowAnonymous, HttpGet("public/lookups")] public Task<PublicLookups> Lookups(CancellationToken ct, string countryCode = "LK") => ops.PublicData(ct, countryCode);
    [AllowAnonymous, HttpGet("alerts")] public Task<List<PublicAlert>> Alerts(CancellationToken ct, string countryCode = "LK") => ops.Alerts(ct, countryCode);
    [AllowAnonymous, HttpGet("shelters")] public Task<List<PublicShelter>> Shelters(CancellationToken ct, string countryCode = "LK") => ops.PublicShelters(ct, countryCode);
    [HttpGet("staff/shelters")] public Task<List<Shelter>> StaffShelters(CancellationToken ct) => ops.StaffShelters(ct);
    [HttpGet("reports/metrics")] public Task<object> Metrics(CancellationToken ct) => ops.Metrics(ct);
    [HttpGet("requests/{id:guid}/resources")] public Task<List<Resource>> CaseResources(Guid id, CancellationToken ct) => ops.CaseResources(id, ct);
    [HttpGet("requests/{id:guid}/shelters")] public Task<List<Shelter>> CaseShelters(Guid id, CancellationToken ct) => ops.CaseShelters(id, ct);
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
    [HttpPost("allocations/{id:guid}/{operation}")] public Task<ResourceAllocation> Allocation(Guid id, string operation, CancellationToken ct) => ops.UpdateAllocation(id, operation, ct);
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
        return new { roster.Profiles, roster.Tasks, Names = names };
    }
    [HttpPost("volunteers")] public Task<VolunteerProfile> Volunteer(VolunteerProfile input, CancellationToken ct) => ops.SaveVolunteer(input, ct);
    [HttpPost("volunteer-tasks")] public Task<VolunteerTask> Task(TaskInput input, CancellationToken ct) => ops.AssignTask(input, ct);
    [HttpPost("volunteer-tasks/{id:guid}")] public Task<VolunteerTask> UpdateTask(Guid id, TaskUpdateInput input, CancellationToken ct) => ops.UpdateTask(id, input, ct);
    [HttpGet("notifications")]
    public async Task<List<Notification>> Notifications(CancellationToken ct, bool unreadOnly = false)
    {
        var query = VisibleNotifications();
        if (unreadOnly)
            query = query.Where(n => !n.Read);
        return await query.OrderByDescending(n => n.CreatedAt).Take(100).ToListAsync(ct);
    }
    [HttpGet("notifications/unread-count")]
    public async Task<object> UnreadNotifications(CancellationToken ct) => new { count = await VisibleNotifications().CountAsync(x => !x.Read, ct) };
    private IQueryable<Notification> VisibleNotifications()
    {
        if (!NotificationChannels.ReceivesCitizenEmail(User.FindAll(ClaimTypes.Role).Select(c => c.Value)))
            return notifications.Visible(access.UserId, access.SelectedCountry);
        var citizen = db.Set<Notification>().Where(n => !n.IsInternal && n.UserId == access.UserId
            && db.Set<AssistanceRequest>().Any(r => r.Id == n.RequestId && r.CitizenId == access.UserId
                && db.Set<Crisis>().Any(c => c.Id == r.CrisisId
                    && (access.SelectedCountry == null || c.CountryCode == access.SelectedCountry))));
        return citizen.Union(notifications.Visible(access.UserId, access.SelectedCountry));
    }
    [HttpPost("notifications/{id:guid}/read")]
    public async Task<IActionResult> Read(Guid id, CancellationToken ct)
    {
        var visible = VisibleNotifications().Where(n => n.Id == id);
        if (await MarkNotificationsRead(visible, ct) == 0 && !await visible.AnyAsync(ct))
            throw new MissingException();
        return NoContent();
    }
    [HttpPost("notifications/read-all")]
    public async Task<IActionResult> ReadAll(CancellationToken ct)
    {
        await MarkNotificationsRead(VisibleNotifications(), ct);
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
        if (!await access.IsAdmin(ct) && !await access.Coordinates(id, ct)) throw new AccessDeniedException();
        var crisis = await db.Set<Crisis>().FindAsync([id], ct) ?? throw new MissingException();
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
        if (!await access.CountryAccess(input.CountryCode, [Roles.Coordinator], ct))
            throw new AccessDeniedException();
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 150 || input.Latitude is < -90 or > 90 || input.Longitude is < -180 or > 180)
            throw new RuleException("Provide a crisis name and valid coordinates.");
        if (input.InternationalIncidentId.HasValue) throw new RuleException("Create a separate crisis for each country.");
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
        ops.Audit("OperationalAreaCreated", area, countryCode: await db.Set<Crisis>().Where(x => x.Id == id).Select(x => x.CountryCode).SingleAsync(ct));
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
        var countryCode = await db.Set<Crisis>().Where(x => x.Id == input.CrisisId).Select(x => x.CountryCode).SingleAsync(ct);
        var policy = await db.Set<Country>().SingleAsync(x => x.Code == countryCode, ct);
        Dictionary<string, AlertTranslation> translations;
        try { translations = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, AlertTranslation>>(input.TranslationsJson, new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? []; }
        catch (System.Text.Json.JsonException) { throw new RuleException("Invalid alert translations."); }
        translations["en"] = new(input.Title, input.Message);
        if (!string.IsNullOrWhiteSpace(input.SinhalaTitle)) translations["si"] = new(input.SinhalaTitle, input.SinhalaMessage);
        if (!string.IsNullOrWhiteSpace(input.TamilTitle)) translations["ta"] = new(input.TamilTitle, input.TamilMessage);
        if (translations.Any(x => x.Value == null || x.Value.Title == null || x.Value.Message == null || x.Value.Title.Length > 150 || x.Value.Message.Length > 2000)) throw new RuleException("Alert translations exceed the allowed length.");
        if (input.Published && policy.RequiredAlertLanguages.Split(',').Any(language => !translations.TryGetValue(language, out var text) || string.IsNullOrWhiteSpace(text.Title) || string.IsNullOrWhiteSpace(text.Message)))
            throw new RuleException("Provide alert wording in all required country languages: " + policy.RequiredAlertLanguages);
        var extraTranslations = System.Text.Json.JsonSerializer.Serialize(translations.Where(x => x.Key is not ("en" or "si" or "ta")).ToDictionary(x => x.Key, x => x.Value), new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase });
        if (extraTranslations.Length > 4000) throw new RuleException("Additional translations exceed the supported size.");
        var alert = new PublicAlert { TranslationsJson = extraTranslations, CrisisId = input.CrisisId, Title = input.Title, Message = input.Message, SinhalaTitle = input.SinhalaTitle, SinhalaMessage = input.SinhalaMessage, TamilTitle = input.TamilTitle, TamilMessage = input.TamilMessage, Severity = input.Severity, Area = input.Area, Authority = input.Authority, ExpiresAt = input.ExpiresAt, Published = input.Published };
        db.Add(alert);
        ops.Audit("PublicAlertCreated", alert, countryCode: countryCode);
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
        ops.Audit("PublicAlertUnpublished", a, countryCode: await db.Set<Crisis>().Where(x => x.Id == a.CrisisId).Select(x => x.CountryCode).SingleAsync(ct));
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
    [EnableRateLimiting("maps"), HttpPost("maps/reverse-geocode")]
    public async Task<IActionResult> ReverseGeocode(ReverseGeocodeInput input, CancellationToken ct)
    {
        if (input.Latitude is not double lat || input.Longitude is not double lng ||
            !double.IsFinite(lat) || !double.IsFinite(lng) || lat is < -90 or > 90 || lng is < -180 or > 180)
            return BadRequest();
        Response.Headers.CacheControl = "no-store";
        var result = await maps.ReverseGeocodeAsync(lat, lng, ct);
        return result is null ? StatusCode(503, new ProblemDetails { Title = "Reverse geocoding unavailable. Enter a location manually.", Status = 503 }) : Ok(result);
    }
    [EnableRateLimiting("maps"), HttpGet("maps/route")]
    public async Task<IActionResult> Route(double startLat, double startLng, double endLat, double endLng, CancellationToken ct)
    {
        if (!double.IsFinite(startLat) || !double.IsFinite(startLng) || !double.IsFinite(endLat) || !double.IsFinite(endLng) ||
            startLat is < -90 or > 90 || endLat is < -90 or > 90 || startLng is < -180 or > 180 || endLng is < -180 or > 180)
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
        if (input.CrisisId.HasValue && !await db.Set<CrisisAssignment>().AnyAsync(x => x.UserId == user.Id && x.CrisisId == input.CrisisId, ct))
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
    public async Task<object> Audit(CancellationToken ct, int page = 1, int pageSize = 50, bool includeTotal = false, string? countryCode = null)
    {
        await Admin(ct);
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 50);
        var query = db.Set<AuditEvent>().Where(x => countryCode == null || x.CountryCode == countryCode);
        var total = includeTotal ? await query.CountAsync(ct) : 0;
        var items = await query.OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id).Skip((page - 1) * pageSize).Take(pageSize).Select(x => new
        {
            x.Id, x.ActorId, x.Action, x.EntityType, x.EntityId, x.Detail, x.CreatedAt, x.UpdatedAt, x.Version,
            ActorName = db.Users.Where(u => u.Id == x.ActorId).Select(u => u.DisplayName).FirstOrDefault()
        }).ToListAsync(ct);
        return includeTotal ? new { items, total, pageNumber = page, pageSize } : (object)items;
    }
    [HttpGet("admin/deliveries")]
    public async Task<object> Deliveries(CancellationToken ct, int page = 1, int pageSize = 100, bool includeTotal = false, string? countryCode = null)
    {
        await Admin(ct);
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var query = db.DeliveriesInCountry(countryCode);
        var total = includeTotal ? await query.CountAsync(ct) : 0;
        var items = await query.OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id).Skip((page - 1) * pageSize).Take(pageSize).Select(x => new
        {
            x.Id, x.State, x.Attempts, x.LastError, x.CreatedAt,
            EventMessage = x.Message,
            RecipientName = db.Users.Where(u => u.Id == x.UserId).Select(u => u.DisplayName).FirstOrDefault(),
            CaseReference = db.Set<AssistanceRequest>().Where(r => r.Id == x.RequestId).Select(r => r.Reference).FirstOrDefault(),
            Provider = db.Set<NotificationDelivery>().Where(d => d.EventId == x.Id && d.RecipientId == x.UserId).Select(d => d.Provider).FirstOrDefault()
        }).ToListAsync(ct);
        return includeTotal ? new { items, total, pageNumber = page, pageSize } : (object)items;
    }
}

public sealed record AlertTranslation(string Title, string Message);
public sealed record OrganisationInput(string Name, string CountryCode = "LK");
