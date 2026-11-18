namespace Surakuma.Domain;

public sealed class DemandForecast : Record
{
    public Guid CrisisId { get; set; }
    public Guid? RegionId { get; set; }
    public AidCategory Category { get; set; }
    public DateTimeOffset ObservedFrom { get; set; }
    public DateTimeOffset ForecastFrom { get; set; }
    public DateTimeOffset ForecastTo { get; set; }
    public string Model { get; set; } = "";
    public decimal? Estimate { get; set; }
    public string InputsJson { get; set; } = "";
    public string CreatedByUserId { get; set; } = "";
}

public sealed class CrisisBriefing : Record
{
    public Guid CrisisId { get; set; }
    public DateTimeOffset PeriodFrom { get; set; }
    public DateTimeOffset PeriodTo { get; set; }
    public string FactsJson { get; set; } = "";
    public string Draft { get; set; } = "";
    public string Source { get; set; } = "";
    public string CreatedByUserId { get; set; } = "";
    public string? ReviewerUserId { get; set; }
    public DateTimeOffset? ReviewedAt { get; set; }
    public string? ReviewNote { get; set; }
}

public enum InvestigationSeverity { Advisory, Elevated }
public enum InvestigationOutcome { Dismissed, Monitor, ActionRecorded }

public sealed class InvestigationFlag : Record
{
    public Guid? RequestId { get; set; }
    public Guid? DonationId { get; set; }
    public string Category { get; set; } = "";
    public InvestigationSeverity Severity { get; set; }
    public string Evidence { get; set; } = "";
    public InvestigationOutcome? Outcome { get; set; }
    public string? ReviewerUserId { get; set; }
    public DateTimeOffset? ReviewedAt { get; set; }
    public string? Resolution { get; set; }
}

public sealed class CaseConsolidation : Record
{
    public Guid OriginalRequestId { get; set; }
    public Guid PrimaryRequestId { get; set; }
    public string Reason { get; set; } = "";
    public string ActorId { get; set; } = "";
}
