using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Surakuma.Domain;
namespace Surakuma.Infrastructure;

public sealed class SecurityEmailWorker(IServiceScopeFactory scopes, IHttpClientFactory clients, ILogger<SecurityEmailWorker> logger) : BackgroundService
{
    public const string ClientName = "Surakuma.SecurityEmail";

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
        using var scope = scopes.CreateScope();
        var services = scope.ServiceProvider;
        var db = services.GetRequiredService<CrisisDbContext>();
        SecurityEmail? email;
        string protectedToken;
        await using (var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct))
        {
            email = await db.Set<SecurityEmail>().Where(e => e.State == "Pending").OrderBy(e => e.CreatedAt).FirstOrDefaultAsync(ct);
            if (email == null) return;
            email.State = email.ExpiresAt <= DateTimeOffset.UtcNow ? "Expired" : "Processing";
            protectedToken = email.ProtectedToken;
            // Once claimed for delivery, the initial password is held only by this worker.
            if (email.Kind == SecurityEmailKind.StaffInvitation || email.State == "Expired") email.ProtectedToken = "";
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        if (email.State == "Expired") return;
        email.State = await Deliver(email, protectedToken, services, db, ct);
        if (email.State != "Captured") email.ProtectedToken = "";
        await db.SaveChangesAsync(ct.IsCancellationRequested ? CancellationToken.None : ct);
    }

    private async Task<string> Deliver(SecurityEmail email, string protectedToken, IServiceProvider services, CrisisDbContext db, CancellationToken ct)
    {
        var config = services.GetRequiredService<IConfiguration>();
        var user = await db.Users.FindAsync([email.UserId], ct);
        if (user == null || user.Disabled || string.IsNullOrWhiteSpace(user.Email)) return "Skipped";
        if (config["Email:Provider"] == "Capture") return "Captured";
        var key = config["Email:ApiKey"];
        var sender = config["Email:Sender"];
        if (config["Email:Provider"] != "Brevo" || string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(sender)
            || !Uri.TryCreate(config["Email:PortalBaseUrl"], UriKind.Absolute, out var portal)
            || !(portal.Scheme == Uri.UriSchemeHttps || (portal.Scheme == Uri.UriSchemeHttp && portal.IsLoopback)))
            return "Failed";

        (string Subject, string Text, string Html) content;
        var protection = services.GetRequiredService<IDataProtectionProvider>();
        try
        {
            if (email.Kind == SecurityEmailKind.StaffInvitation)
            {
                var invitation = StaffInvitationEmail.Read(protectedToken, protection);
                var hasher = services.GetRequiredService<IPasswordHasher<AppUser>>();
                if (!string.Equals(invitation.Email, user.Email, StringComparison.OrdinalIgnoreCase) || user.PasswordHash is null
                    || hasher.VerifyHashedPassword(user, user.PasswordHash, invitation.Password) == PasswordVerificationResult.Failed)
                    return "Skipped";
                var workspace = await (from membership in db.Set<Membership>()
                                       join country in db.Set<Country>() on membership.CountryCode equals country.Code
                                       where membership.Id == invitation.MembershipId && membership.UserId == user.Id
                                       select new { membership.Role, country.Name }).SingleOrDefaultAsync(ct);
                if (workspace is null) return "Skipped";
                content = invitation.CreateContent(user.DisplayName, workspace.Role, workspace.Name, portal);
            }
            else
            {
                var token = protection.CreateProtector("Surakuma.PasswordRecovery").Unprotect(protectedToken);
                var url = new Uri(portal, "/reset-password").AbsoluteUri + "#email=" + Uri.EscapeDataString(user.Email) + "&token=" + Uri.EscapeDataString(token);
                var reset = PasswordResetEmailContent.Create(url, portal, config["Email:LogoUrl"]);
                content = (reset.Subject, reset.Text, reset.Html);
            }
        }
        catch (Exception ex) when (ex is CryptographicException or JsonException)
        {
            logger.LogWarning("Could not read security email {EmailId} ({Type})", email.Id, ex.GetType().Name);
            return "Failed";
        }

        using var client = clients.CreateClient(ClientName);
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.brevo.com/v3/smtp/email");
        request.Headers.Add("api-key", key);
        request.Content = JsonContent.Create(new
        {
            sender = new { name = "Surakuma", email = sender },
            to = new[] { new { email = user.Email } },
            subject = content.Subject,
            textContent = content.Text,
            htmlContent = content.Html
        });
        try
        {
            using var response = await client.SendAsync(request, ct);
            return response.IsSuccessStatusCode ? "Sent" : "Failed";
        }
        catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException)
        {
            return "Review";
        }
    }
}
