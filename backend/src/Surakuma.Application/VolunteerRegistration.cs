using Surakuma.Domain;

namespace Surakuma.Application;

public sealed partial class Operations
{
    public async Task<(AssistanceRequest Request, string Country)> TaskVolunteerScope(Guid requestId, Guid? dispatchId, CancellationToken ct)
    {
        if (!access.IsVolunteerWorkspace) throw new AccessDeniedException();
        var request = await access.Request(requestId, VolunteerRoles, ct);
        var country = await CrisisCountry(request.CrisisId, ct);
        if (request.OrganisationId is not Guid organisationId || !ActiveFulfilment.Contains(request.Status) ||
            !request.RequiresCentreHandover && request.DeliveredQuantity >= request.Quantity)
            throw new RuleException("Choose an approved case with outstanding assistance.");
        await access.RequireLocation(organisationId, country, VolunteerRoles, ct, request.CrisisId);
        await access.RequirePartner(organisationId, country, ct);
        if (dispatchId is Guid dispatch)
            await RequireAvailableHandover(request, dispatch, ct);
        else if (request.RequiresCentreHandover)
            throw new RuleException("Choose a dispatch that is at the receiving centre.");
        return (request, country);
    }

    public async Task ValidateVolunteerProfileSetup(VolunteerProfileSetup input, string country, CancellationToken ct)
    {
        if (input.Skills.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Length == 0 ||
            string.IsNullOrWhiteSpace(input.Availability))
            throw new RuleException("Enter at least one skill and an availability schedule.");
        await ValidateVolunteerServiceRegion(input.ServiceRegionId, country, ct);
    }

    public async Task ValidateTaskVolunteerProfileSetup(TaskVolunteerProfileSetup input, AssistanceRequest request, string country, CancellationToken ct)
    {
        if (input.Skills.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Length == 0)
            throw new RuleException("Enter at least one skill.");
        await ValidateVolunteerServiceRegion(input.ServiceRegionId, country, ct);
        if (input.ServiceRegionId is Guid region && !(await CaseRegions(request, country, ct)).Contains(region))
            throw new RuleException("Choose a deployment area that includes this case.");
    }

    private async Task ValidateVolunteerServiceRegion(Guid? serviceRegionId, string country, CancellationToken ct)
    {
        if (serviceRegionId is Guid region &&
            (await store.FindAsync<AdministrativeDivision>(region, ct))?.CountryCode != country)
            throw new RuleException("Choose a deployment area in the same country.");
    }

    private async Task<Guid?> VolunteerScopeCrisis(VolunteerProfile profile, CancellationToken ct)
    {
        if (profile.TaskRequestId is not Guid requestId) return null;
        var request = await access.Request(requestId, VolunteerRoles, ct);
        if (request.OrganisationId != profile.OrganisationId) throw new AccessDeniedException();
        return request.CrisisId;
    }
}
