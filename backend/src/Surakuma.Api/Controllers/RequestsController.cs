using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;
using Microsoft.EntityFrameworkCore;
namespace Surakuma.Api.Controllers;

public sealed record CategorySuggestionInput([Required, StringLength(4000, MinimumLength = 3)] string Description,
    [Required, StringLength(2, MinimumLength = 2)] string CountryCode, [Required, MaxLength(100)] string DraftKey,
    bool UseDescriptionWithAi = false);

[ApiController, Authorize, Route("api/v1/requests")]
public sealed class RequestsController(Operations operations, AccessService access, CrisisDbContext db, IWebHostEnvironment environment,
    IConfiguration configuration, IDataProtectionProvider protection) : ControllerBase
{
    private ITimeLimitedDataProtector CategoryProof =>
        protection.CreateProtector("Surakuma.IntakeCategorySuggestion.v1").ToTimeLimitedDataProtector();

    private string EvidenceDirectory => Path.GetFullPath(configuration["Storage:EvidencePath"] ??
        Path.Combine(environment.ContentRootPath, "../../data/evidence"));
    [HttpPost, Authorize(Roles = Roles.Citizen)]
    public async Task<IActionResult> Submit(CreateRequestInput input, CancellationToken ct)
    {
        var r = await operations.Submit(input, ct, ReadCategoryProof(input));
        return CreatedAtAction(nameof(Detail), new
        {
            id = r.Id
        }, r);
    }

    [HttpPost("category-suggestion"), Authorize(Roles = Roles.Citizen), EnableRateLimiting("ai-drafts")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> SuggestCategory(CategorySuggestionInput input, [FromServices] IAiProvider ai, CancellationToken ct)
    {
        if (!await db.Set<Country>().AnyAsync(country => country.Code == input.CountryCode, ct))
            throw new RuleException("Choose a supported country.");
        var clues = IntakeCategoryHelp.Recognise(input.Description);
        var options = clues.Select(clue => clue.Category).Distinct().ToArray();
        var help = input.UseDescriptionWithAi ? new IntakeCategoryText(input.Description, input.CountryCode) : null;
        var assessment = await ai.SuggestCategoryAsync(clues, ct, help);
        if (assessment?.Category is { } category)
            options = [category, .. options.Where(option => option != category)];
        if (options.Length == 0)
            return Ok(new { options, recommendation = (AidCategory?)null, source = "NoMatch", receipt = (string?)null });

        var recommendation = assessment is not null ? assessment.Category : options.Length == 1 ? options[0] : (AidCategory?)null;
        var source = assessment is null ? "Rules" : "OpenAI";
        var result = new IntakeCategoryReceipt(access.UserId, input.CountryCode, input.DraftKey, recommendation, options, source);
        var receipt = CategoryProof.Protect(JsonSerializer.Serialize(result), TimeSpan.FromDays(7));
        return Ok(new { options, recommendation, source, receipt, model = assessment?.Model });
    }

    private IntakeCategoryReceipt? ReadCategoryProof(CreateRequestInput input)
    {
        if (string.IsNullOrEmpty(input.CategoryReceipt)) return null;
        try
        {
            var receipt = JsonSerializer.Deserialize<IntakeCategoryReceipt>(CategoryProof.Unprotect(input.CategoryReceipt));
            return receipt is not null && receipt.UserId == access.UserId && receipt.DraftKey == input.SubmissionKey ? receipt : null;
        }
        catch (Exception ex) when (ex is CryptographicException or JsonException)
        {
            // A missing or expired optional suggestion never blocks a request.
            return null;
        }
    }
    [HttpGet]
    public Task<Page<AssistanceRequest>> List(string? status, string? search, CancellationToken ct, int page = 1,
        bool assignedToMe = false, string? view = null, Guid? crisisId = null, string? staffRole = null,
        AidCategory? category = null, Priority? priority = null, Guid? regionId = null) =>
        operations.Requests(false, status, search, page, ct, assignedToMe, view, crisisId, staffRole, category, priority, regionId);
    [HttpGet("coordinator")]
    public async Task<object> CoordinatorCases(string? status, string? search, CancellationToken ct,
        int page = 1, string? view = null, Priority? priority = null)
    {
        if (!access.IsCoordinatorWorkspace) throw new AccessDeniedException();
        var results = await operations.Requests(false, status, search, page, ct,
            view: view, staffRole: Roles.Coordinator, priority: priority);
        var legacyIds = results.Items.Where(r => r.AssessmentState == null).Select(r => r.Id).ToArray();
        var legacyAssessmentIds = await db.Set<Recommendation>().Where(r => legacyIds.Contains(r.RequestId))
            .Select(r => r.RequestId).Distinct().ToArrayAsync(ct);
        return new { results.Items, results.Total, results.PageNumber, results.PageSize, legacyAssessmentIds };
    }
    [HttpGet("mine")] public Task<Page<AssistanceRequest>> Mine(string? status, string? search, CancellationToken ct, int page = 1) => operations.Requests(true, status, search, page, ct);
    [HttpGet("mine/summary"), Authorize(Roles = Roles.Citizen)] public Task<object> MySummary(CancellationToken ct) => operations.MyRequestSummary(ct);
    [HttpGet("triage")] public Task<List<AssistanceRequest>> Triage(CancellationToken ct, Guid? crisisId = null) => operations.Triage(ct, crisisId);
    [HttpGet("escalated")] public Task<List<AssistanceRequest>> Escalated(CancellationToken ct) => operations.EscalatedRequests(ct);
    [HttpPost("{id:guid}/reassign")] public Task<AssistanceRequest> Reassign(Guid id, ShareInput input, CancellationToken ct) => operations.Reassign(id, input.OrganisationId, ct);
    [HttpPost("{id:guid}/case-manager")] public Task<AssistanceRequest> AssignManager(Guid id, CaseManagerInput input, CancellationToken ct) => operations.AssignManager(id, input.UserId, ct);
    [HttpGet("{id:guid}/case-managers")]
    public async Task<object> CaseManagers(Guid id, CancellationToken ct)
    {
        var request = await db.Set<AssistanceRequest>().FindAsync([id], ct) ?? throw new MissingException();
        if (!await access.IsAdmin(ct) && !await access.Coordinates(request.CrisisId, ct)) throw new AccessDeniedException();
        return await (from membership in db.Set<Membership>() join user in db.Users on membership.UserId equals user.Id
                      where membership.OrganisationId == request.OrganisationId && membership.Role == Roles.CaseManager && (membership.CrisisId == null || membership.CrisisId == request.CrisisId) && db.Set<Crisis>().Any(c => c.Id == request.CrisisId && c.CountryCode == membership.CountryCode)
                          && !db.Set<Membership>().Any(other => other.UserId == user.Id && other.Role == Roles.CaseManager && other.CountryCode != membership.CountryCode)
                      orderby user.DisplayName select new { user.Id, Name = user.DisplayName, membership.AvailableForAssignment }).ToListAsync(ct);
    }
    [HttpGet("{id:guid}")] public Task<object> Detail(Guid id, CancellationToken ct) => operations.Detail(id, ct);
    [HttpPost("{id:guid}/consolidate")]
    public Task<CaseConsolidation> Consolidate(Guid id, ConsolidateCaseInput input, CancellationToken ct) => operations.Consolidate(id, input, ct);
    [HttpPatch("{id:guid}/status")] public Task<AssistanceRequest> Status(Guid id, StatusInput input, CancellationToken ct) => operations.ChangeStatus(id, input, ct);
    [HttpPatch("{id:guid}/measurement")] public Task<AssistanceRequest> Measurement(Guid id, ClarifyMeasurementInput input, CancellationToken ct) => operations.ClarifyMeasurement(id, input, ct);
    [HttpPost("{id:guid}/escalate")]
    public async Task<IActionResult> Escalate(Guid id, TaskUpdateInput input, CancellationToken ct)
    {
        await operations.Escalate(id, input.Note, ct);
        return NoContent();
    }
    [HttpPost("{id:guid}/escalation/resolve")]
    public async Task<IActionResult> ResolveEscalation(Guid id, ResolveEscalationInput input, CancellationToken ct)
    {
        await operations.ResolveEscalation(id, input.Note, ct);
        return NoContent();
    }
    [HttpPost("{id:guid}/shares")]
    public async Task<IActionResult> Share(Guid id, ShareInput input, CancellationToken ct)
    {
        await operations.Share(id, input.OrganisationId, ct);
        return NoContent();
    }
    [HttpGet("{id:guid}/recommendations")] public Task<object> Recommendations(Guid id, CancellationToken ct) => operations.AiDetail(id, ct);
    [HttpPost("{id:guid}/recommendations/generate"), EnableRateLimiting("ai-drafts")]
    public async Task<object> Generate(Guid id, CancellationToken ct) => AiPresentation.Recommendation(await operations.GenerateAi(id, ct));
    [HttpGet("{id:guid}/communications")]
    public Task<IReadOnlyList<CaseMessageView>> Communications([FromServices] CaseCommunications communications, Guid id, CancellationToken ct)
        => communications.List(id, ct);
    [HttpPost("{id:guid}/communications"), EnableRateLimiting("ai-drafts")]
    public Task<CaseMessageView> DraftCommunication([FromServices] CaseCommunications communications, Guid id, CaseMessageInput input, CancellationToken ct)
        => communications.Generate(id, input, ct);
    [HttpPost("{id:guid}/communications/{draftId:guid}/publish")]
    public Task<CaseMessageView> PublishCommunication([FromServices] CaseCommunications communications, Guid id, Guid draftId, PublishCaseMessageInput input, CancellationToken ct)
        => communications.Publish(id, draftId, input, ct);
    [HttpPost("{id:guid}/decisions")]
    public async Task<object> Decide(Guid id, DecisionInput input, CancellationToken ct) => AiPresentation.Recommendation(await operations.Decide(id, input, ct));
    [HttpPost("{id:guid}/duplicates/{duplicateId:guid}")]
    public async Task<IActionResult> Duplicate(Guid id, Guid duplicateId, TaskUpdateInput input, CancellationToken ct)
    {
        await operations.ReviewDuplicate(id, duplicateId, input.Action, ct);
        return NoContent();
    }
    [HttpPost("{id:guid}/feedback")]
    public async Task<IActionResult> Feedback(Guid id, FeedbackInput input, CancellationToken ct)
    {
        var feedback = await operations.Feedback(id, input, ct);
        return Ok(new { feedback.Id, feedback.Rating, feedback.Received, feedback.Problem, feedback.Comment, feedback.CreatedAt });
    }
    [HttpPost("{id:guid}/attachments"), RequestSizeLimit(5 * 1024 * 1024)]
    public async Task<object> Upload(Guid id, IFormFile file, CancellationToken ct)
    {
        var r = await access.Request(id, ct: ct);
        if (r.CitizenId != access.UserId)
            throw new AccessDeniedException();
        if (file.Length is < 8 or > 4 * 1024 * 1024)
            throw new RuleException("Evidence must be between 8 bytes and 4 MB.");
        if (await db.Set<Attachment>().CountAsync(x => x.RequestId == id, ct) >= 3)
            throw new RuleException("Maximum three evidence files per request.");
        await using var input = file.OpenReadStream();
        var header = new byte[8];
        await input.ReadExactlyAsync(header, ct);
        input.Position = 0;
        string? type = header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF ? "image/jpeg" : header.SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) ? "image/png" : null;
        if (type is null)
            throw new RuleException("Only JPEG and PNG evidence is accepted. File content must match its format.");
        string directory = EvidenceDirectory;
        Directory.CreateDirectory(directory);
        var attachment = new Attachment { RequestId = id, StoredName = Guid.NewGuid().ToString("N"), OriginalName = Path.GetFileName(file.FileName)[..Math.Min(150, Path.GetFileName(file.FileName).Length)], ContentType = type, Size = file.Length };
        string target = Path.Combine(directory, attachment.StoredName);
        try
        {
            await using (var output = System.IO.File.Create(target))
                await input.CopyToAsync(output, ct);
            db.Add(attachment);
            operations.Audit("EvidenceUploaded", attachment, countryCode: await db.Set<Crisis>().Where(c => c.Id == r.CrisisId).Select(c => c.CountryCode).SingleAsync(ct));
            await db.SaveChangesAsync(ct);
        }
        catch { if (System.IO.File.Exists(target)) System.IO.File.Delete(target); throw; }
        return new
        {
            attachment.Id,
            attachment.OriginalName,
            attachment.Size
        };
    }
    [HttpGet("{id:guid}/attachments/{attachmentId:guid}")]
    public async Task<IActionResult> Download(Guid id, Guid attachmentId, CancellationToken ct)
    {
        await access.Request(id, ct: ct);
        var a = await db.Set<Attachment>().SingleOrDefaultAsync(x => x.Id == attachmentId && x.RequestId == id, ct) ?? throw new MissingException();
        string path = Path.Combine(EvidenceDirectory, a.StoredName);
        if (!System.IO.File.Exists(path))
            throw new MissingException();
        return PhysicalFile(path, a.ContentType, a.OriginalName);
    }
}
