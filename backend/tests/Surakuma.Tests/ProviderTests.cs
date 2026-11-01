using System.Net;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
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
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }
    private static IConfiguration Config() => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Ai:ApiKey"] = "synthetic-test-key", ["Email:Provider"] = "Brevo", ["Email:ApiKey"] = "synthetic-test-key", ["Email:Sender"] = "demo@example.test" }).Build();
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
