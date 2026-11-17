using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Surakuma.Domain;
namespace Surakuma.Infrastructure;

public sealed class ProviderObservationHandler(IServiceScopeFactory scopes) : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        bool success = false;
        try { var response = await base.SendAsync(request, ct); success = response.IsSuccessStatusCode; return response; }
        finally
        {
            using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            db.Add(new ServiceObservation { Service = request.RequestUri?.Host ?? "Provider", Success = success });
            try { await db.SaveChangesAsync(CancellationToken.None); } catch (Exception ex) { scope.ServiceProvider.GetRequiredService<ILogger<ProviderObservationHandler>>().LogWarning("Could not record provider outcome ({Type})", ex.GetType().Name); }
        }
    }
}
public sealed class AdministrationWorker(IServiceScopeFactory scopes, ILogger<AdministrationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await Evaluate(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogWarning("Administrator alert evaluation deferred ({Type})", ex.GetType().Name); }
            try { await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken); } catch (OperationCanceledException) { break; }
        }
    }
    public async Task Evaluate(CancellationToken ct)
    {
        using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var now = DateTimeOffset.UtcNow; var wanted = new Dictionary<string, AdminAlert>();
        void Add(string key, string? country, string message, string link) => wanted[key] = new AdminAlert { ConditionKey = key, CountryCode = country, Message = message, Link = link };
        var cases = await (from r in db.Set<AssistanceRequest>() join c in db.Set<Crisis>() on r.CrisisId equals c.Id where r.Status != RequestStatus.Fulfilled && r.Status != RequestStatus.Closed && r.Status != RequestStatus.Rejected && r.Status != RequestStatus.Cancelled select new { Request = r, c.CountryCode }).ToListAsync(ct);
        var managers = await db.Set<Membership>().Where(m => m.Role == Roles.CaseManager).ToListAsync(ct);
        foreach (var item in cases)
        {
            var r = item.Request;
            if ((r.OrganisationId == null || r.AssignedCaseManagerId == null) && r.CreatedAt <= now.AddHours(-1)) Add("unassigned:" + r.Id, item.CountryCode, r.Reference + " has been unassigned for over one hour.", "/admin?section=cases");
            if (r.AssignedCaseManagerId != null && !managers.Any(m => m.UserId == r.AssignedCaseManagerId && m.CountryCode == item.CountryCode && m.OrganisationId == r.OrganisationId && (m.CrisisId == null || m.CrisisId == r.CrisisId))) Add("manager:" + r.Id, item.CountryCode, r.Reference + " needs an active case manager.", "/staff/cases/" + r.Id);
        }
        var deliveries = from m in db.Set<OutboxMessage>()
                         join r in db.Set<AssistanceRequest>() on m.RequestId equals r.Id
                         join c in db.Set<Crisis>() on r.CrisisId equals c.Id
                         where m.State == "Failed" || m.State == "Review"
                         select new { m.Id, m.State, c.CountryCode };
        foreach (var m in await deliveries.ToListAsync(ct))
            Add("delivery:" + m.Id, m.CountryCode, "Citizen email needs attention: " + m.State, "/admin?section=activity");
        var observations = await db.Set<ServiceObservation>().Where(o => o.CreatedAt >= now.AddMinutes(-10)).ToListAsync(ct);
        foreach (var group in observations.GroupBy(o => new { o.Service, o.ActorId }))
        {
            var threshold = group.Key.Service == "AdministrativeAccess" ? 5 : 3;
            var key = "service:" + group.Key.Service + ":" + group.Key.ActorId;
            if (group.Count(o => !o.Success) >= threshold && !group.OrderByDescending(o => o.CreatedAt).First().Success) Add(key, null, group.Key.Service == "AdministrativeAccess" ? "Repeated denied administrator actions require review for account " + group.Key.ActorId : "Repeated provider failures: " + group.Key.Service, group.Key.Service == "AdministrativeAccess" ? "/admin?section=activity" : "/admin?section=integrations");
        }
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
        var active = await db.Set<AdminAlert>().Where(a => a.ResolvedAt == null).ToListAsync(ct);
        foreach (var alert in active)
        {
            if (wanted.Remove(alert.ConditionKey, out var current))
            {
                alert.CountryCode = current.CountryCode;
                continue;
            }
            if (alert.ConditionKey.StartsWith("service:") && !alert.ConditionKey.StartsWith("service:AdministrativeAccess:") && !observations.Any(o => o.Success && "service:" + o.Service + ":" + o.ActorId == alert.ConditionKey && o.CreatedAt > alert.CreatedAt)) continue;
            alert.ResolvedAt = now;
        }
        db.AddRange(wanted.Values);
        foreach (var p in await db.Set<AdminProposal>().Where(p => p.State == "Pending" && (p.ExpiresAt <= now || p.Kind == "CountryServices")).ToListAsync(ct))
        {
            if (p.Kind == "CountryServices")
            {
                p.State = "Stale";
                p.DecisionReason = "Country settings are now published directly. Review and save any outstanding changes in Country settings.";
            }
            else p.State = "Expired";
        }
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
    }
}
