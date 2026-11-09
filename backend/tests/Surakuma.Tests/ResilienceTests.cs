using System.Net;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class ResilienceTests
{
    private sealed class SimulatedHandler(Func<int, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => respond(++Calls, ct);
    }
    private static IConfiguration Config() => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Ai:ApiKey"] = "test-key", ["Mapping:ApiKey"] = "test-key", ["Email:Provider"] = "Brevo", ["Email:ApiKey"] = "test-key", ["Email:Sender"] = "test@example.test" }).Build();
    private static ServiceProvider Services(SimulatedHandler handler, bool email = false)
    {
        var services = new ServiceCollection(); services.AddLogging();
        services.AddHttpClient("provider", c => c.Timeout = Timeout.InfiniteTimeSpan).ConfigurePrimaryHttpMessageHandler(() => handler).AddSurakumaResilience(email, TimeSpan.FromMilliseconds(100), TimeSpan.FromMilliseconds(10));
        return services.BuildServiceProvider();
    }
    private static HttpResponseMessage Response(HttpStatusCode status, string body = "{}") => new(status) { Content = new StringContent(body) };
    [Fact]
    public async Task MappingRetriesTransientFailuresAndReturnsResult()
    {
        var handler = new SimulatedHandler((n, _) => Task.FromResult(Response(n == 1 ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.OK)));
        using var services = Services(handler); using var http = services.GetRequiredService<IHttpClientFactory>().CreateClient("provider");
        Assert.NotNull(await new MappingProvider(http, Config()).GeocodeAsync("Colombo", default)); Assert.Equal(2, handler.Calls);
    }
    [Fact]
    public async Task AiTimeoutsRetryThenUseLabelledFallback()
    {
        var handler = new SimulatedHandler(async (_, ct) => { await Task.Delay(Timeout.InfiniteTimeSpan, ct); return Response(HttpStatusCode.OK); });
        using var services = Services(handler); using var http = services.GetRequiredService<IHttpClientFactory>().CreateClient("provider");
        var result = await new AiProvider(http, Config(), NullLogger<AiProvider>.Instance).RecommendAsync(new AssistanceRequest { Synthetic = true, Description = "food" }, default);
        Assert.True(result.Fallback); Assert.Equal("Deterministic fallback", result.Provider); Assert.Equal(3, handler.Calls);
    }
    [Fact]
    public async Task EmailServerFailuresAreNotRetriedAndOpenCircuitIsSafeToRetry()
    {
        var handler = new SimulatedHandler((_, _) => Task.FromResult(Response(HttpStatusCode.ServiceUnavailable)));
        using var services = Services(handler, true); using var http = services.GetRequiredService<IHttpClientFactory>().CreateClient("provider");
        var provider = new EmailProvider(http, Config());
        for (int i = 0; i < 4; i++) Assert.Equal("Review", (await provider.SendAsync("test@example.test", "test", Guid.NewGuid(), default)).State);
        Assert.Equal("Retry", (await provider.SendAsync("test@example.test", "test", Guid.NewGuid(), default)).State);
        Assert.Equal(4, handler.Calls);
        Assert.Equal("Captured", (await new CaptureEmailProvider().SendAsync("test@example.test", "test", Guid.NewGuid(), default)).State);
    }
    [Fact]
    public async Task EmailRateLimitIsRetriedWithBackoff()
    {
        var handler = new SimulatedHandler((n, _) => Task.FromResult(Response(n == 1 ? HttpStatusCode.TooManyRequests : HttpStatusCode.OK, "{\"messageId\":\"test\"}")));
        using var services = Services(handler, true); using var http = services.GetRequiredService<IHttpClientFactory>().CreateClient("provider");
        Assert.Equal("Sent", (await new EmailProvider(http, Config()).SendAsync("test@example.test", "test", Guid.NewGuid(), default)).State);
        Assert.Equal(2, handler.Calls);
    }
}
