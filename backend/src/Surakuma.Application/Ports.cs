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
    Task<T> RoutingTransactionAsync<T>(Func<Task<T>> operation, CancellationToken ct = default);
}
public interface ICurrentActor
{
    string? SelectedCountry => null;
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
    public string? SelectedCountry => actor.SelectedCountry;
    public Task<List<Membership>> Memberships(CancellationToken ct = default) => store.ListAsync(store.Query<Membership>().Where(x => x.UserId == actor.Id), ct);
    public async Task<bool> IsAdmin(CancellationToken ct = default) => (await Memberships(ct)).Any(x => x.Role == Roles.Administrator);
    public async Task RequireOrg(Guid organisationId, string[] roles, CancellationToken ct = default)
    {
        if (!(await Memberships(ct)).Any(x => x.OrganisationId == organisationId && roles.Contains(x.Role)))
            throw new AccessDeniedException();
    }
    public async Task<bool> CountryAccess(string country, string[] roles, CancellationToken ct = default)
        => await IsAdmin(ct) || (await Memberships(ct)).Any(x => x.CountryCode == country && x.CrisisId == null && (roles.Contains(x.Role) || x.Role == Roles.CountryAdministrator));
    public async Task<bool> CrisisAccess(Guid crisisId, string[]? roles = null, Guid? organisationId = null, CancellationToken ct = default)
    {
        if (await IsAdmin(ct)) return true;
        var crisis = await store.FindAsync<Crisis>(crisisId, ct) ?? throw new MissingException();
        return (await Memberships(ct)).Any(x => x.CountryCode == crisis.CountryCode &&
            (!x.CrisisId.HasValue || x.CrisisId == crisisId) &&
            (x.Role == Roles.CountryAdministrator || ((roles == null ? x.Role != Roles.Citizen && x.Role != Roles.Volunteer : roles.Contains(x.Role)) &&
            (!organisationId.HasValue || x.OrganisationId == organisationId))));
    }
    public async Task RequireLocation(Guid organisationId, string country, string[] roles, CancellationToken ct, Guid? crisisId = null)
    {
        if (!await IsAdmin(ct) && !(await Memberships(ct)).Any(x => x.CountryCode == country && (x.CrisisId == null || (crisisId.HasValue && x.CrisisId == crisisId)) && ((x.OrganisationId == organisationId && roles.Contains(x.Role)) || x.Role == Roles.CountryAdministrator)))
            throw new AccessDeniedException();
    }
    public async Task<IQueryable<T>> Located<T>(CancellationToken ct, Guid? crisisId = null) where T : Record
    {
        bool global = await IsAdmin(ct);
        var grants = store.Query<Membership>().Where(m => m.UserId == actor.Id && m.Role != Roles.Citizen && m.Role != Roles.Volunteer && (m.CrisisId == null || (crisisId.HasValue && m.CrisisId == crisisId)));
        if (typeof(T) == typeof(Resource)) return (IQueryable<T>)store.Query<Resource>().Where(r => actor.SelectedCountry == null || r.CountryCode == actor.SelectedCountry).Where(r => global || grants.Any(m => m.CountryCode == r.CountryCode && (m.Role == Roles.CountryAdministrator || m.OrganisationId == r.OrganisationId)));
        if (typeof(T) == typeof(Shelter)) return (IQueryable<T>)store.Query<Shelter>().Where(r => actor.SelectedCountry == null || r.CountryCode == actor.SelectedCountry).Where(r => global || grants.Any(m => m.CountryCode == r.CountryCode && (m.Role == Roles.CountryAdministrator || m.OrganisationId == r.OrganisationId)));
        throw new InvalidOperationException("Unsupported location type.");
    }
    public async Task<bool> Coordinates(Guid crisisId, CancellationToken ct = default)
    {
        if (!await CrisisAccess(crisisId, [Roles.Coordinator], ct: ct)) return false;
        if (await IsAdmin(ct) || (await Memberships(ct)).Any(x => x.Role == Roles.CountryAdministrator && x.CountryCode == (store.Query<Crisis>().Where(c => c.Id == crisisId).Select(c => c.CountryCode).First()))) return true;
        return (await store.ListAsync(store.Query<CrisisAssignment>().Where(x => x.UserId == actor.Id && x.CrisisId == crisisId), ct)).Count > 0;
    }
    public async Task<IQueryable<AssistanceRequest>> Visible(CancellationToken ct = default)
    {
        if (await IsAdmin(ct)) return store.Query<AssistanceRequest>().Where(r => actor.SelectedCountry == null || store.Query<Crisis>().Any(c => c.Id == r.CrisisId && c.CountryCode == actor.SelectedCountry));
        var grants = store.Query<Membership>().Where(x => x.UserId == actor.Id && x.Role != Roles.Citizen && x.Role != Roles.Volunteer);
        var crises = store.Query<Crisis>();
        var assignments = store.Query<CrisisAssignment>().Where(x => x.UserId == actor.Id);
        return store.Query<AssistanceRequest>().Where(r => actor.SelectedCountry == null || crises.Any(c => c.Id == r.CrisisId && c.CountryCode == actor.SelectedCountry)).Where(r => r.CitizenId == actor.Id || grants.Any(m =>
            crises.Any(c => c.Id == r.CrisisId && c.CountryCode == m.CountryCode) && (!m.CrisisId.HasValue || m.CrisisId == r.CrisisId) &&
            (m.Role == Roles.CountryAdministrator || m.OrganisationId == r.OrganisationId || (m.Role == Roles.Coordinator && assignments.Any(a => a.CrisisId == r.CrisisId)))));
    }
    public async Task<AssistanceRequest> Request(Guid id, string[]? roles = null, CancellationToken ct = default)
    {
        var r = (await store.ListAsync((await Visible(ct)).Where(x => x.Id == id), ct)).SingleOrDefault() ?? throw new MissingException();
        if (roles is null)
            return r;
        if (!r.OrganisationId.HasValue && !await IsAdmin(ct) && !await Coordinates(r.CrisisId, ct))
            throw new AccessDeniedException();
        if (!await CrisisAccess(r.CrisisId, roles, r.OrganisationId, ct) && !(roles.Contains(Roles.Coordinator) && await Coordinates(r.CrisisId, ct)))
            throw new AccessDeniedException();
        return r;
    }
}
