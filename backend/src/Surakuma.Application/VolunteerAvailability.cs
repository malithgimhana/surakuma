using Surakuma.Domain;

namespace Surakuma.Application;

public sealed record AvailabilityWindowInput(DateTimeOffset StartsAt, DateTimeOffset EndsAt);
public sealed record AvailabilityWindowView(Guid Id, DateTimeOffset StartsAt, DateTimeOffset EndsAt);

public sealed class VolunteerAvailability(IStore store, AccessService access)
{
    private IQueryable<VolunteerAvailabilityWindow> Own => store.Query<VolunteerAvailabilityWindow>()
        .Where(w => w.UserId == access.UserId);

    public async Task<IReadOnlyList<AvailabilityWindowView>> List(CancellationToken ct) =>
        await store.ListAsync(Own.Where(w => w.EndsAt > DateTimeOffset.UtcNow).OrderBy(w => w.StartsAt)
            .Select(w => new AvailabilityWindowView(w.Id, w.StartsAt, w.EndsAt)), ct);

    public Task<VolunteerAvailabilityWindow> Add(AvailabilityWindowInput input, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var now = DateTimeOffset.UtcNow;
        if (input.EndsAt <= now || input.EndsAt <= input.StartsAt || input.EndsAt > now.AddYears(1))
            throw new RuleException("Choose a valid time window ending within the next year.");
        var existing = await store.ListAsync(Own.Where(w => w.EndsAt > now), ct);
        if (existing.FirstOrDefault(w => w.StartsAt == input.StartsAt && w.EndsAt == input.EndsAt) is { } retry)
            return retry;
        if (existing.Count >= 30) throw new RuleException("Enter up to 30 upcoming availability windows.");
        if (existing.Any(w => w.StartsAt < input.EndsAt && w.EndsAt > input.StartsAt))
            throw new RuleException("Availability windows cannot overlap.");
        var window = new VolunteerAvailabilityWindow { UserId = access.UserId, StartsAt = input.StartsAt.ToUniversalTime(),
            EndsAt = input.EndsAt.ToUniversalTime() };
        store.Add(window);
        return window;
    }, ct);

    public Task<bool> Remove(Guid id, CancellationToken ct) => store.TransactionAsync(async () =>
    {
        var match = (await store.ListAsync(Own.Where(w => w.Id == id), ct)).SingleOrDefault();
        if (match is not null) store.Remove(match);
        return true;
    }, ct);

    public static bool Covers(IEnumerable<VolunteerAvailabilityWindow> windows, DateTimeOffset start, DateTimeOffset end)
    {
        var ordered = windows.OrderBy(w => w.StartsAt).ToArray();
        if (ordered.Length == 0) return true;
        foreach (var window in ordered)
        {
            if (window.StartsAt > start) return false;
            if (window.EndsAt >= end) return true;
            if (window.EndsAt > start) start = window.EndsAt;
        }
        return false;
    }
}
