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
    private sealed class CaptureEmailHandler : HttpMessageHandler
    {
        public string Body { get; private set; } = "";
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Body = await request.Content!.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"messageId\":\"test\"}", Encoding.UTF8, "application/json") };
        }
    }
    [Fact]
    public async Task EmailIncludesReadableTextAndSafeHtmlInSelectedLanguage()
    {
        var handler = new CaptureEmailHandler();
        using var http = new HttpClient(handler);
        var provider = new EmailProvider(http, Config());
        var message = CitizenMessages.Status("SK-TEST", RequestStatus.Approved, "en");
        Assert.Equal("Sent", (await provider.SendAsync("demo@example.test", message, Guid.NewGuid(), default)).State);
        using var payload = JsonDocument.Parse(handler.Body);
        Assert.Contains("approved for assistance", payload.RootElement.GetProperty("textContent").GetString());
        Assert.Contains("SK-TEST", payload.RootElement.GetProperty("htmlContent").GetString());
        var tamil = CitizenEmailContent.Create("SK-TEST: <test>", "ta");
        Assert.Contains("கோரிக்கை", tamil.Subject);
        Assert.Contains("&lt;test&gt;", tamil.Html);
        Assert.DoesNotContain("<test>", tamil.Html);
    }
    private sealed class Handler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public int Calls
        {
            get; private set;
        }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }
    private sealed class CaptureMappingHandler : HttpMessageHandler
    {
        public Uri? Uri { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Uri = request.RequestUri;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"features\":[]}", Encoding.UTF8, "application/json") });
        }
    }
    private static IConfiguration Config() => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Ai:ApiKey"] = "synthetic-test-key", ["Email:Provider"] = "Brevo", ["Email:ApiKey"] = "synthetic-test-key", ["Email:Sender"] = "demo@example.test" }).Build();
    [Fact]
    public async Task ReverseGeocodingUsesLatitudeAndLongitudeInProviderRequest()
    {
        var handler = new CaptureMappingHandler();
        using var http = new HttpClient(handler);
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Mapping:ApiKey"] = "test-key" }).Build();
        var result = await new MappingProvider(http, config).ReverseGeocodeAsync(6.9271, 79.8612, default);
        Assert.NotNull(result);
        Assert.Equal("/geocode/reverse", handler.Uri!.AbsolutePath);
        Assert.Contains("point.lat=6.9271", handler.Uri.Query);
        Assert.Contains("point.lon=79.8612", handler.Uri.Query);
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
        var result = await provider.SendAsync("demo@example.test", "Synthetic message", Guid.NewGuid(), default);
        Assert.Equal(state, result.State);
    }
}
