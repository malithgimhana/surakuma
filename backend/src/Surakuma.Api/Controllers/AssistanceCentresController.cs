using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Surakuma.Application;
using Surakuma.Domain;

namespace Surakuma.Api.Controllers;

public sealed record AssistanceCentreInput(Guid OrganisationId, Guid? DepotId,
    [Required, StringLength(120)] string Name, [Required, StringLength(240)] string Address,
    [Required] double? Latitude, [Required] double? Longitude, [Required, StringLength(400)] string Services,
    [StringLength(400)] string Facilities, [StringLength(200)] string OpeningHours,
    bool Accessible, [Range(0, 100000)] int? Capacity, bool Published, byte[]? Version);

[ApiController, Route("api/v1"), Authorize(Roles = Roles.Administrator + "," + Roles.CountryAdministrator)]
public sealed class AssistanceCentresController(IStore store, AccessService access, Operations operations) : ControllerBase
{
    [HttpGet("public/assistance-centres"), AllowAnonymous]
    public async Task<IActionResult> PublicList(string countryCode, CancellationToken ct)
    {
        var centres = from centre in store.Query<AssistanceCentre>()
            where centre.CountryCode == countryCode && centre.Published &&
                store.Query<OrganisationCountry>().Any(o => o.OrganisationId == centre.OrganisationId &&
                    o.CountryCode == countryCode && (o.VerificationState == "Verified" || o.VerificationState == "LegacyActive"))
            orderby centre.Name, centre.Id
            select new { centre.Id, centre.Name, centre.Address, centre.Latitude, centre.Longitude, centre.Services,
                centre.Facilities, centre.OpeningHours, centre.Accessible, centre.Capacity };
        return Ok(await store.ListAsync(centres, ct));
    }

    [HttpGet("admin/assistance-centres")]
    public async Task<IActionResult> List(string countryCode, CancellationToken ct)
    {
        await AuthorizeCountry(countryCode, ct);
        var registrations = store.Query<OrganisationCountry>().Where(o => o.CountryCode == countryCode &&
            (o.VerificationState == "Verified" || o.VerificationState == "LegacyActive"));
        var organisations = await store.ListAsync(store.Query<Organisation>().Where(o => registrations.Any(r => r.OrganisationId == o.Id))
            .OrderBy(o => o.Name).Select(o => new { o.Id, o.Name }), ct);
        var depots = await store.ListAsync(store.Query<Depot>().Where(d => d.CountryCode == countryCode)
            .OrderBy(d => d.Name).Select(d => new { d.Id, d.Name, d.OrganisationId }), ct);
        var centres = await store.ListAsync(store.Query<AssistanceCentre>().Where(c => c.CountryCode == countryCode)
            .OrderBy(c => c.Name).ThenBy(c => c.Id), ct);
        return Ok(new { centres, organisations, depots });
    }

    [HttpPost("admin/assistance-centres")]
    public Task<AssistanceCentre> Create(string countryCode, AssistanceCentreInput input, CancellationToken ct) =>
        Save(countryCode, null, input, ct);

    [HttpPut("admin/assistance-centres/{id:guid}")]
    public Task<AssistanceCentre> Update(string countryCode, Guid id, AssistanceCentreInput input, CancellationToken ct) =>
        Save(countryCode, id, input, ct);

    private Task<AssistanceCentre> Save(string country, Guid? id, AssistanceCentreInput input, CancellationToken ct) =>
        store.TransactionAsync(async () =>
        {
            await AuthorizeCountry(country, ct);
            var centre = id.HasValue
                ? await store.FindAsync<AssistanceCentre>(id.Value, ct) ?? throw new MissingException()
                : new AssistanceCentre { CountryCode = country };
            if (centre.CountryCode != country) throw new MissingException();
            if (id.HasValue && (input.Version is null || !centre.Version.SequenceEqual(input.Version)))
                throw new RuleException("The centre has changed. Reload before editing.");
            if (input.Latitude is not double lat || input.Longitude is not double lng ||
                !double.IsFinite(lat) || !double.IsFinite(lng) || Math.Abs(lat) > 90 || Math.Abs(lng) > 180)
                throw new RuleException("Enter valid map coordinates.");
            await access.RequirePartner(input.OrganisationId, country, ct);
            if (input.DepotId is Guid depotId)
            {
                var depot = await store.FindAsync<Depot>(depotId, ct);
                if (depot == null || depot.CountryCode != country || depot.OrganisationId != input.OrganisationId)
                    throw new RuleException("Select a receiving depot in the centre’s organisation.");
            }
            centre.OrganisationId = input.OrganisationId;
            centre.DepotId = input.DepotId;
            centre.Name = input.Name.Trim();
            centre.Address = input.Address.Trim();
            centre.Services = input.Services.Trim();
            centre.Facilities = input.Facilities.Trim();
            centre.OpeningHours = input.OpeningHours.Trim();
            centre.Latitude = lat;
            centre.Longitude = lng;
            centre.Accessible = input.Accessible;
            centre.Capacity = input.Capacity;
            centre.Published = input.Published;
            if (!id.HasValue) store.Add(centre);
            operations.Audit(centre.Published ? "AssistanceCentrePublished" : "AssistanceCentreSaved",
                centre, centre.Name, country);
            return centre;
        }, ct);

    private async Task AuthorizeCountry(string country, CancellationToken ct)
    {
        if (access.SelectedCountry is { } selected && selected != country || !await access.CountryAccess(country, [], ct))
            throw new AccessDeniedException();
        if (!(await store.ListAsync(store.Query<Country>().Where(c => c.Code == country), ct)).Any())
            throw new MissingException();
    }
}
