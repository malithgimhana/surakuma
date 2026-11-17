namespace Surakuma.Domain;

public static class CaseReporting
{
    public static readonly RequestStatus[] Ended =
        [RequestStatus.Fulfilled, RequestStatus.Closed, RequestStatus.Rejected, RequestStatus.Cancelled];

    public static DateTimeOffset OverdueBefore(DateTimeOffset now) => now.AddHours(-24);
}
