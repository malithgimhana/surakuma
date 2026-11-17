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
    private const string CookieName = "surakuma.refresh";
    private void SetCookie(string token) => Response.Cookies.Append(CookieName, token, new CookieOptions { HttpOnly = true, Secure = true, SameSite = SameSiteMode.Lax, Path = "/api/v1/auth", MaxAge = TimeSpan.FromDays(7) });
    private bool ValidOrigin() => !Request.Headers.ContainsKey("Origin") || (config.GetSection("Cors:Origins").Get<string[]>() ?? []).Contains(Request.Headers.Origin.ToString());
    [HttpPost("register")]
    public async Task<IActionResult> Register(RegisterInput input, CancellationToken ct)
    {
        if (!ValidOrigin())
            return Forbid();
        var r = await auth.Register(input, ct);
        SetCookie(r.RefreshToken);
        return Ok(new
        {
            r.AccessToken,
            r.User
        });
    }
    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginInput input, CancellationToken ct)
    {
        if (!ValidOrigin())
            return Forbid();
        var r = await auth.Login(input, ct);
        if (r is null)
            return Unauthorized(new ProblemDetails { Title = "Email or password is incorrect, or the account is temporarily locked.", Status = 401 });
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
            .Select(v => new { v.Skills, v.Verified, v.Available, Schedule = v.Availability })
            .SingleOrDefaultAsync(ct);
        return new { Assignments = assignments, Volunteer = volunteer, WorkPhone = user.IsSystemAdministrator || assignments.Count > 0 ? user.PhoneNumber : null };
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
        if (input.VolunteerAvailability is { } availability)
        {
            var volunteer = await OwnVolunteerProfile(user.Id).SingleOrDefaultAsync(ct) ?? throw new AccessDeniedException();
            volunteer.Availability = availability.Schedule;
            volunteer.Available = availability.Available;
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
            m.UserId == userId && m.Role == Roles.Volunteer && m.CrisisId == null
            && m.OrganisationId == v.OrganisationId && m.CountryCode == v.CountryCode));
}
