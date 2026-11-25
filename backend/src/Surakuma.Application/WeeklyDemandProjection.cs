namespace Surakuma.Application;

public sealed record Projection(decimal Estimate, decimal Lower, decimal Upper, string Method,
    decimal ValidationMae, decimal BaselineMae, int ValidationPeriods);

public static class WeeklyDemandProjection
{
    public const string Baseline = "weekly-request-and-unit-mean-v2";
    public const string Recent = "recent-four-week-mean-v1";

    public static Projection Calculate(IReadOnlyList<decimal> observations)
    {
        // Predict each held-out observation using only earlier observations.
        var baseline = Errors(int.MaxValue);
        var recent = Errors(4);
        var actualBaseline = baseline.Select(Math.Abs).Average();
        var actualRecent = recent.Select(Math.Abs).Average();
        var useRecent = actualRecent < actualBaseline * 0.9m;
        var errors = useRecent ? recent : baseline;
        var estimate = observations.TakeLast(useRecent ? 4 : observations.Count).Average();
        // An empirical error band from short rolling-origin validation. It is not a coverage guarantee.
        var ordered = errors.Select(Math.Abs).Order().ToArray();
        var radius = ordered[Math.Max(0, (int)Math.Ceiling(0.8 * ordered.Length) - 1)];
        return new(decimal.Round(estimate, 2), decimal.Round(Math.Max(0, estimate - radius), 2),
            decimal.Round(estimate + radius, 2), useRecent ? Recent : Baseline,
            decimal.Round(useRecent ? actualRecent : actualBaseline, 2), decimal.Round(actualBaseline, 2), errors.Length);

        decimal[] Errors(int window) => Enumerable.Range(3, observations.Count - 3)
            .Select(index => observations[index] - observations.Take(index).TakeLast(window).Average()).ToArray();
    }
}
