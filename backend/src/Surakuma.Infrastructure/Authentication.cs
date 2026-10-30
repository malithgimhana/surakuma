using System.Data;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using Surakuma.Application;
using Surakuma.Domain;

namespace Surakuma.Infrastructure;

public sealed record AuthSession(string AccessToken, object User, string RefreshToken);
public sealed class AuthenticationService(UserManager<AppUser> users, CrisisDbContext db, IConfiguration config)
{
    public async Task<object> UserInfo(AppUser user, CancellationToken ct)
    {
        var memberships = await db.Set<Membership>().Where(x => x.UserId == user.Id).ToListAsync(ct);
        var household = await db.Set<Household>().SingleOrDefaultAsync(x => x.UserId == user.Id, ct);
        return new
        {
            user.Id,
            user.Email,
            Name = user.DisplayName,
            user.Language,
            Roles = await users.GetRolesAsync(user),
            Memberships = memberships,
            HouseholdSize = household?.Size ?? 1,
            AccessibilityNeeds = household?.AccessibilityNeeds ?? ""
        };
    }
    public async Task<AuthSession> Register(RegisterInput input, CancellationToken ct)
    {
        if (input.Language is not ("en" or "si" or "ta"))
            throw new RuleException("Unsupported language.");
        var user = new AppUser { UserName = input.Email, Email = input.Email, DisplayName = input.Name, Language = input.Language };
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var result = await users.CreateAsync(user, input.Password);
        if (!result.Succeeded)
            throw new RuleException(string.Join(" ", result.Errors.Select(x => x.Description)));
        await users.AddToRoleAsync(user, Roles.Citizen);
        db.Add(new Household { UserId = user.Id });
        db.Add(new AuditEvent { ActorId = user.Id, Action = "CitizenRegistered", EntityType = "User", Detail = "Citizen account created." });
        var session = await CreateSession(user, ct);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return session;
    }
    public async Task<AuthSession?> Login(LoginInput input, CancellationToken ct)
    {
        var user = await users.FindByEmailAsync(input.Email);
        if (user is null || await users.IsLockedOutAsync(user))
            return null;
        if (!await users.CheckPasswordAsync(user, input.Password))
        {
            await users.AccessFailedAsync(user);
            return null;
        }
        await users.ResetAccessFailedCountAsync(user);
        var session = await CreateSession(user, ct);
        db.Add(new AuditEvent { ActorId = user.Id, Action = "Login", EntityType = "User" });
        await db.SaveChangesAsync(ct);
        return session;
    }
    public async Task<AuthSession?> Refresh(string token, CancellationToken ct)
    {
        string hash = Hash(token);
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var session = await db.Set<RefreshSession>().SingleOrDefaultAsync(x => x.TokenHash == hash, ct);
        if (session is null || session.ExpiresAt < DateTimeOffset.UtcNow)
            return null;
        if (session.Revoked)
        {
            foreach (var active in await db.Set<RefreshSession>().Where(x => x.UserId == session.UserId && !x.Revoked).ToListAsync(ct))
                active.Revoked = true;
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return null;
        }
        var user = await users.FindByIdAsync(session.UserId);
        if (user is null)
            return null;
        session.Revoked = true;
        var next = await CreateSession(user, ct);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return next;
    }
    public async Task Logout(string token, CancellationToken ct)
    {
        string hash = Hash(token);
        var session = await db.Set<RefreshSession>().SingleOrDefaultAsync(x => x.TokenHash == hash, ct);
        if (session is not null)
        {
            session.Revoked = true;
            await db.SaveChangesAsync(ct);
        }
    }
    private async Task<AuthSession> CreateSession(AppUser user, CancellationToken ct)
    {
        var roles = await users.GetRolesAsync(user);
        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, user.Id), new(ClaimTypes.Name, user.DisplayName), new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()) };
        claims.AddRange(roles.Select(r => new Claim(ClaimTypes.Role, r)));
        var credentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(config["Jwt:Key"]!)), SecurityAlgorithms.HmacSha256);
        var jwt = new JwtSecurityToken(config["Jwt:Issuer"], config["Jwt:Audience"], claims, expires: DateTime.UtcNow.AddMinutes(15), signingCredentials: credentials);
        string refresh = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
        db.Add(new RefreshSession { UserId = user.Id, TokenHash = Hash(refresh), ExpiresAt = DateTimeOffset.UtcNow.AddDays(7) });
        return new(new JwtSecurityTokenHandler().WriteToken(jwt), await UserInfo(user, ct), refresh);
    }
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
