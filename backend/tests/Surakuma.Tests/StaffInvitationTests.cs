using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class StaffInvitationTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task NewStaffReceivesOneBrandedInvitationAndCanSignIn()
    {
        using var admin = await fixture.Login("admin");
        using var scope = fixture.Factory.Services.CreateScope();
        var services = scope.ServiceProvider;
        var db = services.GetRequiredService<CrisisDbContext>();
        var organisationId = await db.Set<OrganisationCountry>().Where(x => x.CountryCode == "LK")
            .Select(x => x.OrganisationId).FirstAsync();
        var email = $"{Guid.NewGuid():N}@surakuma.test";
        var password = fixture.Password + "<&>";
        var input = new { email, password, name = "Amara & Team", organisationId, role = Roles.CaseManager, countryCode = "LK" };
        const string path = "/api/v1/admin/users";

        using var created = await admin.PostAsJsonAsync(path, input);
        created.EnsureSuccessStatusCode();
        var account = await created.Content.ReadFromJsonAsync<JsonElement>();
        var id = account.GetProperty("id").GetString();
        Assert.True(account.GetProperty("invitationQueued").GetBoolean());
        Assert.False(account.TryGetProperty("password", out _));
        var invitation = await db.Set<SecurityEmail>().AsNoTracking().SingleAsync(x => x.UserId == id);
        Assert.Equal(SecurityEmailKind.StaffInvitation, invitation.Kind);
        Assert.Equal("Pending", invitation.State);
        Assert.DoesNotContain(password, invitation.ProtectedToken);

        using var repeated = await admin.PostAsJsonAsync(path, input with { password = "Ignored!12345" });
        repeated.EnsureSuccessStatusCode();
        Assert.False((await repeated.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("invitationQueued").GetBoolean());
        Assert.Equal(1, await db.Set<SecurityEmail>().CountAsync(x => x.UserId == id));

        var config = services.GetRequiredService<IConfiguration>();
        config["Email:Provider"] = "Brevo";
        config["Email:ApiKey"] = "synthetic-test-key";
        config["Email:Sender"] = "sender@surakuma.test";
        config["Email:PortalBaseUrl"] = "https://portal.surakuma.test";
        using var transport = new BrevoTransport();
        using var worker = new SecurityEmailWorker(services.GetRequiredService<IServiceScopeFactory>(), transport,
            NullLogger<SecurityEmailWorker>.Instance);
        await worker.ProcessOne(default);
        await worker.ProcessOne(default);

        var sent = Assert.Single(transport.Messages);
        Assert.Equal(email, sent.GetProperty("to")[0].GetProperty("email").GetString());
        Assert.Equal("Welcome to Surakuma | Your account details", sent.GetProperty("subject").GetString());
        var text = sent.GetProperty("textContent").GetString();
        Assert.Contains(password, text);
        Assert.Contains("Case Manager", text);
        Assert.Contains("Sri Lanka", text);
        var html = sent.GetProperty("htmlContent").GetString();
        Assert.Contains("Amara &amp; Team", html);
        Assert.Contains(WebUtility.HtmlEncode(password), html);
        Assert.Contains("href=\"https://portal.surakuma.test/login\"", html);
        var result = await db.Set<SecurityEmail>().AsNoTracking().SingleAsync(x => x.Id == invitation.Id);
        Assert.Equal("Sent", result.State);
        Assert.Empty(result.ProtectedToken);

        using var browser = fixture.Client();
        using var signIn = await browser.PostAsJsonAsync("/api/v1/auth/login", new { email, password });
        signIn.EnsureSuccessStatusCode();
        using var reset = await browser.PostAsJsonAsync("/api/v1/auth/forgot-password", new { email });
        Assert.Equal(HttpStatusCode.Accepted, reset.StatusCode);
        Assert.True(await db.Set<SecurityEmail>().AnyAsync(x => x.UserId == id && x.Kind == SecurityEmailKind.PasswordReset));
    }

    private sealed class BrevoTransport : HttpMessageHandler, IHttpClientFactory
    {
        public List<JsonElement> Messages { get; } = [];

        public HttpClient CreateClient(string name)
        {
            Assert.Equal(SecurityEmailWorker.ClientName, name);
            return new HttpClient(this, disposeHandler: false);
        }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Assert.Equal("https://api.brevo.com/v3/smtp/email", request.RequestUri?.AbsoluteUri);
            Messages.Add(await request.Content!.ReadFromJsonAsync<JsonElement>(cancellationToken));
            return new HttpResponseMessage(HttpStatusCode.Created);
        }
    }
}
