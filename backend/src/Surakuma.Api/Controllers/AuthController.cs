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
    [Authorize, HttpPut("profile")]
    public async Task<object> Profile(ProfileInput input, CancellationToken ct)
    {
        if (input.Language is not ("en" or "si" or "ta"))
            throw new RuleException("Unsupported language.");
        var user = await users.FindByIdAsync(User.FindFirstValue(ClaimTypes.NameIdentifier)!) ?? throw new AccessDeniedException();
        user.DisplayName = input.Name;
        user.Language = input.Language;
        var home = await db.Set<Household>().SingleOrDefaultAsync(x => x.UserId == user.Id, ct);
        if (home is null)
        {
            home = new Household { UserId = user.Id };
            db.Add(home);
        }
        home.Size = input.HouseholdSize;
        home.AccessibilityNeeds = input.AccessibilityNeeds;
        db.Add(new AuditEvent { ActorId = user.Id, Action = "ProfileUpdated", EntityType = "User" });
        await db.SaveChangesAsync(ct);
        return await auth.UserInfo(user, ct);
    }
}
