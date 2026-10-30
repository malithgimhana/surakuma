using System.ComponentModel.DataAnnotations;
using Surakuma.Domain;

namespace Surakuma.Application;

public sealed record RegisterInput([Required, EmailAddress] string Email, [Required, MinLength(10)] string Password, [Required, MaxLength(100)] string Name, string Language = "en");
public sealed record LoginInput([Required, EmailAddress] string Email, [Required] string Password);
public sealed record ProfileInput([Required, MaxLength(100)] string Name, string Language, [Range(1, 50)] int HouseholdSize, [MaxLength(500)] string AccessibilityNeeds);
public sealed record CreateRequestInput(Guid CrisisId, Guid OrganisationId, AidCategory Category, Priority Priority,
    [Required, MinLength(10), MaxLength(4000)] string Description, [Required, MaxLength(500)] string LocationText,
    double? Latitude, double? Longitude, [Range(1, 50)] int HouseholdSize, [MaxLength(500)] string AccessibilityNeeds,
    [Range(typeof(decimal), "0.01", "100000")] decimal Quantity, [Required, MaxLength(100)] string SubmissionKey, bool Synthetic);
public sealed record StatusInput(RequestStatus Status, [MaxLength(1000)] string Reason = "");
public sealed record DecisionInput(Guid RecommendationId, string Action, Priority? FinalPriority, AidCategory? FinalCategory, [MaxLength(1000)] string Reason);
public sealed record ResourceInput(Guid OrganisationId, [Required, MaxLength(100)] string Name, AidCategory Category, [Required] string Unit, [Range(typeof(decimal), "0", "10000000")] decimal Stock, string LocationText, [Range(-90d, 90d)] double Latitude, [Range(-180d, 180d)] double Longitude, string Suitability, bool TransportAvailable);
public sealed record AllocateInput(Guid RequestId, Guid ResourceId, [Range(typeof(decimal), "0.01", "100000")] decimal Quantity);
public sealed record MovementInput([Range(typeof(decimal), "0.01", "100000")] decimal Quantity, string Note);
public sealed record ShelterInput(Guid OrganisationId, [Required, MaxLength(150)] string Name, string Address, [Range(-90d, 90d)] double Latitude, [Range(-180d, 180d)] double Longitude, [Range(1, 100000)] int Capacity, bool Accessible, bool Open, string Facilities);
public sealed record ShelterPlaceInput(Guid RequestId, Guid ShelterId);
public sealed record TaskInput(Guid RequestId, Guid VolunteerId, [Required] string Title, string RequiredSkill, DateTimeOffset DueAt);
public sealed record TaskUpdateInput(string Action, string Note = "");
public sealed record FeedbackInput([Range(1, 5)] int Rating, bool Received, bool Problem, [MaxLength(2000)] string Comment);
public sealed record ShareInput(Guid OrganisationId);
public sealed record StaffInput([Required, EmailAddress] string Email, [Required, MinLength(10)] string Password, [Required] string Name, Guid OrganisationId, [Required] string Role, Guid? CrisisId);
public sealed record AiResult(AidCategory Category, Priority Priority, string Explanation, string Provider, string Model, bool Fallback);
public interface IAiProvider
{
    Task<AiResult> RecommendAsync(AssistanceRequest request, CancellationToken ct);
}
public sealed record DeliveryResult(string State, string? Reference = null, string? Error = null);
public interface IEmailProvider
{
    string Name
    {
        get;
    }
    Task<DeliveryResult> SendAsync(string email, string message, Guid eventId, CancellationToken ct);
}
public interface IMappingProvider
{
    Task<object?> GeocodeAsync(string query, CancellationToken ct); Task<object?> RouteAsync(double startLat, double startLng, double endLat, double endLng, CancellationToken ct);
}
