using System.Data;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Api.Controllers;

[ApiController, Route("api/v1"), Authorize]
public sealed class GeographyController(CrisisDbContext db, AccessService access, Operations operations, InternalNotifications notifications) : ControllerBase
{
    public sealed record RegionCoverage(string Region, int OpenShelters, long AvailablePlaces, int TransportReadyStockItems, int ActiveCrises);

    [HttpGet("countries/{code}/coverage"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<List<RegionCoverage>> Coverage(string code, CancellationToken ct)
    {
        if ((access.SelectedCountry is { } selected && selected != code) || !await access.CountryAccess(code, [], ct))
            throw new AccessDeniedException();
        if (!await db.Set<Country>().AnyAsync(c => c.Code == code, ct)) throw new MissingException();
        var divisions = await db.Set<AdministrativeDivision>().Where(d => d.CountryCode == code)
            .Select(d => new { d.Id, d.ParentId, d.Name }).ToDictionaryAsync(d => d.Id, ct);
        var shelters = await db.Set<Shelter>().Where(s => s.CountryCode == code && s.Open)
            .Select(s => new { s.AdministrativeDivisionId, Places = s.Capacity - s.Occupancy - s.Reserved }).ToListAsync(ct);
        var stock = await db.Set<Resource>().Where(r => r.CountryCode == code && r.TransportAvailable && r.Stock > r.Reserved)
            .Select(r => r.AdministrativeDivisionId).ToListAsync(ct);
        var crises = await db.Set<Crisis>().Where(c => c.CountryCode == code && c.Active)
            .Select(c => c.AdministrativeDivisionId).ToListAsync(ct);

        Guid Root(Guid? id)
        {
            for (int level = 0; level < 10 && id.HasValue && divisions.TryGetValue(id.Value, out var division); level++)
            {
                if (!division.ParentId.HasValue) return division.Id;
                id = division.ParentId;
            }
            return Guid.Empty;
        }
        var shelterByRegion = shelters.ToLookup(s => Root(s.AdministrativeDivisionId));
        var stockByRegion = stock.ToLookup(Root);
        var crisesByRegion = crises.ToLookup(Root);
        return divisions.Values.Where(d => d.ParentId == null).OrderBy(d => d.Name).Select(d => Group(d.Id, d.Name))
            .Append(Group(Guid.Empty, "Region unrecorded")).ToList();

        RegionCoverage Group(Guid id, string name) => new(name, shelterByRegion[id].Count(),
            shelterByRegion[id].Sum(s => (long)Math.Max(0, s.Places)), stockByRegion[id].Count(), crisesByRegion[id].Count());
    }

    [HttpPut("countries/{code}/services")]
    public async Task<IActionResult> Configure(string code, CountryServices input, CancellationToken ct)
    {
        if (!await access.CountryAccess(code, [], ct)) throw new AccessDeniedException();
        var country = await db.Set<Country>().SingleOrDefaultAsync(x => x.Code == code, ct) ?? throw new MissingException();
        if (input.Languages == null || input.RequiredAlertLanguages == null || input.Contacts == null) throw new RuleException("Provide languages and emergency contacts.");
        var languages = input.Languages.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Distinct().ToArray();
        var required = input.RequiredAlertLanguages.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Distinct().ToArray();
        if (!languages.Contains("en") || !required.Contains("en") || required.Except(languages).Any() || languages.Any(x => !new[] { "en", "si", "ta", "ne", "hi" }.Contains(x))) throw new RuleException("Choose supported languages and include English as the fallback.");
        if (input.Contacts.Length > 20 || input.Contacts.Any(x => x == null || string.IsNullOrWhiteSpace(x.Number) || string.IsNullOrWhiteSpace(x.Label) || x.Label.Length > 100 || !System.Text.RegularExpressions.Regex.IsMatch(x.Number, @"^\+?[0-9 -]{2,25}$") || !Uri.TryCreate(x.SourceUrl, UriKind.Absolute, out var uri) || uri.Scheme != "https")) throw new RuleException("Provide a contact label, telephone number and HTTPS source URL.");
        var contactsJson = JsonSerializer.Serialize(input.Contacts, JsonSerializerOptions.Web);
        if (contactsJson.Length > 4000) throw new RuleException("Configuration exceeds the supported size.");

        var savedLanguages = string.Join(',', languages);
        var savedRequired = string.Join(',', required);
        var changes = new List<string>();
        if (country.Languages != savedLanguages)
            changes.Add($"Available languages changed from {country.Languages} to {savedLanguages}");
        if (country.RequiredAlertLanguages != savedRequired)
            changes.Add($"Required alert languages changed from {country.RequiredAlertLanguages} to {savedRequired}");
        if (country.EmergencyContactsJson != contactsJson)
            changes.Add("Emergency contacts updated");
        if (changes.Count == 0) return NoContent();

        country.Languages = savedLanguages;
        country.RequiredAlertLanguages = savedRequired;
        country.EmergencyContactsJson = contactsJson;
        operations.Audit("CountryServicesConfigured", country, string.Join(". ", changes) + ".");
        await notifications.CountryServicesChanged(country, access.UserId, ct);
        await db.SaveChangesAsync(ct);
        return NoContent();
    }
    [AllowAnonymous, HttpGet("countries")]
    public Task<List<Country>> Countries(CancellationToken ct) => db.Set<Country>().OrderBy(x => x.Name).ToListAsync(ct);

    [AllowAnonymous, HttpGet("countries/{code}/divisions")]
    public Task<List<AdministrativeDivision>> Divisions(string code, CancellationToken ct) =>
        db.Set<AdministrativeDivision>().Where(x => x.CountryCode == code).OrderBy(x => x.Name).ToListAsync(ct);

    [HttpPut("admin/organisations/{id:guid}/countries/{code}")]
    public async Task<IActionResult> EnableCountry(Guid id, string code, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        if (!await access.IsAdmin(ct)) throw new AccessDeniedException();
        if (!await db.Set<Country>().AnyAsync(x => x.Code == code, ct)
            || !await db.Set<Organisation>().AnyAsync(x => x.Id == id && x.ArchivedAt == null, ct))
            throw new MissingException();
        var operation = await db.Set<OrganisationCountry>().IgnoreQueryFilters().SingleOrDefaultAsync(x => x.OrganisationId == id && x.CountryCode == code, ct);
        if (operation is null)
        {
            operation = new OrganisationCountry { OrganisationId = id, CountryCode = code };
            db.Add(operation);
        }
        else if (operation.ArchivedAt is null) return NoContent();
        operation.ArchivedAt = null;
        operation.VerificationState = "Pending";
        operation.ReviewerUserId = null;
        operation.ReviewedAt = null;
        operations.Audit("OrganisationCountryEnabled", operation, code);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return NoContent();
    }
}
public sealed record EmergencyContact(string Label, string Number, string SourceUrl);
public sealed record CountryServices(string Languages, string RequiredAlertLanguages, EmergencyContact[] Contacts);
