using Surakuma.Application;
using Surakuma.Domain;

namespace Surakuma.Tests;

public sealed class AllocationStrategyTests
{
    private readonly RankedAllocationStrategy strategy = new();
    private static AssistanceRequest Request(Guid org, Guid crisis, Priority priority, DateTimeOffset created) => new() { OrganisationId = org, CrisisId = crisis, Category = AidCategory.FoodWater, Status = RequestStatus.Approved, Priority = priority, Quantity = 10, Description = "family food packs", Latitude = 6.9, Longitude = 79.9, CreatedAt = created };
    private static Resource Stock(Guid org, string name, decimal count, double longitude = 79.9) => new() { OrganisationId = org, Category = AidCategory.FoodWater, Name = name, Suitability = "family food packs", Unit = "packs", Stock = count, Latitude = 6.9, Longitude = longitude, TransportAvailable = true };
    [Fact]
    public void UnapprovedRequestDoesNotClaimThereIsNoShortage()
    {
        var org = Guid.NewGuid(); var req = Request(org, Guid.NewGuid(), Priority.Normal, DateTimeOffset.UtcNow);
        req.Status = RequestStatus.Submitted;
        var result = strategy.Recommend(req, 0, [Stock(org, "limited", 6)], []);
        Assert.Contains("not in the approved allocation queue", result.ShortageExplanation);
        Assert.DoesNotContain("No shortage", result.ShortageExplanation);
    }
    [Fact]
    public void RankingUsesAvailabilitySuitabilityDistanceAndHardCategory()
    {
        var org = Guid.NewGuid(); var req = Request(org, Guid.NewGuid(), Priority.High, DateTimeOffset.UtcNow);
        var near = Stock(org, "near", 10); var far = Stock(org, "far", 10, 81);
        var wrong = Stock(org, "wrong", 100); wrong.Category = AidCategory.Medical;
        var result = strategy.Recommend(req, 0, [far, wrong, near], [new(req, 0, req.CreatedAt)]);
        Assert.Equal(new[] { near.Id, far.Id }, result.Candidates.Select(x => x.ResourceId));
        Assert.Contains("straight-line", result.Candidates[0].Reason);
    }
    [Fact]
    public void PartialStockIsRankedAndAlternativeIsReturnedWithoutReserving()
    {
        var org = Guid.NewGuid(); var req = Request(org, Guid.NewGuid(), Priority.Critical, DateTimeOffset.UtcNow);
        var a = Stock(org, "first", 7); var b = Stock(org, "second", 4); var none = Stock(org, "empty", 0);
        var result = strategy.Recommend(req, 0, [b, a, none], [new(req, 0, req.CreatedAt)]);
        Assert.Equal(new[] { a.Id, b.Id }, result.Candidates.Select(x => x.ResourceId));
        Assert.True(result.Candidates[0].ShortForRequest); Assert.True(result.Shortage);
        Assert.Equal(7, result.Candidates[0].SuggestedQuantity); Assert.Equal(0, a.Reserved);
    }
    [Fact]
    public void CompetitionOrdersPriorityThenApprovalWaitThenCreationAndStableId()
    {
        var org = Guid.NewGuid(); var crisis = Guid.NewGuid(); var now = DateTimeOffset.UtcNow;
        var high = Request(org, crisis, Priority.Critical, now.AddHours(-1));
        var low = Request(org, crisis, Priority.High, now.AddDays(-3));
        var older = Request(org, crisis, Priority.Critical, now.AddHours(-2));
        var tie = Request(org, crisis, Priority.Critical, now.AddHours(-3));
        var demands = new[] { new AllocationDemand(high, 0, now.AddMinutes(-20)), new AllocationDemand(low, 0, now.AddDays(-3)), new AllocationDemand(older, 0, now.AddMinutes(-20)), new AllocationDemand(tie, 0, now.AddMinutes(-40)) };
        var result = strategy.Recommend(older, 0, [Stock(org, "limited", 5)], demands);
        Assert.True(result.Shortage); Assert.Equal(2, result.QueuePosition); Assert.Equal(4, result.CompetingRequests);
        Assert.Contains("escalate", result.ShortageExplanation, StringComparison.OrdinalIgnoreCase);
    }
    [Fact]
    public void EqualScoresUseResourceIdAndUnavailableTransportIsLast()
    {
        var org = Guid.NewGuid(); var req = Request(org, Guid.NewGuid(), Priority.High, DateTimeOffset.UtcNow);
        var a = Stock(org, "same", 10); var b = Stock(org, "same", 10); var blocked = Stock(org, "same", 10); blocked.TransportAvailable = false;
        var result = strategy.Recommend(req, 0, [blocked, b, a], [new(req, 0, req.CreatedAt)]);
        Assert.Equal(new[] { a.Id, b.Id }.OrderBy(x => x), result.Candidates.Take(2).Select(x => x.ResourceId));
        Assert.False(result.Candidates.Last().TransportAvailable);
    }
}
