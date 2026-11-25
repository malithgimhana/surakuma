using Surakuma.Domain;

namespace Surakuma.Application;

public sealed class ShelterOperationalPolicy(int staleAfterHours)
{
    public DateTimeOffset ReviewCutoff => DateTimeOffset.UtcNow.AddHours(-Math.Clamp(staleAfterHours, 1, 87600));

    public static bool IsCurrent(Shelter shelter, DateTimeOffset cutoff) =>
        (shelter.OperationalUpdatedAt ?? shelter.UpdatedAt) >= cutoff;

    public bool AcceptsPlacements(Shelter shelter) =>
        shelter.Open && !shelter.PendingVerification && shelter.Available > 0 && IsCurrent(shelter, ReviewCutoff);
}
