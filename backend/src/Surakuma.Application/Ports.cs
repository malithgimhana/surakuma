using Surakuma.Domain;

namespace Surakuma.Application;

public interface IStore
{
    IQueryable<string> ActiveSystemAdministratorIds { get; }
    IQueryable<T> Query<T>() where T : Record;
    Task<List<T>> ListAsync<T>(IQueryable<T> query, CancellationToken ct = default);
    Task<T?> FindAsync<T>(Guid id, CancellationToken ct = default) where T : Record;
    void Add<T>(T entity) where T : Record;
    void Remove<T>(T entity) where T : Record;
    Task SaveAsync(CancellationToken ct = default);
    Task<T> TransactionAsync<T>(Func<Task<T>> operation, CancellationToken ct = default);
    Task<T> RoutingTransactionAsync<T>(Func<Task<T>> operation, CancellationToken ct = default);
    Task<T> FeedbackTransactionAsync<T>(Guid requestId, Func<Task<T>> operation, CancellationToken ct = default);
}
public interface ICurrentActor
{
    string? SelectedCountry => null;
    string? SelectedStaffRole => null;
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
    public async Task<bool> PartnerEligible(Guid id, string country, CancellationToken ct) => (await store.ListAsync(store.Query<OrganisationCountry>().Where(x => x.OrganisationId == id && x.CountryCode == country && (x.VerificationState == "Verified" || x.VerificationState == "LegacyActive")), ct)).Count > 0;
    public async Task RequirePartner(Guid id, string country, CancellationToken ct) { if (!await PartnerEligible(id, country, ct)) throw new RuleException("This partner needs verification in this country before receiving new work."); }
    public string UserId => actor.Id;
    public string? SelectedCountry => actor.SelectedCountry;
    public bool IsCoordinatorWorkspace => actor.SelectedStaffRole == Roles.Coordinator;
    public async Task<string> CoordinatorCountry(CancellationToken ct)
    {
        var countries = await store.ListAsync(store.Query<Membership>()
            .Where(m => m.UserId == actor.Id && m.Role == Roles.Coordinator)
            .Select(m => m.CountryCode).Distinct().OrderBy(code => code), ct);
        var country = SelectedCountry ?? countries.FirstOrDefault();
        return country != null && countries.Contains(country) ? country : throw new AccessDeniedException();
    }
    public bool IsVolunteerWorkspace => actor.SelectedStaffRole == Roles.VolunteerCoordinator;
    public async Task<string> VolunteerWorkspaceCountry(CancellationToken ct)
    {
        var grants = (await Memberships(ct)).Where(m => m.Role == Roles.VolunteerCoordinator && m.OrganisationId != null);
        var countries = grants.Select(m => m.CountryCode).Distinct().OrderBy(code => code, StringComparer.Ordinal).ToArray();
        var country = SelectedCountry ?? countries.FirstOrDefault();
        return country != null && countries.Contains(country) ? country : throw new AccessDeniedException();
    }
    public bool IsShelterWorkspace => actor.SelectedStaffRole == Roles.ShelterAdmin;
    public async Task<string> ShelterWorkspaceCountry(CancellationToken ct)
    {
        var countries = await store.ListAsync(store.Query<Membership>()
            .Where(m => m.UserId == actor.Id && m.Role == Roles.ShelterAdmin &&
                m.OrganisationId != null && m.CrisisId == null)
            .Select(m => m.CountryCode).Distinct().OrderBy(code => code).Take(2), ct);
        if (countries.Count != 1 || (actor.SelectedCountry != null && actor.SelectedCountry != countries[0]))
            throw new AccessDeniedException();
        return countries[0];
    }
    public bool IsLogisticsWorkspace => actor.SelectedStaffRole == Roles.Logistics;
    public async Task RequireDepot(Resource resource, CancellationToken ct, Guid? crisisId = null,
        bool allowCoordinatorRead = false, bool includeCrisisAssignments = false)
    {
        var grants = await Memberships(ct);
        if (!IsLogisticsWorkspace && (await IsAdmin(ct) || grants.Any(m => m.Role == Roles.CountryAdministrator &&
            m.CountryCode == resource.CountryCode && m.CrisisId == null))) return;
        if (!grants.Any(m => m.CountryCode == resource.CountryCode && m.OrganisationId == resource.OrganisationId &&
            (m.CrisisId == null || m.CrisisId == crisisId || (includeCrisisAssignments && m.Role == Roles.Logistics)) &&
            (m.Role == Roles.Logistics || allowCoordinatorRead && !IsLogisticsWorkspace && m.Role == Roles.Coordinator) &&
            (m.DepotId == null || m.DepotId == resource.DepotId)))
            throw new AccessDeniedException();
    }
    public Task<List<Membership>> Memberships(CancellationToken ct = default) => store.ListAsync(store.Query<Membership>().Where(x => x.UserId == actor.Id), ct);
    public async Task<string> CaseManagerCountry(CancellationToken ct)
    {
        var countries = await store.ListAsync(store.Query<Membership>()
            .Where(m => m.UserId == actor.Id && m.Role == Roles.CaseManager)
            .Select(m => m.CountryCode).Distinct().OrderBy(code => code).Take(2), ct);
        if (countries.Count == 0) throw new AccessDeniedException();
        if (countries.Count != 1 || string.IsNullOrWhiteSpace(countries[0]))
            throw new RuleException("Case Managers need one assigned country. Contact an administrator to correct your assignments.");
        return countries[0];
    }
    public async Task<string> LogisticsCountry(CancellationToken ct)
    {
        var countries = await store.ListAsync(store.Query<Membership>()
            .Where(m => m.UserId == actor.Id && m.Role == Roles.Logistics && m.OrganisationId != null)
            .Select(m => m.CountryCode).Distinct().OrderBy(code => code).Take(2), ct);
        if (countries.Count != 1 || (actor.SelectedCountry != null && actor.SelectedCountry != countries[0]))
            throw new AccessDeniedException();
        return countries[0];
    }
    public async Task<bool> IsAdmin(CancellationToken ct = default)
        => (await store.ListAsync(store.ActiveSystemAdministratorIds.Where(id => id == actor.Id), ct)).Count > 0;
    public async Task RequireOrg(Guid organisationId, string[] roles, CancellationToken ct = default)
    {
        if (!await IsAdmin(ct) && !(await Memberships(ct)).Any(x => x.OrganisationId == organisationId && roles.Contains(x.Role)))
            throw new AccessDeniedException();
    }
    public async Task<bool> CountryAccess(string country, string[] roles, CancellationToken ct = default)
        => await IsAdmin(ct) || (await Memberships(ct)).Any(x => x.CountryCode == country && x.CrisisId == null && (roles.Contains(x.Role) || x.Role == Roles.CountryAdministrator));
    public IQueryable<Membership> AssignedCoordinatorGrants(string country)
    {
        var assignments = store.Query<CrisisAssignment>().Where(a => a.UserId == actor.Id);
        var crises = store.Query<Crisis>().Where(c => c.CountryCode == country);
        return store.Query<Membership>().Where(m => m.UserId == actor.Id && m.Role == Roles.Coordinator &&
            m.CountryCode == country && m.CrisisId != null && m.OrganisationId != null &&
            assignments.Any(a => a.CrisisId == m.CrisisId && crises.Any(c => c.Id == a.CrisisId)));
    }
    public IQueryable<Crisis> CoordinatorCrises(string country)
    {
        var grants = store.Query<Membership>().Where(m => m.UserId == actor.Id && m.Role == Roles.Coordinator &&
            m.CountryCode == country);
        var assignments = store.Query<CrisisAssignment>().Where(a => a.UserId == actor.Id);
        return store.Query<Crisis>().Where(c => c.CountryCode == country && assignments.Any(a => a.CrisisId == c.Id) &&
            grants.Any(m => m.CrisisId == null || m.CrisisId == c.Id));
    }
    public IQueryable<Membership> CoordinatorOrganisationGrants(string country) =>
        store.Query<Membership>().Where(m => m.UserId == actor.Id && m.Role == Roles.Coordinator &&
            m.CountryCode == country && m.CrisisId == null && m.OrganisationId != null)
        .Union(AssignedCoordinatorGrants(country));

    public IQueryable<Resource> CoordinatorInventory(string country)
    {
        var grants = CoordinatorOrganisationGrants(country);
        return store.Query<Resource>().Where(r => r.CountryCode == country && grants.Any(m =>
            m.OrganisationId == r.OrganisationId && (m.DepotId == null || m.DepotId == r.DepotId)));
    }
    public async Task<bool> CrisisAccess(Guid crisisId, string[]? roles = null, Guid? organisationId = null, CancellationToken ct = default)
    {
        if (await IsAdmin(ct)) return true;
        var crisis = await store.FindAsync<Crisis>(crisisId, ct) ?? throw new MissingException();
        return (await Memberships(ct)).Any(x => x.CountryCode == crisis.CountryCode &&
            (!x.CrisisId.HasValue || x.CrisisId == crisisId) &&
            (x.Role == Roles.CountryAdministrator || ((roles == null ? x.Role != Roles.Citizen && x.Role != Roles.Volunteer && x.Role != Roles.Partner && x.Role != Roles.FundingOfficer : roles.Contains(x.Role)) &&
            (!organisationId.HasValue || x.OrganisationId == organisationId))));
    }
    public async Task RequireLocation(Guid organisationId, string country, string[] roles, CancellationToken ct,
        Guid? crisisId = null, bool includeCrisisAssignments = false)
    {
        if (IsCoordinatorWorkspace)
        {
            if (!roles.Contains(Roles.Coordinator) || country != await CoordinatorCountry(ct) ||
                !(await Memberships(ct)).Any(m => m.Role == Roles.Coordinator && m.OrganisationId == organisationId &&
                    m.CountryCode == country && (m.CrisisId == null || m.CrisisId == crisisId)))
                throw new AccessDeniedException();
            return;
        }
        if (IsVolunteerWorkspace)
        {
            if (!roles.Contains(Roles.VolunteerCoordinator) || country != await VolunteerWorkspaceCountry(ct) ||
                !(await Memberships(ct)).Any(m => m.Role == Roles.VolunteerCoordinator && m.OrganisationId == organisationId &&
                    m.CountryCode == country && (m.CrisisId == null || m.CrisisId == crisisId)))
                throw new AccessDeniedException();
            return;
        }
        if (IsShelterWorkspace)
        {
            if (!roles.Contains(Roles.ShelterAdmin) || country != await ShelterWorkspaceCountry(ct) ||
                !(await Memberships(ct)).Any(m => m.Role == Roles.ShelterAdmin && m.OrganisationId == organisationId &&
                    m.CountryCode == country && m.CrisisId == null))
                throw new AccessDeniedException();
            return;
        }
        if (IsLogisticsWorkspace)
        {
            if (!roles.Contains(Roles.Logistics) || country != await LogisticsCountry(ct) ||
                !(await Memberships(ct)).Any(m => m.Role == Roles.Logistics && m.OrganisationId == organisationId &&
                    m.CountryCode == country && (m.CrisisId == null || m.CrisisId == crisisId || includeCrisisAssignments)))
                throw new AccessDeniedException();
            return;
        }
        if (!string.IsNullOrEmpty(actor.SelectedCountry) && actor.SelectedCountry != country)
            throw new AccessDeniedException();
        if (!await IsAdmin(ct) && !(await Memberships(ct)).Any(m => m.CountryCode == country &&
            (m.CrisisId == null || m.CrisisId == crisisId || (includeCrisisAssignments && m.Role == Roles.Logistics)) &&
            ((m.OrganisationId == organisationId && roles.Contains(m.Role)) || m.Role == Roles.CountryAdministrator)))
            throw new AccessDeniedException();
    }
    public async Task<IQueryable<T>> Located<T>(CancellationToken ct, Guid? crisisId = null, string[]? roles = null) where T : Record
    {
        if (IsCoordinatorWorkspace)
        {
            if (roles != null && !roles.Contains(Roles.Coordinator)) throw new AccessDeniedException();
            var country = await CoordinatorCountry(ct);
            if (typeof(T) == typeof(Resource)) return (IQueryable<T>)CoordinatorInventory(country);
            if (typeof(T) == typeof(Shelter))
            {
                var coordinatorGrants = CoordinatorOrganisationGrants(country);
                return (IQueryable<T>)store.Query<Shelter>().Where(s => s.CountryCode == country &&
                    coordinatorGrants.Any(m => m.OrganisationId == s.OrganisationId));
            }
            throw new AccessDeniedException();
        }
        if (IsLogisticsWorkspace)
        {
            var country = await LogisticsCountry(ct);
            var logisticsGrants = store.Query<Membership>().Where(m => m.UserId == actor.Id && m.Role == Roles.Logistics &&
                m.CountryCode == country && (m.CrisisId == null || m.CrisisId == crisisId));
            if (typeof(T) != typeof(Resource) || (roles != null && !roles.Contains(Roles.Logistics))) throw new AccessDeniedException();
            return (IQueryable<T>)store.Query<Resource>().Where(r => r.CountryCode == country &&
                logisticsGrants.Any(m => m.OrganisationId == r.OrganisationId && (m.DepotId == null || m.DepotId == r.DepotId)));
        }
        if (IsShelterWorkspace)
        {
            var country = await ShelterWorkspaceCountry(ct);
            var shelterGrants = store.Query<Membership>().Where(m => m.UserId == actor.Id && m.Role == Roles.ShelterAdmin &&
                m.CountryCode == country && m.CrisisId == null);
            if (typeof(T) != typeof(Shelter) || (roles != null && !roles.Contains(Roles.ShelterAdmin))) throw new AccessDeniedException();
            return (IQueryable<T>)store.Query<Shelter>().Where(s => s.CountryCode == country &&
                shelterGrants.Any(m => m.OrganisationId == s.OrganisationId));
        }
        bool global = await IsAdmin(ct);
        var grants = store.Query<Membership>().Where(m => m.UserId == actor.Id && m.Role != Roles.Citizen && m.Role != Roles.Volunteer && m.Role != Roles.Partner && m.Role != Roles.FundingOfficer && (m.CrisisId == null || (crisisId.HasValue && m.CrisisId == crisisId)));
        if (roles != null) grants = grants.Where(m => roles.Contains(m.Role) || m.Role == Roles.CountryAdministrator);
        if (typeof(T) == typeof(Resource)) return (IQueryable<T>)store.Query<Resource>().Where(r => actor.SelectedCountry == null || r.CountryCode == actor.SelectedCountry).Where(r => global || grants.Any(m => m.CountryCode == r.CountryCode && (m.Role == Roles.CountryAdministrator || m.OrganisationId == r.OrganisationId && (m.DepotId == null || m.DepotId == r.DepotId))));
        if (typeof(T) == typeof(Shelter)) return (IQueryable<T>)store.Query<Shelter>().Where(r => actor.SelectedCountry == null || r.CountryCode == actor.SelectedCountry).Where(r => global || grants.Any(m => m.CountryCode == r.CountryCode && (m.Role == Roles.CountryAdministrator || m.OrganisationId == r.OrganisationId)));
        throw new InvalidOperationException("Unsupported location type.");
    }
    public async Task<bool> Coordinates(Guid crisisId, CancellationToken ct = default)
    {
        if (IsCoordinatorWorkspace)
        {
            var crises = CoordinatorCrises(await CoordinatorCountry(ct));
            return (await store.ListAsync(crises.Where(c => c.Id == crisisId).Select(c => c.Id), ct)).Count > 0;
        }
        if (!await CrisisAccess(crisisId, [Roles.Coordinator], ct: ct)) return false;
        if (await IsAdmin(ct) || (await Memberships(ct)).Any(x => x.Role == Roles.CountryAdministrator && x.CountryCode == (store.Query<Crisis>().Where(c => c.Id == crisisId).Select(c => c.CountryCode).First()))) return true;
        return (await store.ListAsync(store.Query<CrisisAssignment>().Where(x => x.UserId == actor.Id && x.CrisisId == crisisId), ct)).Count > 0;
    }
    public async Task<IQueryable<AssistanceRequest>> Visible(CancellationToken ct = default)
    {
        if (IsCoordinatorWorkspace) return await StaffCases(Roles.Coordinator, ct);
        if (IsVolunteerWorkspace) return await StaffCases(Roles.VolunteerCoordinator, ct);
        if (IsShelterWorkspace)
        {
            await ShelterWorkspaceCountry(ct);
            return await StaffCases(Roles.ShelterAdmin, ct);
        }
        if (IsLogisticsWorkspace) return await StaffCases(Roles.Logistics, ct);
        if (actor.SelectedStaffRole == Roles.CaseManager) return await StaffCases(Roles.CaseManager, ct);
        if (await IsAdmin(ct)) return store.Query<AssistanceRequest>().Where(r => actor.SelectedCountry == null || store.Query<Crisis>().Any(c => c.Id == r.CrisisId && c.CountryCode == actor.SelectedCountry));
        var grants = store.Query<Membership>().Where(x => x.UserId == actor.Id && x.Role != Roles.Citizen && x.Role != Roles.Volunteer && x.Role != Roles.Partner && x.Role != Roles.FundingOfficer);
        var crises = store.Query<Crisis>();
        var assignments = store.Query<CrisisAssignment>().Where(x => x.UserId == actor.Id);
        return store.Query<AssistanceRequest>().Where(r => actor.SelectedCountry == null || crises.Any(c => c.Id == r.CrisisId && c.CountryCode == actor.SelectedCountry)).Where(r => r.CitizenId == actor.Id || grants.Any(m =>
            crises.Any(c => c.Id == r.CrisisId && c.CountryCode == m.CountryCode) && (!m.CrisisId.HasValue || m.CrisisId == r.CrisisId) &&
            (m.Role != Roles.CaseManager || !grants.Any(other => other.Role == Roles.CaseManager && other.CountryCode != m.CountryCode)) &&
            (m.Role == Roles.CountryAdministrator || m.OrganisationId == r.OrganisationId || (m.Role == Roles.Coordinator && assignments.Any(a => a.CrisisId == r.CrisisId)))));
    }
    public async Task<IQueryable<AssistanceRequest>> StaffCases(string role, CancellationToken ct)
    {
        var assignedCountry = role == Roles.Coordinator && IsCoordinatorWorkspace ? await CoordinatorCountry(ct) :
            role == Roles.CaseManager ? await CaseManagerCountry(ct) :
            role == Roles.VolunteerCoordinator && IsVolunteerWorkspace ? await VolunteerWorkspaceCountry(ct) :
            role == Roles.Logistics && IsLogisticsWorkspace ? await LogisticsCountry(ct) :
            role == Roles.ShelterAdmin && IsShelterWorkspace ? await ShelterWorkspaceCountry(ct) : null;
        var grants = store.Query<Membership>().Where(m => m.UserId == actor.Id && m.Role == role);
        if ((await store.ListAsync(grants.OrderBy(m => m.Id).Select(m => m.Id).Take(1), ct)).Count == 0)
            throw new AccessDeniedException();
        var crises = store.Query<Crisis>();
        var assignments = store.Query<CrisisAssignment>().Where(a => a.UserId == actor.Id);
        return store.Query<AssistanceRequest>().Where(r => crises.Any(c => c.Id == r.CrisisId &&
            (assignedCountry == null || c.CountryCode == assignedCountry) &&
            (actor.SelectedCountry == null || c.CountryCode == actor.SelectedCountry) &&
            grants.Any(m => m.CountryCode == c.CountryCode && (m.CrisisId == null || m.CrisisId == c.Id) &&
                (role == Roles.Coordinator ? assignments.Any(a => a.CrisisId == c.Id) : m.OrganisationId == r.OrganisationId))));
    }
    public async Task<AssistanceRequest> Request(Guid id, string[]? roles = null, CancellationToken ct = default)
    {
        var r = (await store.ListAsync((await Visible(ct)).Where(x => x.Id == id), ct)).SingleOrDefault() ?? throw new MissingException();
        if (IsCoordinatorWorkspace)
            return roles == null || roles.Contains(Roles.Coordinator) ? r : throw new AccessDeniedException();
        if (IsLogisticsWorkspace && roles != null && !roles.Contains(Roles.Logistics)) throw new AccessDeniedException();
        if (roles is null)
            return r;
        if (!r.OrganisationId.HasValue && !await IsAdmin(ct) && !await Coordinates(r.CrisisId, ct))
            throw new AccessDeniedException();
        if (!await CrisisAccess(r.CrisisId, roles, r.OrganisationId, ct) && !(roles.Contains(Roles.Coordinator) && await Coordinates(r.CrisisId, ct)))
            throw new AccessDeniedException();
        return r;
    }
}
