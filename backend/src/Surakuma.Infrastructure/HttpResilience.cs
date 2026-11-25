using System.Net;
using Microsoft.Extensions.DependencyInjection;
using Polly;

namespace Surakuma.Infrastructure;

public static class HttpResilience
{
    public static IHttpClientBuilder AddSurakumaResilience(this IHttpClientBuilder client, bool email = false, TimeSpan? attemptTimeout = null,
        TimeSpan? retryDelay = null, bool ai = false, int? retries = null, TimeSpan? breakDuration = null)
    {
        client.AddStandardResilienceHandler(options =>
        {
            // Generating AI content can take longer than mapping or email requests.
            options.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(ai ? 65 : 20);
            options.AttemptTimeout.Timeout = attemptTimeout ?? TimeSpan.FromSeconds(ai ? 30 : 5);
            options.Retry.MaxRetryAttempts = Math.Max(1, retries ?? (ai ? 1 : 2));
            options.Retry.Delay = retryDelay ?? TimeSpan.FromMilliseconds(250);
            options.Retry.BackoffType = DelayBackoffType.Exponential;
            options.Retry.UseJitter = false;
            options.CircuitBreaker.MinimumThroughput = 4;
            options.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(ai ? 60 : 20);
            options.CircuitBreaker.BreakDuration = breakDuration ?? TimeSpan.FromSeconds(15);
            options.CircuitBreaker.FailureRatio = 0.5;
            // A 429 explicitly rejects a send. Timeouts and 5xx responses may have sent it.
            if (email)
                options.Retry.ShouldHandle = args => ValueTask.FromResult(args.Outcome.Result?.StatusCode == HttpStatusCode.TooManyRequests);
            else if (ai)
                options.Retry.ShouldHandle = args => ValueTask.FromResult(retries != 0 &&
                    (args.Outcome.Exception is HttpRequestException or Polly.Timeout.TimeoutRejectedException ||
                    args.Outcome.Result is { StatusCode: HttpStatusCode.RequestTimeout or >= HttpStatusCode.InternalServerError }));
        });
        return client;
    }
}
