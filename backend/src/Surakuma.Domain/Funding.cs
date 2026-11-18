namespace Surakuma.Domain;

public enum DonationKind { Monetary, Material }
public enum DonationState { Pledged, Confirmed, Allocated, Distributed, Cancelled }

public sealed class DonorProfile : Record
{
    public string UserId { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string? OrganisationName { get; set; }
}

public sealed class FundingCampaign : Record
{
    public string CountryCode { get; set; } = "";
    public Guid OrganisationId { get; set; }
    public Guid? CrisisId { get; set; }
    public string Name { get; set; } = "";
    public string Purpose { get; set; } = "";
    public string Currency { get; set; } = "";
    public decimal Budget { get; set; }
    public bool Open { get; set; } = true;
}

public sealed class Donation : Record
{
    public Guid CampaignId { get; set; }
    public Guid DonorId { get; set; }
    public DonationKind Kind { get; set; }
    public AidCategory Category { get; set; }
    public string Unit { get; set; } = "";
    public decimal Amount { get; set; }
    public DonationState State { get; set; }
    public string? ReceiptReference { get; set; }
    public Guid? StockMovementId { get; set; }
    public Guid? ResourceId { get; set; }
}

public sealed class DonationAllocation : Record
{
    public Guid DonationId { get; set; }
    public Guid RequestId { get; set; }
    public decimal Amount { get; set; }
}

public sealed class DonationExpenditure : Record
{
    public Guid AllocationId { get; set; }
    public decimal Amount { get; set; }
    public string Reference { get; set; } = "";
    public Guid? DeliveryConfirmationId { get; set; }
}

public sealed class DonationEvent : Record
{
    public Guid DonationId { get; set; }
    public DonationState State { get; set; }
    public string Activity { get; set; } = "";
}
