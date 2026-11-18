using System.Data;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Surakuma.Application;
using Surakuma.Domain;

namespace Surakuma.Api.Controllers;

public sealed partial class OperationsController
{
    public sealed record AlertActionInput(string? Reason = null);
    private static readonly JsonSerializerOptions AlertJson = new(JsonSerializerDefaults.Web);

    [HttpPost("alerts")]
    public async Task<PublicAlert> CreateAlert(PublicAlert input, CancellationToken ct)
    {
        var crisis = await CoordinatedCrisis(input.CrisisId, ct);
        if (input.Published) throw new RuleException("Create a draft and submit it for independent review before publishing.");
        var alert = new PublicAlert { CrisisId = crisis.Id, WorkflowState = "Draft", CreatorUserId = access.UserId };
        CopyAlertDraft(input, alert);
        db.Add(alert);
        ops.Audit("PublicAlertCreated", alert, countryCode: crisis.CountryCode);
        await db.SaveChangesAsync(ct);
        return alert;
    }

    [HttpPut("alerts/{id:guid}")]
    public async Task<PublicAlert> EditAlert(Guid id, PublicAlert input, CancellationToken ct)
    {
        var alert = await db.Set<PublicAlert>().FindAsync([id], ct) ?? throw new MissingException();
        var crisis = await CoordinatedCrisis(alert.CrisisId, ct);
        if (alert.CreatorUserId != access.UserId) throw new AccessDeniedException();
        if (input.CrisisId != alert.CrisisId || input.Published || alert.WorkflowState is not ("Draft" or "Returned"))
            throw new RuleException("Only a draft or returned alert can be edited. Its crisis cannot change.");
        CopyAlertDraft(input, alert);
        ops.Audit("PublicAlertEdited", alert, countryCode: crisis.CountryCode);
        await db.SaveChangesAsync(ct);
        return alert;
    }

    [HttpGet("alerts/{id:guid}/history")]
    public async Task<object> AlertHistory(Guid id, CancellationToken ct)
    {
        var alert = await db.Set<PublicAlert>().FindAsync([id], ct) ?? throw new MissingException();
        var crisis = await CoordinatedCrisis(alert.CrisisId, ct);
        return await db.Set<AuditEvent>().Where(e => e.EntityType == nameof(PublicAlert) && e.EntityId == alert.Id &&
            (e.CountryCode == crisis.CountryCode || e.CountryCode == null)).OrderByDescending(e => e.CreatedAt)
            .Select(e => new { e.Id, e.Action, e.Detail, e.ActorId, e.CreatedAt,
                ActorName = db.Users.Where(u => u.Id == e.ActorId).Select(u => u.DisplayName).FirstOrDefault() }).ToListAsync(ct);
    }

    [HttpPost("alerts/{id:guid}/{operation}")]
    public async Task<PublicAlert> ChangeAlert(Guid id, string operation,
        [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] AlertActionInput? input,
        CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var alert = await db.Set<PublicAlert>().FindAsync([id], ct) ?? throw new MissingException();
        var crisis = await CoordinatedCrisis(alert.CrisisId, ct);
        var country = crisis.CountryCode;
        var state = alert.WorkflowState ?? (alert.Published ? "LegacyPublished" : "Draft");
        var reviewer = await access.CountryAccess(country, [], ct);
        var reason = input?.Reason?.Trim() ?? "";
        var action = "PublicAlert";
        var message = "";
        switch (operation)
        {
            case "submit" when state is "Draft" or "Returned":
                if (alert.CreatorUserId != access.UserId) throw new AccessDeniedException();
                await ValidatePublication(alert, crisis, ct);
                alert.WorkflowState = "PendingReview";
                action += "Submitted";
                message = "A public alert awaits independent approval.";
                break;
            case "approve" or "return" when state == "PendingReview":
                if (!reviewer || alert.CreatorUserId == access.UserId) throw new AccessDeniedException();
                RequireAlertReason(reason);
                if (operation == "approve") await ValidatePublication(alert, crisis, ct);
                alert.ReviewerUserId = access.UserId;
                alert.WorkflowState = operation == "approve" ? "Approved" : "Returned";
                action += operation == "approve" ? "Approved" : "Returned";
                break;
            case "publish" when state == "Approved":
                if (alert.CreatorUserId != access.UserId && !reviewer) throw new AccessDeniedException();
                await ValidatePublication(alert, crisis, ct);
                alert.WorkflowState = "Published";
                alert.Published = true;
                alert.PublishedAt = DateTimeOffset.UtcNow;
                action += "Published";
                message = "A public alert was published.";
                break;
            case "emergency-publish" when state is "Draft" or "Returned" or "PendingReview":
                if (!reviewer) throw new AccessDeniedException();
                if (alert.Severity != "Critical") throw new RuleException("Emergency publication is limited to critical alerts.");
                RequireAlertReason(reason);
                await ValidatePublication(alert, crisis, ct);
                alert.WorkflowState = "EmergencyPublished";
                alert.EmergencyPublisherUserId = access.UserId;
                alert.ReviewerUserId = null;
                alert.Published = true;
                alert.PublishedAt = DateTimeOffset.UtcNow;
                action += "EmergencyPublished";
                message = "A critical alert was published under emergency authority. Independent review is required.";
                break;
            case "post-review" when alert.EmergencyPublisherUserId != null &&
                alert.ReviewerUserId == null && state is "EmergencyPublished" or "Withdrawn":
                if (!reviewer || alert.EmergencyPublisherUserId == access.UserId || alert.CreatorUserId == access.UserId)
                    throw new AccessDeniedException();
                RequireAlertReason(reason);
                alert.ReviewerUserId = access.UserId;
                if (alert.Published) alert.WorkflowState = "Published";
                action += "EmergencyReviewed";
                break;
            case "unpublish" when alert.Published:
                if (!reviewer && alert.CreatorUserId != access.UserId) throw new AccessDeniedException();
                RequireAlertReason(reason);
                alert.Published = false;
                alert.WorkflowState = "Withdrawn";
                action += "Unpublished";
                message = "A public alert was withdrawn.";
                break;
            case "unpublish" when state == "Withdrawn":
            case "publish" when state == "Published":
                return alert;
            default:
                throw new RuleException("This action is unavailable for the current alert status.");
        }
        ops.Audit(action, alert, reason, country);
        if (message.Length > 0)
            await notifications.AlertChanged(crisis, message, reviewersOnly: operation == "submit", ct);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return alert;
    }

    private static void RequireAlertReason(string reason)
    {
        if (reason.Length is < 5 or > 1000) throw new RuleException("Enter a reason between 5 and 1,000 characters.");
    }

    private static void CopyAlertDraft(PublicAlert input, PublicAlert alert)
    {
        if (input.Severity is not ("Information" or "Advisory" or "Warning" or "Critical"))
            throw new RuleException("Select a valid alert severity.");
        if (string.IsNullOrWhiteSpace(input.Title) || string.IsNullOrWhiteSpace(input.Message) ||
            input.ExpiresAt <= DateTimeOffset.UtcNow)
            throw new RuleException("Provide a title, message and future expiry.");
        if ((input.Area?.Length ?? 0) > 240 || (input.Authority?.Length ?? 0) > 240)
            throw new RuleException("The affected area and issuing authority may contain up to 240 characters.");
        var translations = ReadTranslations(input);
        if (translations.Any(x => x.Value == null || x.Value.Title == null || x.Value.Message == null ||
            x.Value.Title.Length > 150 || x.Value.Message.Length > 2000))
            throw new RuleException("Alert translations exceed the allowed length.");
        var extra = JsonSerializer.Serialize(translations.Where(x => x.Key is not ("en" or "si" or "ta"))
            .ToDictionary(x => x.Key, x => x.Value), AlertJson);
        if (extra.Length > 4000) throw new RuleException("Additional translations exceed the supported size.");
        alert.TranslationsJson = extra;
        alert.Title = input.Title.Trim();
        alert.Message = input.Message.Trim();
        alert.SinhalaTitle = translations.GetValueOrDefault("si")?.Title ?? "";
        alert.SinhalaMessage = translations.GetValueOrDefault("si")?.Message ?? "";
        alert.TamilTitle = translations.GetValueOrDefault("ta")?.Title ?? "";
        alert.TamilMessage = translations.GetValueOrDefault("ta")?.Message ?? "";
        alert.Severity = input.Severity;
        alert.Area = input.Area?.Trim() ?? "";
        alert.Authority = input.Authority?.Trim() ?? "";
        alert.ExpiresAt = input.ExpiresAt;
    }

    private async Task ValidatePublication(PublicAlert alert, Crisis crisis, CancellationToken ct)
    {
        if (!crisis.Active || alert.ExpiresAt <= DateTimeOffset.UtcNow)
            throw new RuleException("Select an active crisis and future expiry.");
        if (string.IsNullOrWhiteSpace(alert.Area) || string.IsNullOrWhiteSpace(alert.Authority))
            throw new RuleException("Provide an affected area and issuing authority.");
        var country = await db.Set<Country>().SingleAsync(x => x.Code == crisis.CountryCode, ct);
        var translations = ReadTranslations(alert);
        if (country.RequiredAlertLanguages.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Any(language => !translations.TryGetValue(language, out var text) ||
                string.IsNullOrWhiteSpace(text?.Title) || string.IsNullOrWhiteSpace(text.Message)))
            throw new RuleException("Provide alert wording in all required country languages: " + country.RequiredAlertLanguages);
    }

    private static Dictionary<string, AlertTranslation> ReadTranslations(PublicAlert input)
    {
        Dictionary<string, AlertTranslation> translations;
        try { translations = JsonSerializer.Deserialize<Dictionary<string, AlertTranslation>>(input.TranslationsJson ?? "{}", AlertJson) ?? []; }
        catch (JsonException) { throw new RuleException("Invalid alert translations."); }
        translations["en"] = new(input.Title, input.Message);
        if (!string.IsNullOrWhiteSpace(input.SinhalaTitle)) translations["si"] = new(input.SinhalaTitle, input.SinhalaMessage);
        if (!string.IsNullOrWhiteSpace(input.TamilTitle)) translations["ta"] = new(input.TamilTitle, input.TamilMessage);
        return translations;
    }
}
