using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;
namespace Surakuma.Api.Controllers;

[ApiController, Route("api/v1"), EnableRateLimiting("auth")]
public sealed class RecoveryController(CrisisDbContext db, UserManager<AppUser> users, IDataProtectionProvider protection, AccessService access) : ControllerBase
{
    public sealed record ForgotInput(string Email);
    public sealed record ResetInput(string Email, string Token, string Password);
    async Task Queue(AppUser user, CancellationToken ct)
    {
        if (user.Disabled || await db.Set<SecurityEmail>().AnyAsync(e => e.UserId == user.Id && e.CreatedAt > DateTimeOffset.UtcNow.AddMinutes(-5), ct)) return;
        var token = await users.GeneratePasswordResetTokenAsync(user);
        db.Add(new SecurityEmail { UserId = user.Id, ProtectedToken = protection.CreateProtector("Surakuma.PasswordRecovery").Protect(token) });
        await db.SaveChangesAsync(ct);
    }
    [AllowAnonymous, HttpPost("auth/forgot-password")]
    public async Task<IActionResult> Forgot(ForgotInput input, CancellationToken ct)
    {
        var user = await users.FindByEmailAsync(input.Email); if (user != null) await Queue(user, ct);
        return Accepted(new { message = "If the account is eligible, password reset instructions will be sent." });
    }
    [AllowAnonymous, HttpPost("auth/reset-password")]
    public async Task<IActionResult> Reset(ResetInput input, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
        var user = await users.FindByEmailAsync(input.Email);
        if (user == null || user.Disabled) throw new RuleException("The reset link is invalid or expired.");
        var result = await users.ResetPasswordAsync(user, input.Token, input.Password);
        if (!result.Succeeded) throw new RuleException("The link is invalid or expired, or the password does not meet the requirements.");
        foreach (var session in await db.Set<RefreshSession>().Where(s => s.UserId == user.Id && !s.Revoked).ToListAsync(ct)) session.Revoked = true;
        db.Add(new AuditEvent { ActorId = user.Id, Action = "PasswordReset", EntityType = "User" });
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return NoContent();
    }
    [Authorize, HttpPost("admin/users/{id}/password-reset")]
    public async Task<IActionResult> AdminReset(string id, CancellationToken ct)
    {
        var global = await access.IsAdmin(ct);
        var countries = (await access.Memberships(ct)).Where(m => m.Role == Roles.CountryAdministrator).Select(m => m.CountryCode).ToArray();
        var user = await users.FindByIdAsync(id) ?? throw new MissingException();
        if (!global && (user.IsSystemAdministrator || !await db.Set<Membership>().AnyAsync(m => m.UserId == id && countries.Contains(m.CountryCode), ct))) throw new AccessDeniedException();
        await Queue(user, ct);
        db.Add(new AuditEvent { ActorId = access.UserId, Action = "PasswordResetRequested", EntityType = "User", Detail = id }); await db.SaveChangesAsync(ct); return Accepted();
    }
}
