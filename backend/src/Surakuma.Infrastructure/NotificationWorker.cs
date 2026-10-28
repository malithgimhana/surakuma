using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Surakuma.Application;
using Surakuma.Domain;

namespace Surakuma.Infrastructure;

public sealed class NotificationWorker(IServiceScopeFactory scopeFactory, ILogger<NotificationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessOne(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogWarning("Notification processing deferred ({FailureType}).", ex.GetType().Name); }
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
            }
            catch (OperationCanceledException) { break; }
        }
    }
    public async Task ProcessOne(CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var provider = scope.ServiceProvider.GetRequiredService<IEmailProvider>();
        OutboxMessage? message;
        NotificationDelivery delivery;
        await using (var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct))
        {
            var stale = await db.Set<OutboxMessage>().Where(x => x.State == "Processing" && x.UpdatedAt < DateTimeOffset.UtcNow.AddMinutes(-2)).ToListAsync(ct);
            foreach (var item in stale)
            {
                item.State = "Review";
                item.LastError = "Worker interrupted during send; verify delivery before retrying.";
            }
            message = await db.Set<OutboxMessage>().Where(x => (x.State == "Pending" || x.State == "Retry") && x.NextAttemptAt <= DateTimeOffset.UtcNow).OrderBy(x => x.CreatedAt).FirstOrDefaultAsync(ct);
            if (message is null)
            {
                await db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);
                return;
            }
            delivery = await db.Set<NotificationDelivery>().SingleOrDefaultAsync(x => x.EventId == message.Id && x.RecipientId == message.UserId, ct)
                ?? new NotificationDelivery { EventId = message.Id, RecipientId = message.UserId, Provider = provider.Name };
            if (delivery.State is "Sent" or "Captured" or "Review" or "Failed")
            {
                message.State = delivery.State;
                await db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);
                return;
            }
            if (db.Entry(delivery).State == EntityState.Detached)
                db.Add(delivery);
            if (!await db.Set<Notification>().AnyAsync(x => x.EventId == message.Id && x.UserId == message.UserId, ct))
                db.Add(new Notification { EventId = message.Id, UserId = message.UserId, RequestId = message.RequestId, Message = message.Message, SinhalaMessage = message.SinhalaMessage, TamilMessage = message.TamilMessage });
            message.State = "Processing";
            message.Attempts++;
            delivery.State = "Processing";
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        var user = await db.Users.FindAsync([message.UserId], ct);
        var result = user?.Email is null ? new DeliveryResult("Failed", Error: "Recipient email unavailable.") : await provider.SendAsync(user.Email, user.Language == "si" ? message.SinhalaMessage : user.Language == "ta" ? message.TamilMessage : message.Message, message.Id, ct);
        message.State = result.State == "Retry" && message.Attempts >= 4 ? "Failed" : result.State;
        message.LastError = result.Error;
        message.NextAttemptAt = DateTimeOffset.UtcNow.AddSeconds(Math.Pow(2, message.Attempts) * 10);
        delivery.State = message.State;
        delivery.ProviderReference = result.Reference;
        await db.SaveChangesAsync(ct);
    }
}
