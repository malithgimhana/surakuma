namespace Surakuma.Domain;

public sealed class AdminProposal : Record
{
    public string Kind { get; set; } = "";
    public string CountryCode { get; set; } = "";
    public string RequesterUserId { get; set; } = "";
    public string? ReviewerUserId { get; set; }
    public string Payload { get; set; } = "";
    public string OriginalVersion { get; set; } = "";
    public string Reason { get; set; } = "";
    public string DecisionReason { get; set; } = "";
    public string State { get; set; } = "Pending";
    public DateTimeOffset ExpiresAt { get; set; } = DateTimeOffset.UtcNow.AddDays(7);
}

public sealed class AdminAlert : Record
{
    public string ConditionKey { get; set; } = "";
    public string? CountryCode { get; set; }
    public string Message { get; set; } = "";
    public string Link { get; set; } = "";
    public string? AcknowledgedBy { get; set; }
    public DateTimeOffset? AcknowledgedAt { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
}

public sealed class DeliveryAttempt : Record
{
    public Guid EventId { get; set; }
    public int Number { get; set; }
    public string State { get; set; } = "Processing";
    public string? Error { get; set; }
    public string? ProviderReference { get; set; }
}

public sealed class ServiceObservation : Record
{
    public string Service { get; set; } = "";
    public bool Success { get; set; }
    public string? ActorId { get; set; }
}
public enum SecurityEmailKind { PasswordReset, StaffInvitation }

public sealed class SecurityEmail : Record
{
    public string UserId { get; set; } = "";
    public SecurityEmailKind Kind { get; set; } = SecurityEmailKind.PasswordReset;
    public string ProtectedToken { get; set; } = "";
    public string State { get; set; } = "Pending";
    public DateTimeOffset ExpiresAt { get; set; } = DateTimeOffset.UtcNow.AddHours(1);
}
