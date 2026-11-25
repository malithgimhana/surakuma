using Surakuma.Domain;

namespace Surakuma.Application;

public sealed record CaseMessageInput(string Audience, string Language);
public sealed record PublishCaseMessageInput(bool WordingReviewed);
public sealed record CaseMessageView(CaseMessageDraft Draft, string Preview);

public sealed class CaseCommunications(IStore store, AccessService access, Operations operations,
    InternalNotifications notifications, IAiProvider ai)
{
    private static readonly string[] RolesAllowed = [Roles.CaseManager, Roles.Coordinator];

    public async Task<IReadOnlyList<CaseMessageView>> List(Guid requestId, CancellationToken ct)
    {
        var request = await access.Request(requestId, RolesAllowed, ct);
        var drafts = await store.ListAsync(store.Query<CaseMessageDraft>().Where(d => d.RequestId == requestId)
            .OrderByDescending(d => d.CreatedAt).ThenByDescending(d => d.Id).Take(10), ct);
        return drafts.Select(View).ToArray();
        CaseMessageView View(CaseMessageDraft draft) => new(draft, PublishedText(request.Reference, draft.Language, draft));
    }

    public async Task<CaseMessageView> Generate(Guid requestId, CaseMessageInput input, CancellationToken ct)
    {
        var request = await access.Request(requestId, RolesAllowed, ct);
        if (input.Audience is not ("Citizen" or "Staff")) throw new RuleException("Choose a notification audience.");
        var crisis = await store.FindAsync<Crisis>(request.CrisisId, ct) ?? throw new MissingException();
        var countries = await store.ListAsync(store.Query<Country>().Where(c => c.Code == crisis.CountryCode), ct);
        var languages = (countries.SingleOrDefault()?.Languages ?? "en").Split(',', StringSplitOptions.TrimEntries);
        if (input.Language != "en" && (!languages.Contains(input.Language) || input.Language is not ("si" or "ta" or "hi" or "ne")))
            throw new RuleException("Choose a supported language for this crisis country.");
        var generated = await ai.DraftCitizenCopyAsync(input.Audience, input.Language, ct);
        var draft = new CaseMessageDraft
        {
            RequestId = requestId, StatusSnapshot = request.Status, Audience = input.Audience, Language = input.Language,
            Copy = generated?.Text ?? PortalCopy(input.Language),
            Source = generated?.Source ?? "Deterministic fallback · localized-portal-copy-v1", CreatedByUserId = access.UserId
        };
        store.Add(draft);
        operations.Audit("CaseMessageDrafted", draft, draft.Audience + " · " + draft.Language, crisis.CountryCode);
        await store.SaveAsync(ct);
        return new(draft, PublishedText(request.Reference, draft.Language, draft));
    }

    public Task<CaseMessageView> Publish(Guid requestId, Guid draftId, PublishCaseMessageInput input, CancellationToken ct) =>
        store.RoutingTransactionAsync(async () =>
        {
            var request = await access.Request(requestId, RolesAllowed, ct);
            var draft = await store.FindAsync<CaseMessageDraft>(draftId, ct) ?? throw new MissingException();
            if (draft.RequestId != requestId) throw new MissingException();
            if (!input.WordingReviewed) throw new RuleException("Review the wording and confirm before sending.");
            if (draft.PublishedAt.HasValue) return new CaseMessageView(draft, PublishedText(request.Reference, draft.Language, draft));
            if (request.Status != draft.StatusSnapshot) throw new RuleException("The case status changed. Generate a current draft.");
            if (draft.Audience == "Citizen")
                store.Add(new OutboxMessage { Id = draft.Id, UserId = request.CitizenId, RequestId = requestId,
                    Message = CitizenMessages.Status(request.Reference, request.Status, "en"),
                    SinhalaMessage = CitizenMessages.Status(request.Reference, request.Status, "si"),
                    TamilMessage = CitizenMessages.Status(request.Reference, request.Status, "ta"),
                    CopyLanguage = draft.Language, ReviewedCopy = draft.Copy, CommunicationSource = draft.Source });
            else
                await notifications.RequestChanged(request, "", ct, draft: draft);
            draft.PublishedAt = DateTimeOffset.UtcNow;
            draft.ReviewerUserId = access.UserId;
            var crisis = await store.FindAsync<Crisis>(request.CrisisId, ct) ?? throw new MissingException();
            operations.Audit("CaseMessagePublished", draft, draft.Audience + " · " + draft.Language, crisis.CountryCode);
            return new CaseMessageView(draft, PublishedText(request.Reference, draft.Language, draft));
        }, ct);

    public static string PublishedText(string reference, string language, CaseMessageDraft draft) =>
        CitizenMessages.Status(reference, draft.StatusSnapshot, language) + (draft.Language == language ? " " + draft.Copy : "");

    private static string PortalCopy(string language) => language switch
    {
        "si" => "විස්තර සඳහා සුරැකුම වෙත පිවිසෙන්න.",
        "ta" => "விவரங்களை அறிய சுரகும தளத்தில் உள்நுழையுங்கள்.",
        "hi" => "विवरण देखने के लिए Surakuma में साइन इन करें।",
        "ne" => "विवरण हेर्न Surakuma मा साइन इन गर्नुहोस्।",
        _ => "Sign in to Surakuma to view the details."
    };
}
