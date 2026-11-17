using System.Net.Http.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Surakuma.Domain;
namespace Surakuma.Infrastructure;

public sealed class SecurityEmailWorker(IServiceScopeFactory scopes, ILogger<SecurityEmailWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await ProcessOne(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogWarning("Security email deferred ({Type})", ex.GetType().Name); }
            try { await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken); } catch (OperationCanceledException) { break; }
        }
    }
    public async Task ProcessOne(CancellationToken ct)
    {
        using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<CrisisDbContext>();
        SecurityEmail? email;
        await using (var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct))
        {
            email = await db.Set<SecurityEmail>().Where(e => e.State == "Pending").OrderBy(e => e.CreatedAt).FirstOrDefaultAsync(ct);
            if (email == null) return;
            email.State = email.ExpiresAt <= DateTimeOffset.UtcNow ? "Expired" : "Processing";
            await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        }
        if (email.State == "Expired") return;
        var config = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        var user = await db.Users.FindAsync([email.UserId], ct);
        if (user == null || user.Disabled) { email.State = "Skipped"; }
        else if (config["Email:Provider"] == "Capture") email.State = "Captured";
        else if (config["Email:Provider"] != "Brevo" || string.IsNullOrWhiteSpace(config["Email:ApiKey"]) || !Uri.TryCreate(config["Email:PortalBaseUrl"], UriKind.Absolute, out var portal) || (portal.Scheme != "https" && !portal.IsLoopback)) email.State = "Failed";
        else
        {
            var token = scope.ServiceProvider.GetRequiredService<IDataProtectionProvider>().CreateProtector("Surakuma.PasswordRecovery").Unprotect(email.ProtectedToken);
            var url = new Uri(portal, "/reset-password").ToString() + "#email=" + Uri.EscapeDataString(user.Email!) + "&token=" + Uri.EscapeDataString(token);
            var content = PasswordResetEmailContent.Create(url, portal, config["Email:LogoUrl"]);
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
            using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.brevo.com/v3/smtp/email"); request.Headers.Add("api-key", config["Email:ApiKey"]);
            request.Content = JsonContent.Create(new
            {
                sender = new { name = "Surakuma", email = config["Email:Sender"] },
                to = new[] { new { email = user.Email } },
                subject = content.Subject,
                textContent = content.Text,
                htmlContent = content.Html
            });
            try { using var response = await client.SendAsync(request, ct); email.State = response.IsSuccessStatusCode ? "Sent" : "Failed"; }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException) { email.State = "Review"; }
        }
        if (email.State != "Captured") email.ProtectedToken = "";
        await db.SaveChangesAsync(ct);
    }
}
