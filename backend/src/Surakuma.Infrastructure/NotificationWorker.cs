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
        bool eligible;
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
            var funding = message.FundingCountryCode != null;
            eligible = funding ? roles.Contains(Roles.Donor) : NotificationChannels.ReceivesCitizenEmail(roles);
            if (!funding && eligible && user?.Disabled == false &&
                !await db.Set<Notification>().AnyAsync(x => x.EventId == message.Id && x.UserId == message.UserId, ct))
            {
                string? WithCopy(string language, string? text)
                    => message.CopyLanguage == language && message.ReviewedCopy is { } copy ? text + " " + copy : text;
                var (reference, status) = CitizenMessages.ReadQueuedStatus(message.Message);
                db.Add(new Notification { EventId = message.Id, UserId = message.UserId,
                    RequestId = message.RequestId, Message = WithCopy("en", message.Message)!,
                    SinhalaMessage = WithCopy("si", message.SinhalaMessage)!, TamilMessage = WithCopy("ta", message.TamilMessage)!,
                    HindiMessage = status.HasValue && reference != null ? WithCopy("hi", CitizenMessages.Status(reference, status.Value, "hi")) : null,
                    NepaliMessage = status.HasValue && reference != null ? WithCopy("ne", CitizenMessages.Status(reference, status.Value, "ne")) : null,
                    CommunicationSource = message.CommunicationSource });
            }
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
            : !eligible || user.Disabled
                ? new DeliveryResult("Skipped", Error: message.FundingCountryCode != null
                    ? "Donation email notifications require an active donor account."
                    : "Email notifications require an active citizen account.")
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
