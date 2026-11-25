using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Surakuma.Application;
using Surakuma.Domain;
using System.Data;

namespace Surakuma.Infrastructure;

public sealed class RequestAnalysisWorker(IServiceScopeFactory scopes, ILogger<RequestAnalysisWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var nextPriorityCheck = DateTimeOffset.MinValue;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var now = DateTimeOffset.UtcNow;
                if (now >= nextPriorityCheck)
                {
                    await UpdatePriorityScores(now, stoppingToken);
                    nextPriorityCheck = now.AddMinutes(1);
                }
                if (await ProcessNext(stoppingToken)) continue;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogWarning("Request analysis deferred ({Type}).", ex.GetType().Name); }
            try { await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }

    public async Task UpdatePriorityScores(DateTimeOffset now, CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var requests = scope.ServiceProvider.GetRequiredService<CrisisDbContext>().Set<AssistanceRequest>();
        var due = requests.Where(r => r.NextPriorityEscalationAt <= now && r.IntakeScore != null &&
            !CaseReporting.Ended.Contains(r.Status));
        var pending = await due.AsNoTracking().Select(r => new
        {
            r.Id, r.CreatedAt, r.IntakeScore, r.NextPriorityEscalationAt, r.AssessmentState, r.ImmediateDanger, r.Priority
        }).ToListAsync(ct);
        foreach (var request in pending)
        {
            var score = CitizenTriage.ScoreAfterWaiting(request.IntakeScore!.Value, request.CreatedAt, now);
            var next = score >= 17m ? (DateTimeOffset?)null :
                request.CreatedAt.AddHours(3 * (Math.Floor((now - request.CreatedAt).TotalHours / 3) + 1));
            var priority = request.ImmediateDanger ? Priority.Critical : CitizenTriage.PriorityFor(score);
            if (request.AssessmentState == "Failed")
                priority = (Priority)Math.Max((int)priority, (int)FailedAssessmentPriority(request.Priority));
            await due.Where(r => r.Id == request.Id && r.NextPriorityEscalationAt == request.NextPriorityEscalationAt &&
                r.AssessmentState == request.AssessmentState && r.Priority == request.Priority).ExecuteUpdateAsync(updates => updates
                .SetProperty(r => r.PriorityScore, score).SetProperty(r => r.Priority, priority)
                .SetProperty(r => r.NextPriorityEscalationAt, next), ct);
        }
    }

    public async Task<bool> ProcessNext(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var jobs = db.Set<RequestAnalysisJob>();
        var now = DateTimeOffset.UtcNow;
        var job = await jobs.AsNoTracking().Where(j => (j.State == "Queued" || j.State == "Processing") && j.AvailableAt <= now)
            .OrderBy(j => j.AvailableAt).ThenBy(j => j.Id).FirstOrDefaultAsync(ct);
        if (job is null) return false;
        var lease = Guid.NewGuid();
        var claimed = await jobs.Where(j => j.Id == job.Id && j.State == job.State && j.Lease == job.Lease && j.AvailableAt <= now)
            .ExecuteUpdateAsync(s => s.SetProperty(j => j.State, "Processing").SetProperty(j => j.Lease, lease)
                .SetProperty(j => j.Attempts, j => j.Attempts + 1).SetProperty(j => j.AvailableAt, now.AddMinutes(3)), ct);
        if (claimed == 0) return true;
        var requests = db.Set<AssistanceRequest>();
        try
        {
            var snapshot = await requests.AsNoTracking().SingleAsync(r => r.Id == job.RequestId, ct);
            var intelligence = scope.ServiceProvider.GetRequiredService<RequestIntelligence>();
            var analysis = job.Attempts >= 3 || CaseReporting.Ended.Contains(snapshot.Status) ? null :
                await intelligence.Analyze(snapshot, ct);
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
            var current = await jobs.SingleOrDefaultAsync(j => j.Id == job.Id && j.Lease == lease && j.State == "Processing", ct);
            if (current is null) return true;
            var request = await requests.SingleAsync(r => r.Id == job.RequestId, ct);
            if (CaseReporting.Ended.Contains(request.Status))
            {
                current.State = "Skipped";
                if (request.IntakeJson is not null) request.AssessmentState = "Skipped";
            }
            else if (request.IntakeJson is not null)
            {
                bool completed = analysis is { Result.Fallback: false };
                request.AssessmentState = completed ? "Completed" : "Failed";
                current.State = request.AssessmentState;
                if (!completed)
                {
                    request.Priority = request.ImmediateDanger ? Priority.Critical : FailedAssessmentPriority(request.Priority);
                    current.FailureReason = "AI assessment unavailable.";
                }
                if (analysis is not null)
                    await intelligence.Save(request, analysis, requests, "system:request-intelligence", ct);
            }
            else if (analysis is null)
            {
                current.State = "Failed";
                current.FailureReason = "Processing attempts exhausted. Staff can generate a replacement.";
            }
            else
            {
                await intelligence.Save(request, analysis, requests, "system:request-intelligence", ct);
                current.State = analysis.Result.Fallback ? "Fallback" : "Completed";
                current.FailureReason = analysis.Result.Fallback ? analysis.Result.Explanation : null;
            }
            current.CompletedAt = DateTimeOffset.UtcNow;
            current.Lease = null;
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The analysis transaction rolled back. Use a fresh context for releasing the lease.
            logger.LogWarning("Request analysis job {JobId} did not finish ({Type}).", job.Id, ex.GetType().Name);
            await using var repairScope = scopes.CreateAsyncScope();
            var repair = repairScope.ServiceProvider.GetRequiredService<CrisisDbContext>();
            var retry = job.Attempts < 2;
            await using var repairTransaction = await repair.Database.BeginTransactionAsync(ct);
            var released = await repair.Set<RequestAnalysisJob>().Where(j => j.Id == job.Id && j.Lease == lease && j.State == "Processing")
                .ExecuteUpdateAsync(s => s.SetProperty(j => j.State, retry ? "Queued" : "Failed")
                    .SetProperty(j => j.Lease, (Guid?)null)
                    .SetProperty(j => j.CompletedAt, retry ? (DateTimeOffset?)null : DateTimeOffset.UtcNow)
                    .SetProperty(j => j.AvailableAt, DateTimeOffset.UtcNow.AddSeconds(5 * (job.Attempts + 1)))
                    .SetProperty(j => j.FailureReason, retry ? "Retry scheduled." : "AI assessment unavailable."), ct);
            if (released == 1 && !retry)
                await repair.Set<AssistanceRequest>().Where(r => r.Id == job.RequestId && r.IntakeJson != null && !CaseReporting.Ended.Contains(r.Status))
                    .ExecuteUpdateAsync(s => s.SetProperty(r => r.AssessmentState, "Failed")
                        .SetProperty(r => r.Priority, r => r.ImmediateDanger ? Priority.Critical :
                            r.Priority == Priority.Critical || r.Priority == Priority.Urgent ? r.Priority : Priority.High), ct);
            await repairTransaction.CommitAsync(ct);
        }
        return true;
    }

    private static Priority FailedAssessmentPriority(Priority priority) =>
        priority is Priority.Critical or Priority.Urgent ? priority : Priority.High;
}
