using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Api.Controllers;

[ApiController, Route("api/v1"), Authorize]
public sealed class GeographyController(CrisisDbContext db, AccessService access, Operations operations) : ControllerBase
{
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
        country.Languages = string.Join(',', languages);
        country.RequiredAlertLanguages = string.Join(',', required);
        var contactsJson = System.Text.Json.JsonSerializer.Serialize(input.Contacts, new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase });
        if (contactsJson.Length > 4000) throw new RuleException("Contact configuration exceeds the supported size.");
        country.EmergencyContactsJson = contactsJson;
        operations.Audit("CountryServicesConfigured", country, code);
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
        if (!await access.IsAdmin(ct)) throw new AccessDeniedException();
        if (!await db.Set<Country>().AnyAsync(x => x.Code == code, ct) || !await db.Set<Organisation>().AnyAsync(x => x.Id == id, ct)) throw new MissingException();
        if (!await db.Set<OrganisationCountry>().AnyAsync(x => x.OrganisationId == id && x.CountryCode == code, ct))
        {
            var operation = new OrganisationCountry { OrganisationId = id, CountryCode = code };
            db.Add(operation);
            operations.Audit("OrganisationCountryEnabled", operation, code);
            await db.SaveChangesAsync(ct);
        }
        return NoContent();
    }
}
public sealed record EmergencyContact(string Label, string Number, string SourceUrl);
public sealed record CountryServices(string Languages, string RequiredAlertLanguages, EmergencyContact[] Contacts);
