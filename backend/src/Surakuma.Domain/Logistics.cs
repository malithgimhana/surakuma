namespace Surakuma.Domain;

public sealed class Depot : Record
{
    public string CountryCode { get; set; } = "";
    public Guid OrganisationId { get; set; }
    public string Name { get; set; } = "";
    public string Location { get; set; } = "";
}

public enum LogisticsOrderKind { Dispatch, Transfer }

public sealed class LogisticsOrder : Record
{
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
