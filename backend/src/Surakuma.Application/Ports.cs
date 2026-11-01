using Surakuma.Domain;

namespace Surakuma.Application;

public interface IStore
{
    IQueryable<T> Query<T>() where T : Record;
    Task<List<T>> ListAsync<T>(IQueryable<T> query, CancellationToken ct = default);
    Task<T?> FindAsync<T>(Guid id, CancellationToken ct = default) where T : Record;
    void Add<T>(T entity) where T : Record;
    Task SaveAsync(CancellationToken ct = default);
    Task<T> TransactionAsync<T>(Func<Task<T>> operation, CancellationToken ct = default);
}
public interface ICurrentActor
{
    string Id
    {
        get;
    }
}
public sealed class MissingException() : Exception("The record was not found.");
public sealed class AccessDeniedException() : Exception("You do not have permission for this action.");
public sealed record Page<T>(List<T> Items, int Total, int PageNumber, int PageSize);

public sealed class AccessService(IStore store, ICurrentActor actor)
{
    public string UserId => actor.Id;
    public Task<List<Membership>> Memberships(CancellationToken ct = default) => store.ListAsync(store.Query<Membership>().Where(x => x.UserId == actor.Id), ct);
    public async Task<bool> IsAdmin(CancellationToken ct = default) => (await Memberships(ct)).Any(x => x.Role == Roles.Administrator);
    public async Task RequireOrg(Guid organisationId, string[] roles, CancellationToken ct = default)
    {
        if (!(await Memberships(ct)).Any(x => x.OrganisationId == organisationId && roles.Contains(x.Role)))
            throw new AccessDeniedException();
    }
    public async Task<bool> Coordinates(Guid crisisId, CancellationToken ct = default)
    {
        if (!(await Memberships(ct)).Any(x => x.Role == Roles.Coordinator))
            return false;
        return (await store.ListAsync(store.Query<CrisisAssignment>().Where(x => x.UserId == actor.Id && x.CrisisId == crisisId), ct)).Count > 0;
    }
    public async Task<IQueryable<AssistanceRequest>> Visible(CancellationToken ct = default)
    {
        var memberships = await Memberships(ct);
        var orgIds = memberships.Where(x => x.Role is not Roles.Citizen and not Roles.Volunteer and not Roles.Administrator).Select(x => x.OrganisationId).ToArray();
        var assigned = memberships.Any(x => x.Role == Roles.Coordinator)
            ? (await store.ListAsync(store.Query<CrisisAssignment>().Where(x => x.UserId == actor.Id), ct)).Select(x => x.CrisisId).ToArray() : [];
        var shared = store.Query<CaseShare>().Where(x => orgIds.Contains(x.OrganisationId)).Select(x => x.RequestId);
        return store.Query<AssistanceRequest>().Where(x => x.CitizenId == actor.Id || orgIds.Contains(x.OrganisationId) || assigned.Contains(x.CrisisId) || shared.Contains(x.Id));
    }
    public async Task<AssistanceRequest> Request(Guid id, string[]? roles = null, CancellationToken ct = default)
    {
        var r = (await store.ListAsync((await Visible(ct)).Where(x => x.Id == id), ct)).SingleOrDefault() ?? throw new MissingException();
        if (roles is null)
            return r;
        var memberships = await Memberships(ct);
        var orgs = memberships.Where(x => roles.Contains(x.Role)).Select(x => x.OrganisationId).ToArray();
        bool shared = (await store.ListAsync(store.Query<CaseShare>().Where(x => x.RequestId == id && orgs.Contains(x.OrganisationId)), ct)).Count > 0;
        if (!orgs.Contains(r.OrganisationId) && !shared && !(roles.Contains(Roles.Coordinator) && await Coordinates(r.CrisisId, ct)))
            throw new AccessDeniedException();
        return r;
    }
}
