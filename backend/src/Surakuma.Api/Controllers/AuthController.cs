using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Api.Controllers;

[ApiController, Route("api/v1/auth"), EnableRateLimiting("auth")]
public sealed class AuthController(AuthenticationService auth, UserManager<AppUser> users, CrisisDbContext db, IConfiguration config) : ControllerBase
{
    public sealed record PreferenceInput(bool DispatchUpdates, bool StockAlerts, bool SupplyUpdates, bool AssignmentUpdates);
    [Authorize, HttpGet("logistics-preferences")]
    public async Task<object> Preferences(CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        if (!await db.Set<Membership>().AnyAsync(m => m.UserId == userId && m.Role == Roles.Logistics, ct)) throw new AccessDeniedException();
        return (object?)await db.Set<LogisticsPreferences>().SingleOrDefaultAsync(p => p.UserId == userId, ct) ??
            new PreferenceInput(true, true, true, true);
    }

    [Authorize, HttpPut("logistics-preferences")]
    public async Task<object> Preferences(PreferenceInput input, CancellationToken ct)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        if (!await db.Set<Membership>().AnyAsync(m => m.UserId == userId && m.Role == Roles.Logistics, ct)) throw new AccessDeniedException();
        var row = await db.Set<LogisticsPreferences>().SingleOrDefaultAsync(p => p.UserId == userId, ct);
        if (row == null) { row = new LogisticsPreferences { UserId = userId }; db.Add(row); }
        row.DispatchUpdates = input.DispatchUpdates;
        row.StockAlerts = input.StockAlerts;
        row.SupplyUpdates = input.SupplyUpdates;
        row.AssignmentUpdates = input.AssignmentUpdates;
        await db.SaveChangesAsync(ct);
        return input;
    }
    private const string CookieName = "surakuma.refresh";
    private void SetCookie(string token) => Response.Cookies.Append(CookieName, token, new CookieOptions { HttpOnly = true, Secure = true, SameSite = SameSiteMode.Lax, Path = "/api/v1/auth", MaxAge = TimeSpan.FromDays(7) });
    private bool ValidOrigin() => !Request.Headers.ContainsKey("Origin") || (config.GetSection("Cors:Origins").Get<string[]>() ?? []).Contains(Request.Headers.Origin.ToString());
    [HttpPost("register")]
    public async Task<IActionResult> Register(RegisterInput input, CancellationToken ct)
    {
        if (!ValidOrigin())
            return Forbid();
        return SignIn(await auth.Register(input, ct));
    }
    [HttpPost("donor/register")]
    public async Task<IActionResult> RegisterDonor(RegisterDonorInput input, CancellationToken ct)
    {
        if (!ValidOrigin())
            return Forbid();
        return SignIn(await auth.RegisterDonor(input, ct));
    }
    [HttpPost("login")]
    public Task<IActionResult> Login(LoginInput input, CancellationToken ct) => LoginAccount(input, false, ct);

    [HttpPost("donor/login")]
    public Task<IActionResult> LoginDonor(LoginInput input, CancellationToken ct) => LoginAccount(input, true, ct);

    private async Task<IActionResult> LoginAccount(LoginInput input, bool donorOnly, CancellationToken ct)
    {
        if (!ValidOrigin())
            return Forbid();
        var r = await auth.Login(input, ct, donorOnly);
        if (r is null)
            return Unauthorized(new ProblemDetails { Title = "Email or password is incorrect, or the account is temporarily locked.", Status = 401 });
        return SignIn(r);
    }

    private IActionResult SignIn(AuthSession r)
    {
        SetCookie(r.RefreshToken);
        return Ok(new
        {
            r.AccessToken,
            r.User
        });
    }
    [HttpPost("refresh")]
    public async Task<IActionResult> Refresh(CancellationToken ct)
    {
        if (!ValidOrigin())
            return Forbid();
        if (!Request.Cookies.TryGetValue(CookieName, out var token))
            return Unauthorized();
        var r = await auth.Refresh(token, ct);
        if (r is null)
        {
            Response.Cookies.Delete(CookieName, new CookieOptions { Path = "/api/v1/auth", Secure = true });
            return Unauthorized();
        }
        SetCookie(r.RefreshToken);
        return Ok(new
        {
            r.AccessToken,
            r.User
        });
    }
    [HttpPost("logout")]
    public async Task<IActionResult> Logout(CancellationToken ct)
    {
        if (!ValidOrigin())
            return Forbid();
        if (Request.Cookies.TryGetValue(CookieName, out var token))
            await auth.Logout(token, ct);
        Response.Cookies.Delete(CookieName, new CookieOptions { Path = "/api/v1/auth", Secure = true });
        return NoContent();
    }
    [Authorize, HttpGet("me")] public async Task<object> Me(CancellationToken ct) => await auth.UserInfo(await users.FindByIdAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!) ?? throw new AccessDeniedException(), ct);

    [Authorize, HttpGet("profile")]
    public async Task<object> ProfileDetails(CancellationToken ct)
    {
        var user = await users.FindByIdAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!) ?? throw new AccessDeniedException();
        var assignments = await db.Set<Membership>()
            .Where(m => m.UserId == user.Id && m.Role != Roles.Citizen)
            .OrderBy(m => m.Role).ThenBy(m => m.CountryCode).ThenBy(m => m.Id)
            .Select(m => new
            {
                m.Id,
                m.Role,
                m.CountryCode,
                m.DepotId,
                Depot = db.Set<Depot>().Where(d => d.Id == m.DepotId).Select(d => d.Name).FirstOrDefault(),
                Country = db.Set<Country>().Where(c => c.Code == m.CountryCode).Select(c => c.Name).FirstOrDefault() ?? m.CountryCode,
                Organisation = db.Set<Organisation>().Where(o => o.Id == m.OrganisationId).Select(o => o.Name).FirstOrDefault(),
                Crisis = db.Set<Crisis>().Where(c => c.Id == m.CrisisId && c.CountryCode == m.CountryCode).Select(c => c.Name).FirstOrDefault(),
                m.AvailableForAssignment,
                PartnerStatus = m.Role == Roles.Partner
                    ? db.Set<OrganisationCountry>().Where(o => o.OrganisationId == m.OrganisationId && o.CountryCode == m.CountryCode)
                        .Select(o => o.VerificationState).FirstOrDefault()
                    : null
            })
            .ToListAsync(ct);
        var volunteer = await OwnVolunteerProfile(user.Id)
            .Select(v => new { v.Skills, v.Verified, v.Available, Schedule = v.Availability, v.CountryCode,
                Organisation = db.Set<Organisation>().Where(o => o.Id == v.OrganisationId).Select(o => o.Name).FirstOrDefault(),
                v.ServiceRegionId, v.ServiceLatitude, v.ServiceLongitude, v.ServiceLocationConsent, v.TaskRequestId,
                CaseReference = db.Set<AssistanceRequest>().Where(r => r.Id == v.TaskRequestId).Select(r => r.Reference).FirstOrDefault(),
                DispatchReference = db.Set<CaseDispatch>().Where(d => d.Id == v.TaskDispatchId && d.RequestId == v.TaskRequestId)
                    .Select(d => d.Reference).FirstOrDefault() })
            .SingleOrDefaultAsync(ct);
        return new { Assignments = assignments, Volunteer = volunteer, user.EmailConfirmed,
            WorkPhone = user.IsSystemAdministrator || assignments.Count > 0 ? user.PhoneNumber : null };
    }

    [Authorize, HttpPatch("profile/contact")]
    public async Task<object> UpdateContact(ProfileContactInput input, CancellationToken ct)
    {
        var user = await users.FindByIdAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!) ?? throw new AccessDeniedException();
        if (!await db.Set<Membership>().AnyAsync(m => m.UserId == user.Id && m.Role == Roles.Logistics, ct))
            throw new AccessDeniedException();
        if (input.Name != null)
        {
            var name = input.Name.Trim();
            if (name.Length == 0) throw new RuleException("Enter your full name.");
            user.DisplayName = name;
        }
        if (input.Language != null)
        {
            if (input.Language is not ("en" or "si" or "ta" or "ne" or "hi")) throw new RuleException("Unsupported language.");
            user.Language = input.Language;
        }
        if (input.WorkPhone != null)
        {
            var number = string.IsNullOrWhiteSpace(input.WorkPhone) ? null : input.WorkPhone.Trim();
            if (user.PhoneNumber != number)
            {
                user.PhoneNumber = number;
                user.PhoneNumberConfirmed = false;
            }
        }
        db.Add(new AuditEvent { ActorId = user.Id, Action = "ProfileUpdated", EntityType = "User" });
        await db.SaveChangesAsync(ct);
        return await auth.UserInfo(user, ct);
    }

    [Authorize, HttpPut("profile")]
    public async Task<object> Profile(ProfileInput input, CancellationToken ct)
    {
        if (input.Language is not ("en" or "si" or "ta" or "ne" or "hi"))
            throw new RuleException("Unsupported language.");
        var user = await users.FindByIdAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!) ?? throw new AccessDeniedException();
        user.DisplayName = input.Name;
        user.Language = input.Language;

        var memberships = await db.Set<Membership>().Where(m => m.UserId == user.Id).ToListAsync(ct);
        if (input.HouseholdSize.HasValue || input.AccessibilityNeeds is not null)
        {
            if (!memberships.Any(m => m.Role == Roles.Citizen) && !await users.IsInRoleAsync(user, Roles.Citizen))
                throw new AccessDeniedException();
            var home = await db.Set<Household>().SingleOrDefaultAsync(x => x.UserId == user.Id, ct);
            if (home is null)
            {
                home = new Household { UserId = user.Id };
                db.Add(home);
            }
            home.Size = input.HouseholdSize ?? home.Size;
            home.AccessibilityNeeds = input.AccessibilityNeeds ?? home.AccessibilityNeeds;
        }
        if (input.WorkPhone is { } workPhone)
        {
            if (!user.IsSystemAdministrator && !memberships.Any(m => m.Role != Roles.Citizen))
                throw new AccessDeniedException();
            var number = string.IsNullOrWhiteSpace(workPhone) ? null : workPhone.Trim();
            if (user.PhoneNumber != number)
            {
                user.PhoneNumber = number;
                user.PhoneNumberConfirmed = false;
            }
        }
        if (input.VolunteerAvailability != null || input.VolunteerSkills != null)
        {
            var volunteer = await OwnVolunteerProfile(user.Id).SingleOrDefaultAsync(ct) ?? throw new AccessDeniedException();
            if (input.VolunteerSkills != null)
                volunteer.Skills = input.VolunteerSkills.Trim();
            if (input.VolunteerAvailability is { } availability)
            {
                volunteer.Availability = availability.Schedule;
                volunteer.Available = availability.Available;
                if (availability.ServiceArea is { } area)
                {
                    if (area.RegionId is Guid region && !await db.Set<AdministrativeDivision>().AnyAsync(r =>
                        r.Id == region && r.CountryCode == volunteer.CountryCode, ct))
                        throw new RuleException("Choose a service region in your volunteer assignment country.");
                    if (area.Consent && (area.Latitude is not (>= -90 and <= 90) || area.Longitude is not (>= -180 and <= 180)))
                        throw new RuleException("Enter valid service point coordinates to share them.");
                    volunteer.ServiceRegionId = area.RegionId;
                    volunteer.ServiceLocationConsent = area.Consent;
                    volunteer.ServiceLatitude = area.Consent ? area.Latitude : null;
                    volunteer.ServiceLongitude = area.Consent ? area.Longitude : null;
                }
            }
            db.Add(new AuditEvent { ActorId = user.Id, Action = "VolunteerSaved", EntityType = nameof(VolunteerProfile), EntityId = volunteer.Id, CountryCode = volunteer.CountryCode });
        }
        if (input.CaseManagerAvailability is { } caseAvailability)
        {
            var grants = memberships.Where(m => m.Role == Roles.CaseManager).ToDictionary(m => m.Id);
            foreach (var (id, available) in caseAvailability)
            {
                if (!grants.TryGetValue(id, out var grant))
                    throw new AccessDeniedException();
                if (grant.AvailableForAssignment == available)
                    continue;
                grant.AvailableForAssignment = available;
                db.Add(new AuditEvent { ActorId = user.Id, Action = "CaseManagerAvailabilityChanged", EntityType = nameof(Membership), EntityId = id, CountryCode = grant.CountryCode, Detail = available ? "Available" : "Unavailable" });
            }
        }
        db.Add(new AuditEvent { ActorId = user.Id, Action = "ProfileUpdated", EntityType = "User" });
        await db.SaveChangesAsync(ct);
        return await auth.UserInfo(user, ct);
    }

    private IQueryable<VolunteerProfile> OwnVolunteerProfile(string userId) => db.Set<VolunteerProfile>()
        .Where(v => v.UserId == userId && db.Set<Membership>().Any(m =>
            m.UserId == userId && m.Role == Roles.Volunteer
            && m.OrganisationId == v.OrganisationId && m.CountryCode == v.CountryCode
            && (m.CrisisId == null || (v.TaskRequestId != null && db.Set<AssistanceRequest>().Any(r =>
                r.Id == v.TaskRequestId && r.CrisisId == m.CrisisId && r.OrganisationId == v.OrganisationId)))));
}
