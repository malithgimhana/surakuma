using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;
namespace Surakuma.Api.Controllers;
[ApiController, Authorize, Route("api/v1/admin/delivery-management")]
public sealed class DeliveryManagementController(CrisisDbContext db, AccessService access, Operations ops) : ControllerBase
{
    public sealed record RecoveryInput(string Action, string Reason, bool ConfirmedNotDelivered, string? ProviderReference);
    async Task Global(CancellationToken ct) { if (!await access.IsAdmin(ct)) throw new AccessDeniedException(); }
    [HttpGet]
    public async Task<object> List(CancellationToken ct, string? state = null, string? countryCode = null, DateTimeOffset? from = null, DateTimeOffset? to = null, int page = 1, Guid? id = null)
    {
        await Global(ct); page = Math.Max(page, 1);
        var query = db.DeliveriesInCountry(countryCode).Where(m => (id == null || m.Id == id) && (state == null || m.State == state) && (from == null || m.CreatedAt >= from) && (to == null || m.CreatedAt < to));
        return new { total = await query.CountAsync(ct), items = await query.OrderByDescending(m => m.CreatedAt).Skip((page - 1) * 20).Take(20).Select(m => new { m.Id, m.Message, m.State, m.Attempts, m.LastError, m.CreatedAt, m.Version, History = db.Set<DeliveryAttempt>().Where(a => a.EventId == m.Id).OrderBy(a => a.Number).ToList(), ProviderReference = db.Set<NotificationDelivery>().Where(d => d.EventId == m.Id).Select(d => d.ProviderReference).FirstOrDefault() }).ToListAsync(ct) };
    }
    [HttpPost("{id:guid}")]
    public async Task<IActionResult> Recover(Guid id, RecoveryInput input, CancellationToken ct)
    {
        await Global(ct);
        if (string.IsNullOrWhiteSpace(input.Reason) || input.Reason.Length > 2000) throw new RuleException("Record the recovery reason and provider check.");
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
        var m = await db.Set<OutboxMessage>().SingleOrDefaultAsync(m => m.Id == id, ct) ?? throw new MissingException();
        if (m.State is not ("Failed" or "Review")) throw new RuleException("Only failed or uncertain deliveries can be recovered.");
        var delivery = await db.Set<NotificationDelivery>().SingleOrDefaultAsync(d => d.EventId == id && d.RecipientId == m.UserId, ct);
        if (delivery?.State is "Sent" or "Captured") throw new RuleException("The provider already accepted this message.");
        if (input.Action == "Retry")
        {
            if (m.State == "Review" && !input.ConfirmedNotDelivered) throw new RuleException("Confirm non-delivery with the provider before retrying.");
            m.State = "Pending"; m.CycleAttempts = 0; m.NextAttemptAt = DateTimeOffset.UtcNow; m.LastError = null;
        }
        else if (input.Action == "Accepted")
        {
            if (m.State != "Review" || string.IsNullOrWhiteSpace(input.ProviderReference)) throw new RuleException("Record the provider acceptance reference.");
            m.State = "Sent"; if (delivery != null) delivery.ProviderReference = input.ProviderReference;
        }
        else throw new RuleException("Choose Retry or Accepted.");
        if (delivery != null) delivery.State = m.State;
        var countryCode = await (from r in db.Set<AssistanceRequest>() join c in db.Set<Crisis>() on r.CrisisId equals c.Id
                                 where r.Id == m.RequestId select c.CountryCode).SingleAsync(ct);
        ops.Audit("Delivery" + input.Action, m, input.Reason, countryCode); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return NoContent();
    }
}
