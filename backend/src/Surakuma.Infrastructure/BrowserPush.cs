using System.Data;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Lib.Net.Http.WebPush;
using Lib.Net.Http.WebPush.Authentication;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Surakuma.Application;
using Surakuma.Domain;

namespace Surakuma.Infrastructure;

public sealed class BrowserPushSettings(IConfiguration configuration)
{
    public string? PublicKey => configuration["BrowserPush:PublicKey"];
    public string? PrivateKey => configuration["BrowserPush:PrivateKey"];
    public string? Subject => configuration["BrowserPush:Subject"];
    public bool Enabled => ValidKey(PublicKey, 65, true) && ValidKey(PrivateKey, 32) &&
        Uri.TryCreate(Subject, UriKind.Absolute, out var contact) && contact.Scheme is "mailto" or "https";

    public static bool ValidEndpoint(string endpoint) =>
        endpoint.Length <= 1500 && Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) &&
        uri.Scheme == "https" && uri.IsDefaultPort && uri.UserInfo.Length == 0 && uri.Fragment.Length == 0 &&
        (uri.IdnHost == "fcm.googleapis.com" || uri.IdnHost == "updates.push.services.mozilla.com" ||
            uri.IdnHost.EndsWith(".push.apple.com", StringComparison.Ordinal) ||
            uri.IdnHost.EndsWith(".notify.windows.com", StringComparison.Ordinal));

    public static bool ValidKey(string? value, int length, bool curvePoint = false)
    {
        if (value is null || value.Length > 90 || value.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_')))
            return false;
        try
        {
            var bytes = Convert.FromBase64String(value.Replace('-', '+').Replace('_', '/').PadRight((value.Length + 3) / 4 * 4, '='));
            return bytes.Length == length && (!curvePoint || bytes[0] == 4);
        }
        catch (FormatException) { return false; }
    }

    public static string Hash(string endpoint) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(endpoint)));
    public static IDataProtector Protector(IDataProtectionProvider provider) => provider.CreateProtector("Surakuma.BrowserPush.v1");
}

public sealed class BrowserPushWorker(IServiceScopeFactory scopes, BrowserPushSettings settings,
    IHttpClientFactory clients, IDataProtectionProvider protection, ILogger<BrowserPushWorker> logger) : BackgroundService
{
    public const string ClientName = "surakuma-browser-push";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!settings.Enabled) return;
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(3));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try { await ProcessOne(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception ex) { logger.LogWarning("Browser push processing deferred ({FailureType}).", ex.GetType().Name); }
        }
    }

    public async Task ProcessOne(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        var visibility = scope.ServiceProvider.GetRequiredService<InternalNotifications>();
        var now = DateTimeOffset.UtcNow;
        var deliveries = db.Set<BrowserPushDelivery>();
        var subscriptions = db.Set<BrowserPushSubscription>();
        BrowserPushDelivery delivery;
        BrowserPushSubscription subscription;
        Notification notice;
        string language;
        await using (var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct))
        {
            await deliveries.Where(d => d.State == "Sending" && d.UpdatedAt < now.AddMinutes(-2))
                .ExecuteUpdateAsync(updates => updates.SetProperty(d => d.State, "Review"), ct);
            // Notifications are committed before they can be queued for a subscribed browser.
            var candidate = await (from browser in subscriptions
                join n in db.Set<Notification>() on browser.UserId equals n.UserId
                join user in db.Users on browser.UserId equals user.Id
                join d in deliveries on new { SubscriptionId = browser.Id, NotificationId = n.Id }
                    equals new { d.SubscriptionId, d.NotificationId } into prior
                from d in prior.DefaultIfEmpty()
                where n.CreatedAt >= browser.EnabledAt && n.CreatedAt >= now.AddDays(-1) && !n.Read &&
                    (d == null || d.State == "Retry" && d.NextAttemptAt <= now) && !user.Disabled
                orderby n.CreatedAt, n.Id, browser.Id
                select new { Browser = browser, Notice = n, Delivery = d, user.Language }).FirstOrDefaultAsync(ct);
            if (candidate is null)
            {
                await tx.CommitAsync(ct);
                return;
            }
            subscription = candidate.Browser;
            notice = candidate.Notice;
            language = candidate.Language;
            delivery = candidate.Delivery ?? new BrowserPushDelivery { SubscriptionId = subscription.Id, NotificationId = notice.Id };
            if (candidate.Delivery is null) deliveries.Add(delivery);
            else delivery.Attempts++;
            var visible = !notice.IsInternal || await visibility.Visible(subscription.UserId, notice.ScopeCountryCode, notice.ScopeRole)
                .AnyAsync(n => n.Id == notice.Id, ct);
            delivery.State = visible ? "Sending" : "Skipped";
            delivery.UpdatedAt = now;
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            if (!visible) return;
        }

        if (!await subscriptions.AnyAsync(x => x.Id == subscription.Id, ct)) return;
        var result = await Send(subscription, notice, language, ct);
        if (result == "Expired") db.Remove(subscription);
        else
        {
            delivery.State = result == "Retry" && delivery.Attempts >= 3 ? "Failed" : result;
            delivery.NextAttemptAt = delivery.State == "Retry" ? now.AddMinutes(2 * delivery.Attempts) : null;
            delivery.UpdatedAt = DateTimeOffset.UtcNow;
        }
        await db.SaveChangesAsync(ct);
    }

    private async Task<string> Send(BrowserPushSubscription subscription, Notification notice, string language, CancellationToken ct)
    {
        try
        {
            var protector = BrowserPushSettings.Protector(protection);
            var endpoint = protector.Unprotect(subscription.Endpoint);
            if (!BrowserPushSettings.ValidEndpoint(endpoint)) return "Expired";
            var browser = new PushSubscription { Endpoint = endpoint };
            browser.SetKey(PushEncryptionKeyName.Auth, protector.Unprotect(subscription.AuthSecret));
            browser.SetKey(PushEncryptionKeyName.P256DH, protector.Unprotect(subscription.PublicKey));
            using var http = clients.CreateClient(ClientName);
            var client = new PushServiceClient(http) { AutoRetryAfter = false };
            using var vapid = new VapidAuthentication(settings.PublicKey!, settings.PrivateKey!) { Subject = settings.Subject };
            var path = !notice.IsInternal && notice.RequestId is Guid request ? $"/app/requests/{request}" :
                notice.ScopeRole == Roles.Volunteer && notice.TaskId is Guid task ? $"/volunteer?task={task}" :
                notice.ScopeRole == Roles.Volunteer ? "/volunteer/notifications" : "/app/notifications";
            var payload = JsonSerializer.Serialize(new { path, tag = notice.Id, language });
            await client.RequestPushMessageDeliveryAsync(browser, new PushMessage(payload) { TimeToLive = 3600 }, vapid, ct);
            return "Sent";
        }
        catch (PushServiceClientException ex)
        {
            return ex.StatusCode switch
            {
                HttpStatusCode.NotFound or HttpStatusCode.Gone => "Expired",
                HttpStatusCode.TooManyRequests => "Retry",
                _ => "Failed"
            };
        }
        catch (CryptographicException) { return "Expired"; }
        catch (Exception ex) when (ex is HttpRequestException || ex is OperationCanceledException && !ct.IsCancellationRequested)
        {
            return "Review";
        }
    }
}
