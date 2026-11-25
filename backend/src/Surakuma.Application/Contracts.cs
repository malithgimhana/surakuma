using System.ComponentModel.DataAnnotations;
using Surakuma.Domain;

namespace Surakuma.Application;

public sealed record VolunteerRoster(List<VolunteerProfile> Profiles, List<VolunteerTask> Tasks, List<VolunteerTaskEvent> History);

public sealed record RegisterInput([Required, EmailAddress] string Email, [Required, MinLength(10)] string Password, [Required, MaxLength(100)] string Name, string Language = "en");
public sealed record RegisterDonorInput([Required, EmailAddress] string Email, [Required, MinLength(10)] string Password,
    [Required, MaxLength(100)] string Name, [MaxLength(150)] string? OrganisationName, string Language = "en");
public sealed record LoginInput([Required, EmailAddress] string Email, [Required] string Password);
public sealed record VolunteerAvailabilityInput([Required(AllowEmptyStrings = true), MaxLength(500)] string Schedule, bool Available,
    VolunteerServiceArea? ServiceArea = null);
public sealed record VolunteerServiceArea(Guid? RegionId, bool Consent, double? Latitude, double? Longitude);
public sealed record ProfileInput(
    [Required, MaxLength(100)] string Name,
    string Language,
    [Range(1, 50)] int? HouseholdSize = null,
    [MaxLength(500)] string? AccessibilityNeeds = null,
    [MaxLength(40), RegularExpression(@"(?=.*[0-9])[+0-9(). -]+")] string? WorkPhone = null,
    VolunteerAvailabilityInput? VolunteerAvailability = null,
    Dictionary<Guid, bool>? CaseManagerAvailability = null,
    [MaxLength(1000)] string? VolunteerSkills = null);
public sealed record ProfileContactInput(
    [MaxLength(100)] string? Name = null,
    string? Language = null,
    [MaxLength(40), RegularExpression(@"(?=.*[0-9])[+0-9(). -]+")] string? WorkPhone = null);
public sealed record CreateRequestInput(Guid CrisisId, Guid? OrganisationId, AidCategory Category, Priority Priority,
    [Required, MinLength(10), MaxLength(4000)] string Description, [Required, MaxLength(500)] string LocationText,
    double? Latitude, double? Longitude, [Range(1, 50)] int HouseholdSize, [MaxLength(500)] string AccessibilityNeeds,
    [Range(typeof(decimal), "0.01", "100000")] decimal Quantity, [Required, MaxLength(100)] string SubmissionKey, bool Synthetic,
    bool RequestedForSomeoneElse = false, [MaxLength(200)] string? RequesterRelationship = null, [MaxLength(500)] string? RequesterContact = null,
    [MaxLength(32)] string? Unit = null, Guid? AdministrativeDivisionId = null, CitizenIntake? Intake = null,
    [MaxLength(2048)] string? CategoryReceipt = null);
public sealed record ClarifyMeasurementInput([MaxLength(32)] string? Unit, Guid? AdministrativeDivisionId, [Required, MaxLength(1000)] string Reason);
public sealed record StatusInput(RequestStatus Status, [MaxLength(1000)] string Reason = "");
public sealed record ConsolidateCaseInput(Guid PrimaryRequestId, [Required, MaxLength(1000)] string Reason);
public sealed record DecisionInput(Guid RecommendationId, string Action, Priority? FinalPriority, AidCategory? FinalCategory, [MaxLength(1000)] string Reason);
public sealed record ResourceInput(Guid OrganisationId, [Required, MaxLength(100)] string Name, AidCategory Category, [Required] string Unit, [Range(typeof(decimal), "0", "10000000")] decimal Stock, string LocationText, [Range(-90d, 90d)] double Latitude, [Range(-180d, 180d)] double Longitude, string Suitability, bool TransportAvailable, string CountryCode = "LK", Guid? AdministrativeDivisionId = null, Guid? DepotId = null, [MaxLength(40)] string? Code = null, [Range(typeof(decimal), "0", "10000000")] decimal? LowStockThreshold = null, Guid? OperationId = null);
public sealed record ResourceBatchInput([Required, MinLength(1), MaxLength(100)] ResourceInput[] Resources);
public sealed record AllocateInput(Guid RequestId, Guid ResourceId, [Range(typeof(decimal), "0.01", "100000000")] decimal Quantity, Guid? RecommendedResourceId = null, Guid? OperationId = null, Guid? NeedId = null);
public sealed record IgnoreAllocationRecommendationInput(Guid RecommendedResourceId);
public sealed record MovementInput([Range(typeof(decimal), "0.01", "100000")] decimal Quantity, string Note);
public sealed record ShelterInput(Guid OrganisationId, [Required, MaxLength(150)] string Name, string Address, [Range(-90d, 90d)] double Latitude, [Range(-180d, 180d)] double Longitude, [Range(1, 100000)] int Capacity, bool Accessible, bool Open, string Facilities, string CountryCode = "LK", Guid? AdministrativeDivisionId = null,
    Guid? RegistrationId = null, bool VerifyOperations = false, DateTimeOffset? ExpectedOperationalUpdate = null);
public sealed record ShelterPlaceInput(Guid RequestId, Guid ShelterId);
public sealed record VolunteerCase(Guid Id, string Reference, string LocationText, Guid OrganisationId,
    string Crisis = "", string Category = "", string Priority = "", string Description = "",
    decimal OutstandingQuantity = 0, string? Unit = null, bool RequiresCentreHandover = false,
    Guid? AdministrativeDivisionId = null);
public sealed record TaskInput(Guid RequestId, Guid VolunteerId, [Required, MaxLength(200)] string Title, [MaxLength(100)] string? RequiredSkill,
    DateTimeOffset DueAt, DateTimeOffset? StartsAt = null, [MaxLength(2000)] string? Instructions = null, Guid? CaseDispatchId = null);
public sealed record HandoverQuantity(Guid AllocationId, decimal Quantity);
public sealed record VolunteerCandidate(Guid Id, string Skills, string Availability, int OpenCommitments, string Explanation,
    double Score, double? DistanceKm, string Algorithm = "verified-volunteer-ranking-v2", string ReviewState = "Coordinator assignment pending");
public sealed record VolunteerSkillInput(Guid RequestId, [Required, MaxLength(200)] string Title);
public sealed record ShelterCandidate(Guid Id, string Name, int Available, bool Accessible, double? DistanceKm, string Explanation,
    double Score, FulfilmentEvidence Evidence);
public sealed record TaskUpdateInput(string Action, [MaxLength(2000)] string Note = "",
    [MaxLength(2000)] string? WorkDescription = null, [MaxLength(2000)] string? Outcome = null,
    [Range(0, 10000000)] int? PeopleAssisted = null, [MaxLength(2000)] string? Issues = null,
    [MaxLength(100)] HandoverQuantity[]? HandoverQuantities = null);
public sealed record DeliveryInput([Required, MaxLength(100)] string Reference, decimal ConfirmedQuantity,
    DateTimeOffset? ReceivedAt, [Required, MaxLength(150)] string ReceivedBy, [Required] string Method,
    [MaxLength(1000)] string? Note = null, [MaxLength(1000)] string? ExceptionDetail = null);
public sealed record ResolveEscalationInput([Required, MaxLength(1000)] string Note);
public sealed record FeedbackInput([Range(1, 5)] int Rating, bool Received, bool Problem, [MaxLength(2000)] string Comment);
public sealed record ShareInput(Guid OrganisationId);
public sealed record CentreRoutingInput(Guid? OrganisationId);
public sealed record AvailabilityInput(bool Available);
public sealed record CaseManagerInput([Required] string UserId);
public sealed record VolunteerProfileSetup([Required, MaxLength(1000)] string Skills,
    [Required, MaxLength(500)] string Availability, bool Available, Guid? ServiceRegionId);
public sealed record TaskVolunteerProfileSetup([Required, MaxLength(1000)] string Skills,
    bool Available, Guid? ServiceRegionId, [MaxLength(500)] string? Availability = null);
public sealed record TaskVolunteerInput(Guid RequestId, Guid? CaseDispatchId,
    [MaxLength(100)] string? Name, [Required, EmailAddress, MaxLength(256)] string Email,
    [MinLength(10), MaxLength(100)] string? Password, [Required] TaskVolunteerProfileSetup Profile, bool UseExistingAccount = false);
public sealed record StaffInput([Required, EmailAddress] string Email, string? Password, string? Name, Guid? OrganisationId,
    [Required] string Role, Guid? CrisisId, string CountryCode = "LK", VolunteerProfileSetup? VolunteerProfile = null);
public sealed record ReverseGeocodeInput(double? Latitude, double? Longitude);
public sealed record AiResult(AidCategory Category, Priority Priority, string Explanation, string Provider, string Model, bool Fallback,
    IReadOnlyList<string>? Signals = null, double? Confidence = null, string? ConfidenceKind = null);
public sealed record BriefingCounts(int ActiveCases, int CriticalCases, int OutstandingCases, int LowStockItems, long ShelterCapacity,
    long ShelterOccupied, long ShelterReserved, int ActiveVolunteerTasks, int EscalatedCases, int NewCases = 0, int OpenShelters = 0,
    int TasksAwaitingReview = 0, int FulfilledCases = 0, int PartiallyFulfilledCases = 0, int CompletedVolunteerTasks = 0,
    IReadOnlyDictionary<string, int>? NeedsByCategory = null);
public sealed record AiDraft(string Text, string Source);
public sealed record SemanticVector(string Model, float[] Values);
public sealed record AlertPresentation(string Kind, string? Summary, string? Locality = null, string? Description = null);
public interface IAiProvider
{
    Task<AiResult> RecommendAsync(AssistanceRequest request, CancellationToken ct);
    Task<IntakeCategoryAssessment?> SuggestCategoryAsync(IReadOnlyList<IntakeCategoryClue> clues, CancellationToken ct,
        IntakeCategoryText? help = null) =>
        Task.FromResult<IntakeCategoryAssessment?>(null);
    Task<AiDraft?> DraftBriefingAsync(BriefingCounts counts, CancellationToken ct) => Task.FromResult<AiDraft?>(null);
    Task<AiDraft?> DraftTranslationAsync(string approvedPublicSource, string language, CancellationToken ct) => Task.FromResult<AiDraft?>(null);
    Task<AiDraft?> InterpretForecastAsync(ForecastSummary forecast, CancellationToken ct) => Task.FromResult<AiDraft?>(null);
    Task<AiDraft?> DraftCitizenCopyAsync(string status, string language, CancellationToken ct) => Task.FromResult<AiDraft?>(null);
    Task<AiDraft?> ExplainPortalGuidanceAsync(string approvedGuidance, string language, CancellationToken ct) => Task.FromResult<AiDraft?>(null);
    Task<SemanticVector?> EmbedAsync(AidCategory category, IReadOnlyList<string> signals, CancellationToken ct) => Task.FromResult<SemanticVector?>(null);
    Task<AiDraft?> ExtractTaskSkillAsync(string taskTitle, IReadOnlyList<string> skills, CancellationToken ct) => Task.FromResult<AiDraft?>(null);
    Task<AlertPresentation?> DescribePublicAlertAsync(string title, string message, string area, CancellationToken ct) => Task.FromResult<AlertPresentation?>(null);
    Task<byte[]?> IllustratePublicAlertAsync(string kind, string? locality, string country, CancellationToken ct) => Task.FromResult<byte[]?>(null);
}
public sealed record DeliveryResult(string State, string? Reference = null, string? Error = null);
public sealed record CitizenEmailUpdate(string Message, string Language = "en", Guid RequestId = default,
    string? Reference = null, RequestStatus? Status = null, bool Funding = false, string? ReviewedCopy = null)
{
    public static CitizenEmailUpdate FromOutbox(OutboxMessage entry, string language)
    {
        var (reference, status) = CitizenMessages.ReadQueuedStatus(entry.Message);
        var message = language switch
        {
            "si" when !string.IsNullOrWhiteSpace(entry.SinhalaMessage) => entry.SinhalaMessage,
            "ta" when !string.IsNullOrWhiteSpace(entry.TamilMessage) => entry.TamilMessage,
            "hi" or "ne" when status.HasValue && reference != null => CitizenMessages.Status(reference, status.Value, language),
            _ => entry.Message
        };
        return new CitizenEmailUpdate(message, language, entry.RequestId, reference, status, entry.FundingCountryCode != null,
            language == entry.CopyLanguage ? entry.ReviewedCopy : null);
    }
}

public interface IEmailProvider
{
    string Name
    {
        get;
    }
    Task<DeliveryResult> SendAsync(string email, CitizenEmailUpdate update, Guid eventId, CancellationToken ct);
}
public interface IMappingProvider
{
    Task<object?> GeocodeAsync(string query, CancellationToken ct, string countryCode = "LK");
    Task<object?> ReverseGeocodeAsync(double latitude, double longitude, CancellationToken ct, string? countryCode = null);
    Task<object?> RouteAsync(double startLat, double startLng, double endLat, double endLng, CancellationToken ct);
}

public sealed record PublicLookup(Guid Id, string Name);
public sealed record PublicLookups(List<PublicLookup> Crises, List<PublicLookup> Organisations);
public sealed record PublicShelter(Guid Id, string Name, string Address, double Latitude, double Longitude, int Capacity, int Reserved, int Occupancy, int Available, bool Accessible, bool Open, string Facilities, DateTimeOffset UpdatedAt);
