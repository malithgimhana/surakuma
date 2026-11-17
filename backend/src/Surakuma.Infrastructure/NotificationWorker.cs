using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
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
        AppUser? user;
        bool citizen;
        DeliveryAttempt? attempt = null;
        await using (var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct))
        {
            var stale = await db.Set<OutboxMessage>().Where(x => x.State == "Processing" && x.UpdatedAt < DateTimeOffset.UtcNow.AddMinutes(-2)).ToListAsync(ct);
            foreach (var item in stale)
            {
                item.State = "Review";
                item.LastError = "Worker interrupted during send; verify delivery before retrying.";
                foreach (var interrupted in await db.Set<DeliveryAttempt>().Where(a => a.EventId == item.Id && a.State == "Processing").ToListAsync(ct)) { interrupted.State = "Review"; interrupted.Error = item.LastError; }
                var interruptedDelivery = await db.Set<NotificationDelivery>().SingleOrDefaultAsync(d => d.EventId == item.Id && d.RecipientId == item.UserId, ct);
                if (interruptedDelivery != null) interruptedDelivery.State = "Review";
            }
            message = await db.Set<OutboxMessage>().Where(x => (x.State == "Pending" || x.State == "Retry") && x.NextAttemptAt <= DateTimeOffset.UtcNow).OrderBy(x => x.CreatedAt).FirstOrDefaultAsync(ct);
            if (message is null)
            {
                await db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);
                return;
            }
            user = await db.Users.FindAsync([message.UserId], ct);
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var roles = user is null ? Array.Empty<string>() : (await users.GetRolesAsync(user)).ToArray();
            citizen = NotificationChannels.ReceivesCitizenEmail(roles);
            if (citizen && !await db.Set<Notification>().AnyAsync(x => x.EventId == message.Id && x.UserId == message.UserId, ct))
                db.Add(new Notification { EventId = message.Id, UserId = message.UserId,
                    RequestId = message.RequestId, Message = message.Message,
                    SinhalaMessage = message.SinhalaMessage, TamilMessage = message.TamilMessage });
            delivery = await db.Set<NotificationDelivery>().SingleOrDefaultAsync(x => x.EventId == message.Id && x.RecipientId == message.UserId, ct)
                ?? new NotificationDelivery { EventId = message.Id, RecipientId = message.UserId, Provider = provider.Name };
            if (delivery.State is "Sent" or "Captured" or "Review" or "Failed" or "Skipped")
            {
                message.State = delivery.State;
                await db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);
                return;
            }
            if (db.Entry(delivery).State == EntityState.Detached)
                db.Add(delivery);
            message.State = "Processing";
            message.Attempts++;
            message.CycleAttempts++;
            attempt = new DeliveryAttempt { EventId = message.Id, Number = message.Attempts }; db.Add(attempt);
            delivery.State = "Processing";
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        var result = user?.Email is null
            ? new DeliveryResult("Failed", Error: "Recipient email unavailable.")
            : !citizen
                ? new DeliveryResult("Skipped", Error: "Email notifications are reserved for citizen accounts.")
                : await provider.SendAsync(user.Email, CitizenEmailUpdate.FromOutbox(message, user.Language), message.Id, ct);
        message.State = result.State == "Retry" && message.CycleAttempts >= 4 ? "Failed" : result.State;
        message.LastError = result.Error;
        message.NextAttemptAt = DateTimeOffset.UtcNow.AddSeconds(Math.Pow(2, message.Attempts) * 10);
        delivery.State = message.State;
        delivery.ProviderReference = result.Reference;
        if (attempt != null) { attempt.State = message.State; attempt.Error = result.Error; attempt.ProviderReference = result.Reference; }
        await db.SaveChangesAsync(ct);
    }
}
