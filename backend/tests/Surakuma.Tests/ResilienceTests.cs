using System.Net;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Surakuma.Api.Controllers;
using Surakuma.Application;
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
    private static IConfiguration Config() => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Ai:OpenAiApiKey"] = "test-key", ["Ai:EnableRestrictedTriage"] = "true", ["Mapping:ApiKey"] = "test-key", ["Email:Provider"] = "Brevo", ["Email:ApiKey"] = "test-key", ["Email:Sender"] = "test@example.test" }).Build();
    private static ServiceProvider Services(SimulatedHandler handler, bool email = false, bool ai = false, bool useDefaultTimeout = false)
    {
        var services = new ServiceCollection(); services.AddLogging();
        services.AddHttpClient("provider", c => c.Timeout = Timeout.InfiniteTimeSpan).ConfigurePrimaryHttpMessageHandler(() => handler)
            .AddSurakumaResilience(email, useDefaultTimeout ? null : TimeSpan.FromMilliseconds(100), TimeSpan.FromMilliseconds(10), ai);
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
    public async Task GeocodeCachesResultsButAllowsRecoveryAfterProviderFailure()
    {
        var handler = new SimulatedHandler((call, _) => Task.FromResult(call == 1
            ? Response(HttpStatusCode.ServiceUnavailable)
            : Response(HttpStatusCode.OK, """{"features":[]}""")));
        using var http = new HttpClient(handler);
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var controller = new OperationsController(null!, null!, null!, null!, new MappingProvider(http, Config()), cache, null!);

        var unavailable = Assert.IsType<ObjectResult>(await controller.Geocode("Colombo", default));
        Assert.Equal(503, unavailable.StatusCode);
        Assert.IsType<OkObjectResult>(await controller.Geocode("Colombo", default));
        Assert.IsType<OkObjectResult>(await controller.Geocode(" colombo ", default));
        Assert.Equal(2, handler.Calls);
    }
    [Fact]
    public async Task AiTimeoutsRetryThenUseLabelledFallback()
    {
        var handler = new SimulatedHandler(async (_, ct) => { await Task.Delay(Timeout.InfiniteTimeSpan, ct); return Response(HttpStatusCode.OK); });
        using var services = Services(handler, ai: true); using var http = services.GetRequiredService<IHttpClientFactory>().CreateClient("provider");
        var result = await new AiProvider(http, Config(), NullLogger<AiProvider>.Instance).RecommendAsync(new AssistanceRequest { Synthetic = true, Description = "food" }, default);
        Assert.True(result.Fallback); Assert.Equal("Deterministic fallback", result.Provider); Assert.Equal(2, handler.Calls);
    }
    [Fact]
    public async Task AiAcceptsResponseTakingLongerThanFiveSeconds()
    {
        var handler = new SimulatedHandler(async (_, ct) =>
        {
            await Task.Delay(TimeSpan.FromMilliseconds(5250), ct);
            return Response(HttpStatusCode.OK, """{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"{\"category\":\"FoodWater\",\"signals\":[\"food\"]}"}]}]}""");
        });
        using var services = Services(handler, ai: true, useDefaultTimeout: true);
        using var http = services.GetRequiredService<IHttpClientFactory>().CreateClient("provider");
        var result = await new AiProvider(http, Config(), NullLogger<AiProvider>.Instance)
            .RecommendAsync(new AssistanceRequest { Synthetic = true, Description = "food" }, default);
        Assert.False(result.Fallback);
        Assert.Equal("OpenAI", result.Provider);
        Assert.Equal(1, handler.Calls);
    }
    [Fact]
    public async Task AiCallerCancellationDoesNotRetryOrReturnFallback()
    {
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var handler = new SimulatedHandler(async (_, ct) =>
        {
            started.SetResult();
            await Task.Delay(Timeout.InfiniteTimeSpan, ct);
            return Response(HttpStatusCode.OK);
        });
        using var services = Services(handler, ai: true, useDefaultTimeout: true);
        using var http = services.GetRequiredService<IHttpClientFactory>().CreateClient("provider");
        using var cancellation = new CancellationTokenSource();
        var pending = new AiProvider(http, Config(), NullLogger<AiProvider>.Instance)
            .RecommendAsync(new AssistanceRequest { Synthetic = true, Description = "food" }, cancellation.Token);
        await started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => pending);
        Assert.Equal(1, handler.Calls);
    }
    [Fact]
    public async Task EmailServerFailuresAreNotRetriedAndOpenCircuitIsSafeToRetry()
    {
        var handler = new SimulatedHandler((_, _) => Task.FromResult(Response(HttpStatusCode.ServiceUnavailable)));
        using var services = Services(handler, true); using var http = services.GetRequiredService<IHttpClientFactory>().CreateClient("provider");
        var provider = new EmailProvider(http, Config());
        var update = new CitizenEmailUpdate("test");
        for (int i = 0; i < 4; i++) Assert.Equal("Review", (await provider.SendAsync("test@example.test", update, Guid.NewGuid(), default)).State);
        Assert.Equal("Retry", (await provider.SendAsync("test@example.test", update, Guid.NewGuid(), default)).State);
        Assert.Equal(4, handler.Calls);
        Assert.Equal("Captured", (await new CaptureEmailProvider().SendAsync("test@example.test", update, Guid.NewGuid(), default)).State);
    }
    [Fact]
    public async Task EmailRateLimitIsRetriedWithBackoff()
    {
        var handler = new SimulatedHandler((n, _) => Task.FromResult(Response(n == 1 ? HttpStatusCode.TooManyRequests : HttpStatusCode.OK, "{\"messageId\":\"test\"}")));
        using var services = Services(handler, true); using var http = services.GetRequiredService<IHttpClientFactory>().CreateClient("provider");
        Assert.Equal("Sent", (await new EmailProvider(http, Config()).SendAsync("test@example.test", new CitizenEmailUpdate("test"), Guid.NewGuid(), default)).State);
        Assert.Equal(2, handler.Calls);
    }
}
