using System.Net;
using Microsoft.Extensions.DependencyInjection;
using Polly;

namespace Surakuma.Infrastructure;

public static class HttpResilience
{
    public static IHttpClientBuilder AddSurakumaResilience(this IHttpClientBuilder client, bool email = false, TimeSpan? attemptTimeout = null, TimeSpan? retryDelay = null)
    {
        client.AddStandardResilienceHandler(options =>
        {
            options.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(20);
            options.AttemptTimeout.Timeout = attemptTimeout ?? TimeSpan.FromSeconds(5);
            options.Retry.MaxRetryAttempts = 2;
            options.Retry.Delay = retryDelay ?? TimeSpan.FromMilliseconds(250);
            options.Retry.BackoffType = DelayBackoffType.Exponential;
            options.Retry.UseJitter = false;
            options.CircuitBreaker.MinimumThroughput = 4;
            options.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(20);
            options.CircuitBreaker.BreakDuration = TimeSpan.FromSeconds(15);
            options.CircuitBreaker.FailureRatio = 0.5;
            // A 429 explicitly rejects a send. Timeouts and 5xx responses may have sent it.
            if (email)
                options.Retry.ShouldHandle = args => ValueTask.FromResult(args.Outcome.Result?.StatusCode == HttpStatusCode.TooManyRequests);
        });
        return client;
    }
}
