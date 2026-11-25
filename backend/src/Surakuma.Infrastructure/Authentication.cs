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
            Roles = await EffectiveRoles(user, ct),
            Memberships = memberships,
            HouseholdSize = household?.Size ?? 1,
            AccessibilityNeeds = household?.AccessibilityNeeds ?? ""
        };
    }
    public Task<AuthSession> Register(RegisterInput input, CancellationToken ct) => RegisterAccount(input, null, ct);

    public Task<AuthSession> RegisterDonor(RegisterDonorInput input, CancellationToken ct) => RegisterAccount(
        new RegisterInput(input.Email, input.Password, input.Name.Trim(), input.Language),
        new DonorProfile { DisplayName = input.Name.Trim(), OrganisationName = string.IsNullOrWhiteSpace(input.OrganisationName) ? null : input.OrganisationName.Trim() }, ct);

    private async Task<AuthSession> RegisterAccount(RegisterInput input, DonorProfile? donor, CancellationToken ct)
    {
        if (input.Language is not ("en" or "si" or "ta" or "ne" or "hi"))
            throw new RuleException("Unsupported language.");
        var user = new AppUser { UserName = input.Email, Email = input.Email, DisplayName = input.Name, Language = input.Language };
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var result = await users.CreateAsync(user, input.Password);
        if (!result.Succeeded)
            throw new RuleException(string.Join(" ", result.Errors.Select(x => x.Description)));
        var roleResult = await users.AddToRoleAsync(user, donor is null ? Roles.Citizen : Roles.Donor);
        if (!roleResult.Succeeded)
            throw new RuleException(string.Join(" ", roleResult.Errors.Select(x => x.Description)));
        if (donor is null)
        {
            db.Add(new Household { UserId = user.Id });
            db.Add(new AuditEvent { ActorId = user.Id, Action = "CitizenRegistered", EntityType = "User", Detail = "Citizen account created." });
        }
        else
        {
            donor.UserId = user.Id;
            db.Add(donor);
            db.Add(new AuditEvent { ActorId = user.Id, Action = "DonorRegistered", EntityType = nameof(DonorProfile), EntityId = donor.Id });
        }
        var session = await CreateSession(user, ct);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return session;
    }
    public async Task<AuthSession?> Login(LoginInput input, CancellationToken ct, bool donorOnly = false)
    {
        var user = await users.FindByEmailAsync(input.Email);
        if (user is null || user.Disabled || await users.IsLockedOutAsync(user))
            return null;
        if (!await users.CheckPasswordAsync(user, input.Password))
        {
            await users.AccessFailedAsync(user);
            return null;
        }
        await users.ResetAccessFailedCountAsync(user);
        if (donorOnly && !await users.IsInRoleAsync(user, Roles.Donor))
            return null;
        var session = await CreateSession(user, ct);
        db.Add(new AuditEvent { ActorId = user.Id, Action = "Login", EntityType = "User" });
        await db.SaveChangesAsync(ct);
        return session;
    }
    public async Task<AuthSession?> Refresh(string token, CancellationToken ct)
    {
        string hash = Hash(token);
        for (int attempt = 0; ; attempt++)
        {
            try
            {
                return await RotateSession(hash, ct);
            }
            catch (Exception ex) when (attempt < 2 && EfStore.IsDeadlock(ex))
            {
                db.ChangeTracker.Clear();
                await Task.Delay(TimeSpan.FromMilliseconds(50 * (attempt + 1) + Random.Shared.Next(50)), ct);
            }
        }
    }
    private async Task<AuthSession?> RotateSession(string hash, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        // Lock for update when reading, so concurrent rotations cannot both read the same active token.
        var session = await db.Set<RefreshSession>()
            .FromSql($"SELECT * FROM [RefreshSession] WITH (UPDLOCK) WHERE [TokenHash] = {hash}")
            .SingleOrDefaultAsync(ct);
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
        if (user is null || user.Disabled)
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
        var roles = await EffectiveRoles(user, ct);
        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, user.Id), new(ClaimTypes.Name, user.DisplayName), new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()), new("security_stamp", await users.GetSecurityStampAsync(user) ?? "") };
        claims.AddRange(roles.Select(r => new Claim(ClaimTypes.Role, r)));
        var credentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(config["Jwt:Key"]!)), SecurityAlgorithms.HmacSha256);
        var jwt = new JwtSecurityToken(config["Jwt:Issuer"], config["Jwt:Audience"], claims, expires: DateTime.UtcNow.AddMinutes(15), signingCredentials: credentials);
        string refresh = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
        db.Add(new RefreshSession { UserId = user.Id, TokenHash = Hash(refresh), ExpiresAt = DateTimeOffset.UtcNow.AddDays(7) });
        return new(new JwtSecurityTokenHandler().WriteToken(jwt), await UserInfo(user, ct), refresh);
    }
    private async Task<string[]> EffectiveRoles(AppUser user, CancellationToken ct)
    {
        var identityRoles = await users.GetRolesAsync(user);
        var active = await db.Set<Membership>().Where(m => m.UserId == user.Id).Select(m => m.Role).Distinct().ToListAsync(ct);
        if (identityRoles.Contains(Roles.Citizen)) active.Add(Roles.Citizen);
        if (identityRoles.Contains(Roles.Donor)) active.Add(Roles.Donor);
        if (user.IsSystemAdministrator) active.Add(Roles.Administrator);
        return active.Distinct().ToArray();
    }
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
