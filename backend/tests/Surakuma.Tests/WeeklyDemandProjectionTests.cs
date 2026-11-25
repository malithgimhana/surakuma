using Surakuma.Application;
using Surakuma.Domain;

namespace Surakuma.Tests;

public sealed class WeeklyDemandProjectionTests
{
    [Fact]
    public void StableDemandUsesFullHistoryAndReportsHeldOutErrors()
    {
        var result = WeeklyDemandProjection.Calculate([4, 4, 4, 4, 4, 4, 4, 4]);
        Assert.Equal(WeeklyDemandProjection.Baseline, result.Method);
        Assert.Equal(4, result.Estimate);
        Assert.Equal(4, result.Lower);
        Assert.Equal(4, result.Upper);
        Assert.Equal(5, result.ValidationPeriods);
        Assert.Equal(0, result.ValidationMae);
    }

    [Fact]
    public void DemandIncreaseSelectsRecentHistoryWhenItImprovesPastPredictions()
    {
        var result = WeeklyDemandProjection.Calculate([2, 3, 4, 6, 14, 17, 19, 21]);
        Assert.Equal(WeeklyDemandProjection.Recent, result.Method);
        Assert.Equal(17.75m, result.Estimate);
        Assert.True(result.ValidationMae < result.BaselineMae);
        Assert.InRange(result.Estimate, result.Lower, result.Upper);
    }

    [Fact]
    public void ExplicitEmergencyAndRulesHaveBoundedExplainableScores()
    {
        var request = new AssistanceRequest { Priority = Priority.Critical };
        var emergency = RequestSignals.Urgency(request, AidCategory.Other, []);
        Assert.Equal((100, Priority.Critical), (emergency.Score, emergency.Priority));
        request.Priority = Priority.High;
        var urgent = RequestSignals.Urgency(request, AidCategory.Medical,
            ["essential supply interruption", "step-free access", "infant supplies"]);
        Assert.Equal((89, Priority.High), (urgent.Score, urgent.Priority));
        Assert.Contains(urgent.Factors, factor => factor.Label == "Accessibility need" && factor.Points == 10);
    }
}
