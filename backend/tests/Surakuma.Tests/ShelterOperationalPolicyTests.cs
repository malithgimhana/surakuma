using Surakuma.Application;
using Surakuma.Domain;

namespace Surakuma.Tests;

public sealed class ShelterOperationalPolicyTests
{
    [Fact]
    public void PlacementRequiresCurrentOperationalReportAndFreeCapacity()
    {
        var policy = new ShelterOperationalPolicy(168);
        var shelter = new Shelter { Capacity = 12, Occupancy = 7, Reserved = 3 };
        Assert.True(policy.AcceptsPlacements(shelter));
        shelter.OperationalUpdatedAt = DateTimeOffset.UtcNow.AddDays(-8);
        Assert.False(policy.AcceptsPlacements(shelter));
        shelter.OperationalUpdatedAt = DateTimeOffset.UtcNow;
        shelter.PendingVerification = true;
        Assert.False(policy.AcceptsPlacements(shelter));
        shelter.PendingVerification = false;
        shelter.Open = false;
        Assert.False(policy.AcceptsPlacements(shelter));
        shelter.Open = true;
        shelter.Reserved = 5;
        Assert.False(policy.AcceptsPlacements(shelter));
    }
}
