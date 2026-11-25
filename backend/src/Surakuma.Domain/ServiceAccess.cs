namespace Surakuma.Domain;

public sealed class AssistanceCentre : Record
{
    public string CountryCode { get; set; } = "";
    public Guid OrganisationId { get; set; }
    public Guid? DepotId { get; set; }
    public string Name { get; set; } = "";
    public string Address { get; set; } = "";
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public string Services { get; set; } = "";
    public string Facilities { get; set; } = "";
    public string OpeningHours { get; set; } = "";
    public bool Accessible { get; set; }
    public int? Capacity { get; set; }
    public bool Published { get; set; }
}

public sealed class VolunteerAvailabilityWindow : Record
{
    public string UserId { get; set; } = "";
    public DateTimeOffset StartsAt { get; set; }
    public DateTimeOffset EndsAt { get; set; }
}

public sealed class BrowserPushSubscription : Record
{
    public string UserId { get; set; } = "";
    public string Endpoint { get; set; } = "";
    public string EndpointHash { get; set; } = "";
    public string PublicKey { get; set; } = "";
    public string AuthSecret { get; set; } = "";
    public DateTimeOffset EnabledAt { get; set; }
}

public sealed class BrowserPushDelivery : Record
{
    public Guid SubscriptionId { get; set; }
    public Guid NotificationId { get; set; }
    public string State { get; set; } = "Sending";
    public int Attempts { get; set; } = 1;
    public DateTimeOffset? NextAttemptAt { get; set; }
}
