using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class ProviderTests
{
    private sealed class Handler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public int Calls
        {
            get; private set;
        }
        public string? Body { get; private set; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            Body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }
    }
    private sealed class CaptureMappingHandler : HttpMessageHandler
    {
        public Uri? Uri { get; private set; }
        public string? Authorization { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Uri = request.RequestUri;
            Authorization = request.Headers.TryGetValues("Authorization", out var values) ? values.Single() : null;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"features\":[]}", Encoding.UTF8, "application/json") });
        }
    }
    private static IConfiguration Config() => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Ai:ApiKey"] = "synthetic-test-key", ["Email:Provider"] = "Brevo", ["Email:ApiKey"] = "synthetic-test-key", ["Email:Sender"] = "demo@example.test" }).Build();
    [Theory]
    [InlineData("search", "/pelias/v1/search?boundary.country=LKA&size=5&text=Fort%20%26%20Pettah")]
    [InlineData("reverse", "/pelias/v1/reverse?point.lat=6.9271&point.lon=79.8612&size=5")]
    [InlineData("route", "/openrouteservice/v2/directions/driving-car?start=79.8612,6.9271&end=79.8553,6.9344")]
    public async Task MappingUsesSupportedHeiGitEndpoints(string operation, string pathAndQuery)
    {
        var handler = new CaptureMappingHandler();
        using var http = new HttpClient(handler);
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Mapping:ApiKey"] = "test-key" }).Build();
        var maps = new MappingProvider(http, config);
        var result = await (operation switch
        {
            "search" => maps.GeocodeAsync("Fort & Pettah", default),
            "reverse" => maps.ReverseGeocodeAsync(6.9271, 79.8612, default),
            "route" => maps.RouteAsync(6.9271, 79.8612, 6.9344, 79.8553, default),
            _ => throw new ArgumentOutOfRangeException(nameof(operation))
        });
        Assert.NotNull(result);
        Assert.Equal("https://api.heigit.org" + pathAndQuery, handler.Uri!.AbsoluteUri);
        Assert.Equal("test-key", handler.Authorization);
    }
    [Fact]
    public async Task ReverseGeocodingWithoutKeyDoesNotContactProvider()
    {
        var handler = new CaptureMappingHandler();
        using var http = new HttpClient(handler);
        Assert.Null(await new MappingProvider(http, Config()).ReverseGeocodeAsync(6.9, 79.8, default));
        Assert.Null(handler.Uri);
    }
    [Theory]
    [InlineData(HttpStatusCode.ServiceUnavailable, "{}")]
    [InlineData(HttpStatusCode.OK, "{\"candidates\":[]}")]
    [InlineData(HttpStatusCode.OK, "not-json")]
    public async Task AiFailureAndMalformedOutputBecomeLabelledFallback(HttpStatusCode status, string body)
    {
        using var http = new HttpClient(new Handler(status, body));
        var provider = new AiProvider(http, Config(), NullLogger<AiProvider>.Instance);
        var result = await provider.RecommendAsync(new AssistanceRequest { Description = "Synthetic household needs food", Synthetic = true }, default);
        Assert.True(result.Fallback);
        Assert.Equal("Deterministic fallback", result.Provider);
    }
    [Fact]
    public async Task NonSyntheticRequestNeverReachesFreeExternalAi()
    {
        var handler = new Handler(HttpStatusCode.OK, "{}");
        using var http = new HttpClient(handler);
        var provider = new AiProvider(http, Config(), NullLogger<AiProvider>.Instance);
        var result = await provider.RecommendAsync(new AssistanceRequest { Synthetic = false, Description = "Private personal information" }, default);
        Assert.True(result.Fallback);
        Assert.Equal(0, handler.Calls);
    }
    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests, "Retry")]
    [InlineData(HttpStatusCode.ServiceUnavailable, "Review")]
    [InlineData(HttpStatusCode.BadRequest, "Failed")]
    public async Task EmailDistinguishesSafeRetriesFromUnknownOutcomes(HttpStatusCode status, string state)
    {
        using var http = new HttpClient(new Handler(status, "{}"));
        var provider = new EmailProvider(http, Config());
        var result = await provider.SendAsync("demo@example.test", new CitizenEmailUpdate("Synthetic message"), Guid.NewGuid(), default);
        Assert.Equal(state, result.State);
    }

    [Fact]
    public async Task BrevoReceivesLocalizedStatusEmailWithRequestLinkAndWebsiteLogo()
    {
        var handler = new Handler(HttpStatusCode.Created, """{"messageId":"demo-id"}""");
        using var http = new HttpClient(handler);
        var config = Config();
        config["Email:PortalBaseUrl"] = "https://surakuma.example.test";
        var entry = new OutboxMessage
        {
            RequestId = Guid.NewGuid(),
            Message = "SK-27B4E8A190: Your request has been approved for assistance.",
            TamilMessage = "SK-27B4E8A190: அங்கீகரிக்கப்பட்டது."
        };
        var result = await new EmailProvider(http, config).SendAsync(
            "demo@example.test", CitizenEmailUpdate.FromOutbox(entry, "ta"), entry.Id, default);

        Assert.Equal(new DeliveryResult("Sent", "demo-id"), result);
        using var json = JsonDocument.Parse(handler.Body!);
        var payload = json.RootElement;
        Assert.Equal("உங்கள் கோரிக்கை அங்கீகரிக்கப்பட்டது", payload.GetProperty("subject").GetString());
        var text = payload.GetProperty("textContent").GetString();
        var html = payload.GetProperty("htmlContent").GetString();
        var requestUrl = $"https://surakuma.example.test/app/requests/{entry.RequestId:D}";
        Assert.Contains(requestUrl, text);
        Assert.Contains("குறிப்பு எண்: SK-27B4E8A190", text);
        Assert.Contains($"href=\"{requestUrl}\"", html);
        Assert.Contains("src=\"https://surakuma.example.test/surakuma-email-logo.png\"", html);
        Assert.Contains("lang=\"ta\"", html);
        Assert.Equal(entry.Id.ToString(), payload.GetProperty("headers").GetProperty("X-Surakuma-Event").GetString());
    }
}
