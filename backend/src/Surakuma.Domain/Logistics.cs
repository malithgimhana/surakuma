namespace Surakuma.Domain;

public sealed class Depot : Record
{
    public string CountryCode { get; set; } = "";
    public Guid OrganisationId { get; set; }
    public string Name { get; set; } = "";
    public string Location { get; set; } = "";
}

public sealed class CaseDispatch : Record
{
    public Guid RequestId { get; set; }
    public Guid CentreId { get; set; }
    public string Reference { get; set; } = "";
    public string DispatchedBy { get; set; } = "";
    public DateTimeOffset? ReceivedAt { get; set; }
    public string? ReceivedBy { get; set; }
    public string ReceiptNote { get; set; } = "";
}

public enum LogisticsOrderKind { Dispatch, Transfer }

public sealed class LogisticsOrder : Record
{
    public string Reference { get; set; } = "";
    public bool RequiresPacking { get; set; }
    public DateTimeOffset? PackedAt { get; set; }
    public string? PackedBy { get; set; }
    public DateTimeOffset? ScheduledArrivalAt { get; set; }
    public LogisticsOrderKind Kind { get; set; }
    public Guid ResourceId { get; set; }
    public Guid? DestinationResourceId { get; set; }
    public Guid? CrisisId { get; set; }
    public Guid? OperationalAreaId { get; set; }
    public string Origin { get; set; } = "";
    public string Destination { get; set; } = "";
    public decimal Quantity { get; set; }
    public AllocationStatus Status { get; set; } = AllocationStatus.Reserved;
    public string ActorId { get; set; } = "";
    public string Reason { get; set; } = "";
}

public sealed class CaseNeed : Record
{
    public Guid RequestId { get; set; }
    public string Name { get; set; } = "";
    public AidCategory Category { get; set; }
    public string Unit { get; set; } = "";
    public decimal RequiredQuantity { get; set; }
    public decimal ApprovedQuantity { get; set; }
    public decimal DeliveredQuantity { get; set; }
}

public sealed class LogisticsPreferences : Record
{
    public string UserId { get; set; } = "";
    public bool DispatchUpdates { get; set; } = true;
    public bool StockAlerts { get; set; } = true;
    public bool SupplyUpdates { get; set; } = true;
    public bool AssignmentUpdates { get; set; } = true;
}

public sealed class DeliveryConfirmation : Record
{
    public Guid? AllocationId { get; set; }
    public Guid? LogisticsOrderId { get; set; }
    public string Reference { get; set; } = "";
    public decimal ConfirmedQuantity { get; set; }
    public DateTimeOffset ReceivedAt { get; set; }
    public string ReceivedBy { get; set; } = "";
    public string Method { get; set; } = "";
    public string ActorId { get; set; } = "";
    public string Note { get; set; } = "";
    public string ExceptionDetail { get; set; } = "";
}
