namespace Surakuma.Domain;

public sealed class SupplyRequest : Record
{
    public string Reference { get; set; } = "";
    public string? LegacyReference { get; set; }
    public string CountryCode { get; set; } = "";
    public Guid RequestingOrganisationId { get; set; }
    public Guid TargetOrganisationId { get; set; }
    public Guid? ShelterId { get; set; }
    public Guid? CaseId { get; set; }
    public Guid? CrisisId { get; set; }
    public Guid? DestinationResourceId { get; set; }
    public AidCategory Category { get; set; }
    public string Unit { get; set; } = "";
    public decimal Quantity { get; set; }
    public decimal ReceivedQuantity { get; set; }
    public string Reason { get; set; } = "";
    public bool Cancelled { get; set; }
}

public sealed class PartnerStockReceipt : Record
{
    public Guid ContributionId { get; set; }
    public Guid StockMovementId { get; set; }
    public string Reference { get; set; } = "";
    public decimal Quantity { get; set; }
}
