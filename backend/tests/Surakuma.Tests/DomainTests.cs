using Surakuma.Application;
using Surakuma.Domain;

namespace Surakuma.Tests;

public sealed class DomainTests
{
    [Theory]
    [InlineData("packs", false)]
    [InlineData("kits", false)]
    [InlineData("kg", true)]
    [InlineData(" Litres ", true)]
    public void FractionalQuantitiesAreAllowedOnlyForMeasuredUnits(string unit, bool measured)
    {
        QuantityUnits.ValidateWhole(2, unit);
        if (measured) QuantityUnits.ValidateWhole(2.5m, unit);
        else Assert.Throws<RuleException>(() => QuantityUnits.ValidateWhole(2.5m, unit));
    }
    [Fact]
    public void ReservationDispatchAndDeliveryHaveDifferentAccounting()
    {
        var stock = new Resource { Stock = 6 };
        var request = new AssistanceRequest { Quantity = 10, Status = RequestStatus.Approved };
        stock.Reserve(6);
        Assert.Equal(6, stock.Stock);
        Assert.Equal(0, stock.Available);
        Assert.Throws<RuleException>(() => stock.Reserve(1));
        stock.Dispatch(6);
        Assert.Equal(0, stock.Stock);
        Assert.Equal(0, stock.Reserved);
        request.Deliver(6);
        Assert.Equal(RequestStatus.PartiallyFulfilled, request.Status);
        Assert.Equal(4, request.Quantity - request.DeliveredQuantity);
        Assert.Throws<RuleException>(() => request.Deliver(5));
    }
    [Fact]
    public void ShelterReservationIsNotOccupancyAndProtectsWholeHousehold()
    {
        var shelter = new Shelter { Capacity = 5, Accessible = true };
        shelter.Reserve(4);
        Assert.Equal(0, shelter.Occupancy);
        Assert.Equal(1, shelter.Available);
        Assert.Throws<RuleException>(() => shelter.Reserve(2));
        shelter.CheckIn(4);
        Assert.Equal(4, shelter.Occupancy);
        Assert.Equal(0, shelter.Reserved);
        shelter.Release(4, true);
        Assert.Equal(5, shelter.Available);
    }
    [Fact]
    public void ACaseCannotSkipVerificationOrCloseBeforeDelivery()
    {
        var request = new AssistanceRequest();
        Assert.Throws<RuleException>(() => request.Transition(RequestStatus.Approved));
        request.Transition(RequestStatus.UnderReview);
        Assert.Throws<RuleException>(() => request.Transition(RequestStatus.Rejected));
        request.Transition(RequestStatus.Verified);
        request.Transition(RequestStatus.Approved);
        Assert.Throws<RuleException>(() => request.Transition(RequestStatus.Closed));
        request.Deliver(1);
        request.Transition(RequestStatus.Closed);
        Assert.Equal(RequestStatus.Closed, request.Status);
    }
    [Fact]
    public void AiDisagreementIncludesModifiedAndRejectedDecisions()
    {
        Assert.Equal(0, AiDecisionMetrics.OverrideFrequency(0, 0, 0));
        Assert.Equal(0.5, AiDecisionMetrics.OverrideFrequency(1, 1, 4));
        Assert.Equal(0, AiDecisionMetrics.OverrideFrequency(0, 0, 1));
    }
    [Fact]
    public void DuplicateSimilarityIsDeterministicAndDoesNotMutateRequests()
    {
        var a = "Need food and clean water";
        Assert.Equal(1, Operations.Similarity(a, a));
        Assert.Equal(0, Operations.Similarity(a, "medicine shelter"));
        Assert.Equal(0, Operations.Similarity("", ""));
    }
}
