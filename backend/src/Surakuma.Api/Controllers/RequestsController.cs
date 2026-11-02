using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;
using Microsoft.EntityFrameworkCore;
namespace Surakuma.Api.Controllers;

[ApiController, Authorize, Route("api/v1/requests")]
public sealed class RequestsController(Operations operations, AccessService access, CrisisDbContext db, IWebHostEnvironment environment) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Submit(CreateRequestInput input, CancellationToken ct)
    {
        var r = await operations.Submit(input, ct);
        return CreatedAtAction(nameof(Detail), new
        {
            id = r.Id
        }, r);
    }
    [HttpGet] public Task<Page<AssistanceRequest>> List(string? status, string? search, CancellationToken ct, int page = 1) => operations.Requests(false, status, search, page, ct);
    [HttpGet("mine")] public Task<Page<AssistanceRequest>> Mine(string? status, string? search, CancellationToken ct, int page = 1) => operations.Requests(true, status, search, page, ct);
    [HttpGet("{id:guid}")] public Task<object> Detail(Guid id, CancellationToken ct) => operations.Detail(id, ct);
    [HttpPatch("{id:guid}/status")] public Task<AssistanceRequest> Status(Guid id, StatusInput input, CancellationToken ct) => operations.ChangeStatus(id, input, ct);
    [HttpPost("{id:guid}/escalate")]
    public async Task<IActionResult> Escalate(Guid id, TaskUpdateInput input, CancellationToken ct)
    {
        await operations.Escalate(id, input.Note, ct);
        return NoContent();
    }
    [HttpPost("{id:guid}/shares")]
    public async Task<IActionResult> Share(Guid id, ShareInput input, CancellationToken ct)
    {
        await operations.Share(id, input.OrganisationId, ct);
        return NoContent();
    }
    [HttpGet("{id:guid}/recommendations")] public Task<object> Recommendations(Guid id, CancellationToken ct) => operations.AiDetail(id, ct);
    [HttpPost("{id:guid}/recommendations/generate")] public Task<Recommendation> Generate(Guid id, CancellationToken ct) => operations.GenerateAi(id, ct);
    [HttpPost("{id:guid}/decisions")] public Task<Recommendation> Decide(Guid id, DecisionInput input, CancellationToken ct) => operations.Decide(id, input, ct);
    [HttpPost("{id:guid}/duplicates/{duplicateId:guid}")]
    public async Task<IActionResult> Duplicate(Guid id, Guid duplicateId, TaskUpdateInput input, CancellationToken ct)
    {
        await operations.ReviewDuplicate(id, duplicateId, input.Action, ct);
        return NoContent();
    }
    [HttpPost("{id:guid}/feedback")]
    public async Task<IActionResult> Feedback(Guid id, FeedbackInput input, CancellationToken ct)
    {
        await operations.Feedback(id, input, ct);
        return NoContent();
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
        string directory = Path.GetFullPath(Path.Combine(environment.ContentRootPath, "../../data/evidence"));
        Directory.CreateDirectory(directory);
        var attachment = new Attachment { RequestId = id, StoredName = Guid.NewGuid().ToString("N"), OriginalName = Path.GetFileName(file.FileName)[..Math.Min(150, Path.GetFileName(file.FileName).Length)], ContentType = type, Size = file.Length };
        string target = Path.Combine(directory, attachment.StoredName);
        try
        {
            await using (var output = System.IO.File.Create(target))
                await input.CopyToAsync(output, ct);
            db.Add(attachment);
            operations.Audit("EvidenceUploaded", attachment);
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
        string path = Path.GetFullPath(Path.Combine(environment.ContentRootPath, "../../data/evidence", a.StoredName));
        if (!System.IO.File.Exists(path))
            throw new MissingException();
        return PhysicalFile(path, a.ContentType, a.OriginalName);
    }
}
