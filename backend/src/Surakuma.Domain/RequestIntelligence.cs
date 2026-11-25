namespace Surakuma.Domain;

public sealed class RequestAnalysisJob : Record
{
    public Guid RequestId { get; set; }
    public string State { get; set; } = "Queued";
    public int Attempts { get; set; }
    public DateTimeOffset AvailableAt { get; set; } = DateTimeOffset.UtcNow;
    public Guid? Lease { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public string? FailureReason { get; set; }
}

public sealed class RequestEmbedding : Record
{
    public Guid RequestId { get; set; }
    public string Model { get; set; } = "";
    public byte[] Vector { get; set; } = [];
}

public sealed class AiInvocation : Record
{
    public string Task { get; set; } = "";
    public string Provider { get; set; } = "";
    public string Model { get; set; } = "";
    public string State { get; set; } = "";
    public int ProcessingMs { get; set; }
    public int? InputTokens { get; set; }
    public int? OutputTokens { get; set; }
    public decimal? EstimatedUsd { get; set; }
    public string? FallbackReason { get; set; }
}

public sealed class CaseMessageDraft : Record
{
    public Guid RequestId { get; set; }
    public RequestStatus StatusSnapshot { get; set; }
    public string Audience { get; set; } = "";
    public string Language { get; set; } = "";
    public string Copy { get; set; } = "";
    public string Source { get; set; } = "";
    public string CreatedByUserId { get; set; } = "";
    public string? ReviewerUserId { get; set; }
    public DateTimeOffset? PublishedAt { get; set; }
}
