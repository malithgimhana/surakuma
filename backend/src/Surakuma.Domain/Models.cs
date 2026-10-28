namespace Surakuma.Domain;

public static class Roles
{
    public const string Citizen = "Citizen", Coordinator = "Coordinator", CaseManager = "CaseManager",
        Logistics = "Logistics", ShelterAdmin = "ShelterAdmin", VolunteerCoordinator = "VolunteerCoordinator",
        Volunteer = "Volunteer", Partner = "Partner", Administrator = "Administrator";
    public static readonly string[] All = [Citizen, Coordinator, CaseManager, Logistics, ShelterAdmin, VolunteerCoordinator, Volunteer, Partner, Administrator];
}
public enum RequestStatus
{
    Submitted, UnderReview, Verified, Approved, InProgress, PartiallyFulfilled, Fulfilled, Closed, Rejected, Cancelled
}
public enum AidCategory
{
    FoodWater, Medical, Shelter, Transportation, Accessibility, Other
}
public enum Priority
{
    Low, Normal, High, Critical
}
public enum AllocationStatus
{
    Reserved, Dispatched, Delivered, Cancelled
}
public enum StayStatus
{
    Reserved, CheckedIn, Departed, Cancelled
}
public enum TaskStatus
{
    Assigned, Accepted, Declined, InProgress, AwaitingVerification, Completed
}
public sealed class RuleException(string message) : Exception(message);

public abstract class Record
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public byte[] Version { get; set; } = [];
}
public sealed class Organisation : Record
{
    public string Name { get; set; } = "";
}
public sealed class Membership : Record
{
    public string UserId { get; set; } = ""; public Guid OrganisationId
    {
        get; set;
    }
    public string Role { get; set; } = "";
}
public sealed class Crisis : Record
{
    public string Name { get; set; } = ""; public string Type { get; set; } = "Flood";
    public string District { get; set; } = ""; public bool Active { get; set; } = true;
    public double Latitude
    {
        get; set;
    }
    public double Longitude
    {
        get; set;
    }
}
public sealed class CrisisAssignment : Record
{
    public Guid CrisisId
    {
        get; set;
    }
    public string UserId { get; set; } = "";
}
public sealed class OperationalArea : Record
{
    public Guid CrisisId
    {
        get; set;
    }
    public string Name { get; set; } = ""; public string GeoJson { get; set; } = "";
}
public sealed class CaseShare : Record
{
    public Guid RequestId
    {
        get; set;
    }
    public Guid OrganisationId
    {
        get; set;
    }
}
public sealed class Household : Record
{
    public string UserId { get; set; } = ""; public int Size { get; set; } = 1; public string AccessibilityNeeds { get; set; } = "";
}
public sealed class AssistanceRequest : Record
{
    public string Reference { get; set; } = "SK-" + Guid.NewGuid().ToString("N")[..10].ToUpperInvariant();
    public string CitizenId { get; set; } = ""; public Guid CrisisId
    {
        get; set;
    }
    public Guid OrganisationId
    {
        get; set;
    }
    public AidCategory Category
    {
        get; set;
    }
    public Priority Priority { get; set; } = Priority.Normal;
    public string Description { get; set; } = ""; public string LocationText { get; set; } = "";
    public double? Latitude
    {
        get; set;
    }
    public double? Longitude
    {
        get; set;
    }
    public int HouseholdSize { get; set; } = 1; public string AccessibilityNeeds { get; set; } = "";
    public decimal Quantity { get; set; } = 1; public decimal DeliveredQuantity
    {
        get; set;
    }
    public RequestStatus Status { get; set; } = RequestStatus.Submitted;
    public bool Escalated
    {
        get; set;
    }
    public bool Synthetic
    {
        get; set;
    }
    public string SubmissionKey { get; set; } = "";
    public void Transition(RequestStatus next, string? reason = null)
    {
        bool allowed = next switch
        {
            RequestStatus.UnderReview => Status == RequestStatus.Submitted,
            RequestStatus.Verified => Status == RequestStatus.UnderReview,
            RequestStatus.Approved => Status == RequestStatus.Verified,
            RequestStatus.InProgress => Status is RequestStatus.Approved or RequestStatus.PartiallyFulfilled,
            RequestStatus.Closed => Status == RequestStatus.Fulfilled,
            RequestStatus.Rejected => Status is RequestStatus.UnderReview or RequestStatus.Verified,
            RequestStatus.Cancelled => Status is RequestStatus.Submitted or RequestStatus.UnderReview or RequestStatus.Verified or RequestStatus.Approved,
            _ => false
        };
        if (!allowed)
            throw new RuleException($"Cannot move a request from {Status} to {next}.");
        if (next is RequestStatus.Rejected or RequestStatus.Cancelled && string.IsNullOrWhiteSpace(reason))
            throw new RuleException("A reason is required.");
        Status = next;
        UpdatedAt = DateTimeOffset.UtcNow;
    }
    public void Deliver(decimal quantity)
    {
        if (quantity <= 0 || DeliveredQuantity + quantity > Quantity)
            throw new RuleException("Delivery exceeds outstanding quantity.");
        DeliveredQuantity += quantity;
        Status = DeliveredQuantity == Quantity ? RequestStatus.Fulfilled : RequestStatus.PartiallyFulfilled;
        UpdatedAt = DateTimeOffset.UtcNow;
    }
}
public sealed class RequestHistory : Record
{
    public Guid RequestId
    {
        get; set;
    }
    public string ActorId { get; set; } = ""; public string Status { get; set; } = ""; public string Note { get; set; } = "";
}
public sealed class Attachment : Record
{
    public Guid RequestId
    {
        get; set;
    }
    public string StoredName { get; set; } = ""; public string OriginalName { get; set; } = ""; public string ContentType { get; set; } = ""; public long Size
    {
        get; set;
    }
}
public sealed class Recommendation : Record
{
    public Guid RequestId
    {
        get; set;
    }
    public AidCategory Category
    {
        get; set;
    }
    public Priority Priority
    {
        get; set;
    }
    public string Explanation { get; set; } = ""; public string Provider { get; set; } = ""; public string Model { get; set; } = "";
    public double? Confidence
    {
        get; set;
    }
    public string ConfidenceKind { get; set; } = "Unavailable";
    public bool Fallback
    {
        get; set;
    }
    public string ReviewState { get; set; } = "Pending";
}
public sealed class HumanDecision : Record
{
    public Guid RecommendationId
    {
        get; set;
    }
    public Guid RequestId
    {
        get; set;
    }
    public string ActorId { get; set; } = ""; public string Action { get; set; } = ""; public string Reason { get; set; } = ""; public Priority? FinalPriority
    {
        get; set;
    }
}
public sealed class PotentialDuplicate : Record
{
    public Guid RequestId
    {
        get; set;
    }
    public Guid CandidateId
    {
        get; set;
    }
    public double Similarity
    {
        get; set;
    }
    public string State { get; set; } = "Pending"; public string Reason { get; set; } = "";
}
public sealed class Resource : Record
{
    public Guid OrganisationId
    {
        get; set;
    }
    public string Name { get; set; } = ""; public AidCategory Category
    {
        get; set;
    }
    public string Unit { get; set; } = "packs"; public decimal Stock
    {
        get; set;
    }
    public decimal Reserved
    {
        get; set;
    }
    public string LocationText { get; set; } = ""; public double Latitude
    {
        get; set;
    }
    public double Longitude
    {
        get; set;
    }
    public string Suitability { get; set; } = ""; public bool TransportAvailable { get; set; } = true;
    public decimal Available => Stock - Reserved;
    public void Reserve(decimal quantity)
    {
        if (quantity <= 0 || quantity > Available)
            throw new RuleException("Insufficient available stock.");
        Reserved += quantity;
    }
    public void Dispatch(decimal quantity)
    {
        if (quantity <= 0 || quantity > Reserved || quantity > Stock)
            throw new RuleException("Invalid dispatch quantity.");
        Reserved -= quantity;
        Stock -= quantity;
    }
    public void Release(decimal quantity)
    {
        if (quantity <= 0 || quantity > Reserved)
            throw new RuleException("Invalid release quantity.");
        Reserved -= quantity;
    }
}
public sealed class ResourceAllocation : Record
{
    public Guid RequestId
    {
        get; set;
    }
    public Guid ResourceId
    {
        get; set;
    }
    public decimal Quantity
    {
        get; set;
    }
    public AllocationStatus Status
    {
        get; set;
    }
    public string ApprovedBy { get; set; } = "";
}
public sealed class StockMovement : Record
{
    public Guid ResourceId
    {
        get; set;
    }
    public decimal Quantity
    {
        get; set;
    }
    public string Kind { get; set; } = ""; public string ActorId { get; set; } = ""; public string Note { get; set; } = "";
}
public sealed class Shelter : Record
{
    public Guid OrganisationId
    {
        get; set;
    }
    public string Name { get; set; } = ""; public string Address { get; set; } = "";
    public double Latitude
    {
        get; set;
    }
    public double Longitude
    {
        get; set;
    }
    public int Capacity
    {
        get; set;
    }
    public int Reserved
    {
        get; set;
    }
    public int Occupancy
    {
        get; set;
    }
    public bool Accessible
    {
        get; set;
    }
    public bool Open { get; set; } = true; public string Facilities { get; set; } = "Water, toilets";
    public int Available => Capacity - Reserved - Occupancy;
    public void Reserve(int count)
    {
        if (!Open || count < 1 || count > Available)
            throw new RuleException("Shelter cannot accommodate this household.");
        Reserved += count;
    }
    public void CheckIn(int count)
    {
        if (count < 1 || count > Reserved)
            throw new RuleException("Invalid reservation.");
        Reserved -= count;
        Occupancy += count;
    }
    public void Release(int count, bool checkedIn)
    {
        if (count < 1 || (checkedIn ? Occupancy : Reserved) < count)
            throw new RuleException("Invalid placement.");
        if (checkedIn)
            Occupancy -= count;
        else
            Reserved -= count;
    }
}
public sealed class ShelterAllocation : Record
{
    public Guid ShelterId
    {
        get; set;
    }
    public Guid RequestId
    {
        get; set;
    }
    public int People
    {
        get; set;
    }
    public StayStatus Status
    {
        get; set;
    }
    public string ApprovedBy { get; set; } = "";
}
public sealed class VolunteerProfile : Record
{
    public string UserId { get; set; } = ""; public Guid OrganisationId
    {
        get; set;
    }
    public string Skills { get; set; } = ""; public string Availability { get; set; } = ""; public bool Verified
    {
        get; set;
    }
    public bool Available { get; set; } = true;
}
public sealed class VolunteerTask : Record
{
    public Guid RequestId
    {
        get; set;
    }
    public Guid VolunteerId
    {
        get; set;
    }
    public string Title { get; set; } = ""; public string RequiredSkill { get; set; } = ""; public string Note { get; set; } = ""; public TaskStatus Status
    {
        get; set;
    }
    public DateTimeOffset DueAt
    {
        get; set;
    }
}
public sealed class PublicAlert : Record
{
    public Guid CrisisId
    {
        get; set;
    }
    public string Title { get; set; } = ""; public string Message { get; set; } = ""; public string SinhalaTitle { get; set; } = ""; public string SinhalaMessage { get; set; } = ""; public string TamilTitle { get; set; } = ""; public string TamilMessage { get; set; } = ""; public string Severity { get; set; } = "Information"; public string Area { get; set; } = ""; public string Authority { get; set; } = ""; public DateTimeOffset ExpiresAt
    {
        get; set;
    }
    public bool Published
    {
        get; set;
    }
}
public sealed class Notification : Record
{
    public string UserId { get; set; } = ""; public Guid EventId
    {
        get; set;
    }
    public Guid? RequestId
    {
        get; set;
    }
    public string Message { get; set; } = ""; public string SinhalaMessage { get; set; } = ""; public string TamilMessage { get; set; } = ""; public bool Read
    {
        get; set;
    }
}
public sealed class OutboxMessage : Record
{
    public string UserId { get; set; } = ""; public Guid RequestId
    {
        get; set;
    }
    public string Message { get; set; } = ""; public string SinhalaMessage { get; set; } = ""; public string TamilMessage { get; set; } = ""; public string State { get; set; } = "Pending"; public int Attempts
    {
        get; set;
    }
    public DateTimeOffset NextAttemptAt { get; set; } = DateTimeOffset.UtcNow; public string? LastError
    {
        get; set;
    }
}
public sealed class NotificationDelivery : Record
{
    public Guid EventId
    {
        get; set;
    }
    public string RecipientId { get; set; } = ""; public string Provider { get; set; } = ""; public string State { get; set; } = "Pending"; public string? ProviderReference
    {
        get; set;
    }
}
public sealed class AuditEvent : Record
{
    public string ActorId { get; set; } = ""; public string Action { get; set; } = ""; public string EntityType { get; set; } = ""; public Guid EntityId
    {
        get; set;
    }
    public string Detail { get; set; } = "";
}
public sealed class Feedback : Record
{
    public Guid RequestId
    {
        get; set;
    }
    public string UserId { get; set; } = ""; public int Rating
    {
        get; set;
    }
    public bool Received
    {
        get; set;
    }
    public bool Problem
    {
        get; set;
    }
    public string Comment { get; set; } = "";
}
