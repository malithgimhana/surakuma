namespace Surakuma.Application;

public static class AiDecisionMetrics
{
    // Preserve the existing denominator, including deferrals.
    public static double OverrideFrequency(int modified, int rejected, int total) =>
        total == 0 ? 0 : (double)(modified + rejected) / total;
}
