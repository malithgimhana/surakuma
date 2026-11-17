using System.Data;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Api.Controllers;

[ApiController, Authorize, Route("api/v1/admin")]
public sealed class AdministrationController(CrisisDbContext db, AccessService access, UserManager<AppUser> users, Operations ops) : ControllerBase
{
    public sealed record Change(bool Active, string Reason);
    public sealed record DeleteAccountInput(string Confirmation, string Reason);
    public sealed record VerificationInput(string Evidence, string? Decision, string Reason);
    public sealed record DecisionInput(string Action, string Reason);
    public sealed record GrantPayload(string UserId);
    private async Task ProtectLastAdmin(string userId, CancellationToken ct)
    {
        if (await db.ActiveSystemAdministrators.AnyAsync(u => u.Id == userId, ct)
            && !await db.ActiveSystemAdministrators.AnyAsync(u => u.Id != userId, ct))
            throw new RuleException("Keep at least one active global administrator.");
    }
    static void Reason(string value) { if (string.IsNullOrWhiteSpace(value) || value.Length > 2000) throw new RuleException("Provide a reason under 2,000 characters."); }
    async Task Global(CancellationToken ct) { if (!await access.IsAdmin(ct)) throw new AccessDeniedException(); }
    async Task Invalidate(AppUser user, CancellationToken ct)
    {
        if (!(await users.UpdateSecurityStampAsync(user)).Succeeded) throw new RuleException("Could not invalidate sessions.");
        foreach (var session in await db.Set<RefreshSession>().Where(s => s.UserId == user.Id && !s.Revoked).ToListAsync(ct)) session.Revoked = true;
    }
    [HttpPost("users/{id}/staff-status")]
    public async Task<IActionResult> StaffStatus(string id, Change input, CancellationToken ct, string? countryCode = null)
    {
        Reason(input.Reason);
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        bool global = await access.IsAdmin(ct);
        if (!global && (countryCode == null || !await access.CountryAccess(countryCode, [], ct))) throw new AccessDeniedException();
        if (id == access.UserId) throw new RuleException("Ask another administrator to change your access.");
        var user = await users.FindByIdAsync(id) ?? throw new MissingException();
        if (!global && user.IsSystemAdministrator) throw new AccessDeniedException();
        var grants = await db.Set<Membership>().IgnoreQueryFilters().Where(m => m.UserId == id && m.Role != Roles.Citizen
            && m.Role != Roles.Administrator && (global || m.Role != Roles.CountryAdministrator)
            && (countryCode == null || m.CountryCode == countryCode)
            && (m.OrganisationId == null || db.Set<OrganisationCountry>().Any(link =>
                link.OrganisationId == m.OrganisationId && link.CountryCode == m.CountryCode
                && (!input.Active || link.VerificationState == "Verified" || link.VerificationState == "LegacyActive")))).ToListAsync(ct);
        if (grants.Count == 0) throw new MissingException();
        foreach (var grant in grants) { grant.Suspended = !input.Active; grant.SuspensionReason = input.Reason; ops.Audit(input.Active ? "StaffReactivated" : "StaffSuspended", grant, input.Reason); }
        await Invalidate(user, ct); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return NoContent();
    }
    [HttpPost("users/{id}/account-status")]
    public async Task<IActionResult> AccountStatus(string id, Change input, CancellationToken ct)
    {
        await Global(ct); Reason(input.Reason);
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        if (id == access.UserId) throw new RuleException("You cannot disable your own account.");
        var user = await users.FindByIdAsync(id) ?? throw new MissingException();
        if (!input.Active) await ProtectLastAdmin(id, ct);
        user.Disabled = !input.Active;
        await Invalidate(user, ct);
        db.Add(new AuditEvent { ActorId = access.UserId, Action = input.Active ? "AccountReactivated" : "AccountDisabled", EntityType = "User", Detail = $"{id}: {input.Reason}" });
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return NoContent();
    }
    [HttpDelete("users/{id}/system-administrator")]
    public async Task<IActionResult> RevokeSystemAdministrator(string id, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await Global(ct);
        if (id == access.UserId) throw new RuleException("Ask another system administrator to change your access.");
        var user = await users.FindByIdAsync(id) ?? throw new MissingException();
        if (!user.IsSystemAdministrator) return NoContent();
        await ProtectLastAdmin(id, ct);
        user.IsSystemAdministrator = false;
        await Invalidate(user, ct);
        db.Add(new AuditEvent { ActorId = access.UserId, Action = "SystemAdministratorRevoked", EntityType = "User", Detail = id });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return NoContent();
    }
    [HttpDelete("users/{id}")]
    public async Task<IActionResult> DeleteAccount(string id, [FromBody] DeleteAccountInput input, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await Global(ct);
        Reason(input.Reason);
        if (input.Confirmation != "DELETE") throw new RuleException("Type DELETE to confirm permanent account deletion.");
        if (id == access.UserId) throw new RuleException("You cannot delete your own account.");

        var user = await users.FindByIdAsync(id) ?? throw new MissingException();
        await ProtectLastAdmin(id, ct);
        if (await db.Set<AssistanceRequest>().AnyAsync(r => r.CitizenId == id, ct)
            || await db.Set<Feedback>().AnyAsync(f => f.UserId == id, ct))
            throw new RuleException("This account is linked to assistance requests or feedback. Disable the account to block sign-in while keeping those records.");
        if (await db.Set<AssistanceRequest>().AnyAsync(r => r.AssignedCaseManagerId == id, ct))
            throw new RuleException("Reassign cases linked to this staff account before deleting it.");

        var volunteerProfiles = db.Set<VolunteerProfile>().Where(p => p.UserId == id);
        if (await db.Set<VolunteerTask>().AnyAsync(t => volunteerProfiles.Any(p => p.Id == t.VolunteerId), ct))
            throw new RuleException("This account has volunteer task history. Disable the account to block sign-in while keeping that history.");

        await db.Set<Membership>().IgnoreQueryFilters().Where(m => m.UserId == id).ExecuteDeleteAsync(ct);
        await db.Set<CrisisAssignment>().Where(a => a.UserId == id).ExecuteDeleteAsync(ct);
        await db.Set<RefreshSession>().Where(s => s.UserId == id).ExecuteDeleteAsync(ct);
        await db.Set<SecurityEmail>().Where(e => e.UserId == id).ExecuteDeleteAsync(ct);
        await db.Set<Notification>().Where(n => n.UserId == id).ExecuteDeleteAsync(ct);
        await db.Set<Household>().Where(h => h.UserId == id).ExecuteDeleteAsync(ct);
        await volunteerProfiles.ExecuteDeleteAsync(ct);

        if (!(await users.DeleteAsync(user)).Succeeded)
            throw new RuleException("The account could not be deleted. Refresh the user list and try again.");

        db.Add(new AuditEvent
        {
            ActorId = access.UserId,
            Action = "AccountDeleted",
            EntityType = "User",
            Detail = $"{id}: {input.Reason.Trim()}"
        });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return NoContent();
    }

    [HttpPost("organisations/{id:guid}/countries/{country}/verification")]
    public async Task<IActionResult> Verify(Guid id, string country, VerificationInput input, CancellationToken ct)
    {
        if (!await access.CountryAccess(country, [], ct)) throw new AccessDeniedException();
        if (input.Evidence.Length > 4000) throw new RuleException("Evidence is too long.");
        foreach (System.Text.RegularExpressions.Match link in System.Text.RegularExpressions.Regex.Matches(input.Evidence, @"https?://[^\s]+"))
            if (!Uri.TryCreate(link.Value, UriKind.Absolute, out var uri) || uri.Scheme != "https") throw new RuleException("Use HTTPS evidence references.");
        var item = await db.Set<OrganisationCountry>().SingleOrDefaultAsync(x => x.OrganisationId == id && x.CountryCode == country, ct) ?? throw new MissingException();
        if (input.Decision is not null)
        {
            await Global(ct); Reason(input.Reason);
            if (input.Decision is not ("Verified" or "Rejected")) throw new RuleException("Choose Verified or Rejected.");
            if (string.IsNullOrWhiteSpace(input.Evidence)) throw new RuleException("Record the evidence reviewed.");
            item.VerificationState = input.Decision; item.ReviewerUserId = access.UserId; item.ReviewedAt = DateTimeOffset.UtcNow; item.DecisionReason = input.Reason;
        }
        item.Evidence = input.Evidence; ops.Audit("OrganisationVerificationUpdated", item, input.Decision ?? "Evidence submitted");
        await db.SaveChangesAsync(ct); return NoContent();
    }
    [HttpGet("approvals")]
    public async Task<object> Approvals(CancellationToken ct, string? countryCode = null)
    {
        await Global(ct);
        var items = await db.Set<AdminProposal>().Where(p => p.Kind == "GlobalAccess" && (countryCode == null || p.CountryCode == countryCode))
            .OrderByDescending(p => p.CreatedAt).Take(100).ToListAsync(ct);
        foreach (var p in items.Where(p => p.State == "Pending" && p.ExpiresAt <= DateTimeOffset.UtcNow)) p.State = "Expired";
        await db.SaveChangesAsync(ct);
        var views = new List<object>();
        foreach (var p in items) {
            var requester = await db.Users.Where(u => u.Id == p.RequesterUserId).Select(u => u.DisplayName).FirstOrDefaultAsync(ct);
            var reviewer = await db.Users.Where(u => u.Id == p.ReviewerUserId).Select(u => u.DisplayName).FirstOrDefaultAsync(ct);
            var grant = JsonSerializer.Deserialize<GrantPayload>(p.Payload)!;
            var targetName = await db.Users.Where(u => u.Id == grant.UserId).Select(u => u.DisplayName).FirstOrDefaultAsync(ct);
            views.Add(new { p.Id, p.Kind, p.CountryCode, p.State, p.RequesterUserId, p.ReviewerUserId, RequesterName = requester, ReviewerName = reviewer, p.Reason, p.DecisionReason, p.Payload, p.CreatedAt, p.ExpiresAt, TargetName = targetName });
        }
        return new { items = views, activeGlobalAdministrators = await db.ActiveSystemAdministrators.CountAsync(ct) };
    }
    [HttpPost("approvals/{id:guid}/decision")]
    public async Task<IActionResult> Decide(Guid id, DecisionInput input, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await Global(ct);
        Reason(input.Reason);
        var p = await db.Set<AdminProposal>().SingleOrDefaultAsync(x => x.Id == id && x.Kind == "GlobalAccess", ct) ?? throw new MissingException();
        async Task<IActionResult> Stale(string reason) {
            p.State = "Stale"; p.ReviewerUserId = access.UserId; p.DecisionReason = reason;
            ops.Audit("AdministrationProposalStale", p, reason); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
            return Conflict(new ProblemDetails { Title = "Submit a new proposal", Detail = reason, Status = 409 });
        }
        if (input.Action == "Cancel") { if (p.RequesterUserId != access.UserId) throw new AccessDeniedException(); }
        else if (p.RequesterUserId == access.UserId) throw new RuleException("A different global administrator must decide this proposal.");
        if (p.State != "Pending" || p.ExpiresAt <= DateTimeOffset.UtcNow) throw new RuleException("This proposal is no longer pending.");
        if (input.Action is not ("Approve" or "Reject" or "Cancel")) throw new RuleException("Choose Approve, Reject or Cancel.");
        if (input.Action == "Approve")
        {
            if (!await db.ActiveSystemAdministrators.AnyAsync(u => u.Id == p.RequesterUserId, ct)) return await Stale("The requester no longer has permission.");
            var grant = JsonSerializer.Deserialize<GrantPayload>(p.Payload)!;
            var user = await users.FindByIdAsync(grant.UserId) ?? throw new MissingException();
            if (user.Disabled || user.SecurityStamp != p.OriginalVersion) return await Stale("The target account changed after this proposal was submitted.");
            if (user.IsSystemAdministrator) return await Stale("The target is already a system administrator.");
            user.IsSystemAdministrator = true;
            await Invalidate(user, ct);
        }
        p.State = input.Action == "Approve" ? "Approved" : input.Action == "Reject" ? "Rejected" : "Cancelled"; p.ReviewerUserId = access.UserId; p.DecisionReason = input.Reason;
        ops.Audit("AdministrationProposal" + p.State, p, input.Reason); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return NoContent();
    }
    [HttpGet("alerts")]
    public async Task<object> Alerts(CancellationToken ct, string? countryCode = null)
    {
        var global = await access.IsAdmin(ct); var countries = (await access.Memberships(ct)).Where(m => m.Role == Roles.CountryAdministrator).Select(m => m.CountryCode).ToArray();
        if (!global && countries.Length == 0) throw new AccessDeniedException();
        if (countryCode != null && !global && !await access.CountryAccess(countryCode, [], ct)) throw new AccessDeniedException();
        return await db.Set<AdminAlert>().Where(a => (countryCode == null || a.CountryCode == countryCode)
            && (global || (a.CountryCode != null && countries.Contains(a.CountryCode) && !a.ConditionKey.StartsWith("delivery:"))))
            .OrderBy(a => a.ResolvedAt != null).ThenByDescending(a => a.CreatedAt).Take(200).ToListAsync(ct);
    }
    [HttpPost("alerts/{id:guid}/acknowledge")]
    public async Task<IActionResult> Acknowledge(Guid id, CancellationToken ct)
    {
        var item = await db.Set<AdminAlert>().SingleOrDefaultAsync(a => a.Id == id, ct) ?? throw new MissingException();
        if (!await access.IsAdmin(ct) && (item.CountryCode == null || item.ConditionKey.StartsWith("delivery:") || !await access.CountryAccess(item.CountryCode, [], ct))) throw new AccessDeniedException();
        item.AcknowledgedAt = DateTimeOffset.UtcNow; item.AcknowledgedBy = access.UserId; ops.Audit("AlertAcknowledged", item); await db.SaveChangesAsync(ct); return NoContent();
    }
}
