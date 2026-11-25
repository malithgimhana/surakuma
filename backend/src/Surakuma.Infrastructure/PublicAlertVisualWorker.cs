using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Surakuma.Application;
using Surakuma.Domain;

namespace Surakuma.Infrastructure;

public sealed class PublicAlertVisualWorker(IServiceScopeFactory scopes, ILogger<PublicAlertVisualWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(3));
        do
        {
            try { while (await ProcessNext(stoppingToken)) { } }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception ex) { logger.LogWarning("Public alert illustration deferred ({FailureType}).", ex.GetType().Name); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    public async Task<bool> ProcessNext(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var jobs = db.Set<PublicAlertVisual>();
        var now = DateTimeOffset.UtcNow;
        var job = await jobs.Where(x => !x.Completed && x.AvailableAt <= now)
            .OrderBy(x => x.AvailableAt).ThenBy(x => x.Id)
            .Select(x => new { x.Id, x.AlertId, x.Attempts, x.Lease, x.DescriptionOnly }).FirstOrDefaultAsync(ct);
        if (job is null) return false;

        var lease = Guid.NewGuid();
        var claim = jobs.Where(x => x.Id == job.Id && !x.Completed && x.Lease == job.Lease);
        if (await claim.ExecuteUpdateAsync(updates => updates.SetProperty(x => x.Lease, lease)
            .SetProperty(x => x.Attempts, x => x.Attempts + 1).SetProperty(x => x.AvailableAt, now.AddMinutes(4)), ct) == 0)
            return true;

        var candidate = await (from alert in db.Set<PublicAlert>().AsNoTracking()
                               join crisis in db.Set<Crisis>() on alert.CrisisId equals crisis.Id
                               join country in db.Set<Country>() on crisis.CountryCode equals country.Code
                               where alert.Id == job.AlertId && alert.Published && alert.ExpiresAt > now
                               select new { alert.Title, alert.Message, alert.Area, crisis.CountryCode, crisis.Type, crisis.District, Country = country.Name })
            .SingleOrDefaultAsync(ct);
        AlertPresentation? presentation = null;
        byte[]? image = null;
        if (candidate is not null && job.Attempts < 3)
        {
            var ai = scope.ServiceProvider.GetRequiredService<IAiProvider>();
            presentation = await ai.DescribePublicAlertAsync(candidate.Title, candidate.Message, candidate.Area, ct);
            var kind = presentation?.Kind ?? Classify(candidate.Title + " " + candidate.Message + " " + candidate.Type);
            var locality = presentation?.Locality ?? candidate.District;
            presentation = new(kind, presentation?.Summary, locality, presentation?.Description);
            try
            {
                if (!job.DescriptionOnly) image = await ai.IllustratePublicAlertAsync(kind, locality, candidate.Country, ct);
            }
            catch (Exception ex) when (!ct.IsCancellationRequested && ex is not OutOfMemoryException)
            {
                logger.LogWarning("Public alert illustration attempt failed ({FailureType}).", ex.GetType().Name);
                if (job.Attempts < 2)
                {
                    await jobs.Where(x => x.Id == job.Id && x.Lease == lease).ExecuteUpdateAsync(updates => updates
                        .SetProperty(x => x.AvailableAt, DateTimeOffset.UtcNow.AddMinutes(job.Attempts + 1)), ct);
                    return true;
                }
            }
        }

        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var current = await jobs.SingleOrDefaultAsync(x => x.Id == job.Id && x.Lease == lease && !x.Completed, ct);
        if (current is null) return true;
        var active = await db.Set<PublicAlert>().SingleOrDefaultAsync(x => x.Id == job.AlertId && x.Published && x.ExpiresAt > DateTimeOffset.UtcNow, ct);
        if (active is not null && candidate is not null)
        {
            if (presentation?.Description is { } description) active.PopupDescription = description;
            if (!job.DescriptionOnly)
            {
                active.VisualKind = presentation?.Kind;
                active.VisualSummary = presentation?.Summary;
            }
            if (image is not null && active.VisualImageUrl is null)
                current.Image = image;
        }
        current.Completed = true;
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return true;
    }

    private static string Classify(string text)
    {
        if (text.Contains("landslide", StringComparison.OrdinalIgnoreCase)) return "landslide";
        if (text.Contains("flood", StringComparison.OrdinalIgnoreCase)) return "flood";
        return new[] { "storm", "cyclone", "wind", "rain" }.Any(word => text.Contains(word, StringComparison.OrdinalIgnoreCase))
            ? "storm" : "other";
    }
}
