namespace Surakuma.Domain;

public enum ContributionStatus { Offered, Accepted, InProgress, Fulfilled, Declined, Withdrawn }

public sealed class PartnerContribution : Record
{
    public Guid OrganisationId { get; set; }
    public string CountryCode { get; set; } = "";
    public string Title { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Unit { get; set; } = "";
    public decimal Quantity { get; set; }
    public decimal FulfilledQuantity { get; set; }
    public string Description { get; set; } = "";
    public ContributionStatus Status { get; set; }
}
