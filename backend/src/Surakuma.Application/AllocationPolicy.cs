using Surakuma.Domain;
namespace Surakuma.Application;

public interface IAllocationPolicy
{
    void Validate(AssistanceRequest request, Resource resource, decimal quantity, decimal committed);
}
public sealed class ConstraintAllocationPolicy : IAllocationPolicy
{
    public void Validate(AssistanceRequest request, Resource resource, decimal quantity, decimal committed)
    {
        if (request.Status is not (RequestStatus.Approved or RequestStatus.InProgress or RequestStatus.PartiallyFulfilled))
            throw new RuleException("Verify and approve this case before allocating aid.");
        if (resource.Category != request.Category)
            throw new RuleException("The resource category does not match this request.");
        if (request.Category == AidCategory.Shelter)
            throw new RuleException("Use the household placement workflow for shelter requests.");
        if (request.UnitRequiresClarification)
            throw new RuleException("Clarify the requested unit before reserving aid.");
        if (!QuantityUnits.Compatible(resource.Unit, request.Unit))
            throw new RuleException("The stock unit is incompatible with the requested unit.");
        QuantityUnits.ValidateInventory(quantity, resource.Unit);
        if (!resource.TransportAvailable)
            throw new RuleException("Transport is unavailable for this resource.");
        if (quantity <= 0 || quantity > resource.Available)
            throw new RuleException("Insufficient available stock; allocate a smaller amount or escalate the shortage.");
        if (QuantityUnits.Convert(quantity, resource.Unit, request.Unit) > request.Quantity - request.DeliveredQuantity - committed)
            throw new RuleException("Allocation exceeds outstanding unallocated quantity.");
    }
}
public static class CitizenMessages
{
    public static string Status(string reference, RequestStatus state, string language)
    {
        var translated = language switch
        {
            "si" => state switch { RequestStatus.Submitted => "ඉල්ලීම ලැබී ඇත", RequestStatus.UnderReview => "සමාලෝචනය වෙමින් පවතී", RequestStatus.Verified => "තහවුරු කර ඇත", RequestStatus.Approved => "අනුමත කර ඇත", RequestStatus.InProgress => "සහාය සූදානම් කරමින් පවතී", RequestStatus.PartiallyFulfilled => "සහායෙන් කොටසක් ලබාදී ඇත", RequestStatus.Fulfilled => "සහාය ලබාදී ඇත", RequestStatus.Closed => "සම්පූර්ණ කර ඇත", RequestStatus.Cancelled => "අවලංගු කර ඇත", _ => "අනුමත නොවීය" },
            "ta" => state switch { RequestStatus.Submitted => "கோரிக்கை பெறப்பட்டது", RequestStatus.UnderReview => "பரிசீலனையில் உள்ளது", RequestStatus.Verified => "சரிபார்க்கப்பட்டது", RequestStatus.Approved => "அங்கீகரிக்கப்பட்டது", RequestStatus.InProgress => "உதவி ஏற்பாடு செய்யப்படுகிறது", RequestStatus.PartiallyFulfilled => "உதவி பகுதியாக வழங்கப்பட்டது", RequestStatus.Fulfilled => "உதவி வழங்கப்பட்டது", RequestStatus.Closed => "நிறைவடைந்தது", RequestStatus.Cancelled => "ரத்துசெய்யப்பட்டது", _ => "அங்கீகரிக்கப்படவில்லை" },
            "hi" => state switch { RequestStatus.Submitted => "अनुरोध प्राप्त हुआ", RequestStatus.UnderReview => "अनुरोध की समीक्षा जारी है", RequestStatus.Verified => "अनुरोध का सत्यापन हो गया", RequestStatus.Approved => "सहायता के लिए स्वीकृत", RequestStatus.InProgress => "सहायता की व्यवस्था हो रही है", RequestStatus.PartiallyFulfilled => "कुछ सहायता दी गई", RequestStatus.Fulfilled => "सहायता दी गई", RequestStatus.Closed => "अनुरोध बंद कर दिया गया", RequestStatus.Cancelled => "अनुरोध रद्द कर दिया गया", _ => "अनुरोध स्वीकृत नहीं हुआ" },
            "ne" => state switch { RequestStatus.Submitted => "अनुरोध प्राप्त भयो", RequestStatus.UnderReview => "अनुरोधको समीक्षा भइरहेको छ", RequestStatus.Verified => "अनुरोध प्रमाणित भयो", RequestStatus.Approved => "सहायताका लागि स्वीकृत", RequestStatus.InProgress => "सहायताको व्यवस्था भइरहेको छ", RequestStatus.PartiallyFulfilled => "केही सहायता उपलब्ध गराइयो", RequestStatus.Fulfilled => "सहायता उपलब्ध गराइयो", RequestStatus.Closed => "अनुरोध बन्द गरिएको छ", RequestStatus.Cancelled => "अनुरोध रद्द गरिएको छ", _ => "अनुरोध स्वीकृत भएन" },
            _ => EnglishStatus(state)
        };
        return $"{reference}: {translated}.";
    }

    public static (string? Reference, RequestStatus? Status) ReadQueuedStatus(string message)
    {
        // The canonical English outbox text records the status at the time of the event.
        int separator = message.IndexOf(": ", StringComparison.Ordinal);
        if (separator > 0 && message.EndsWith('.'))
        {
            var description = message.AsSpan(separator + 2, message.Length - separator - 3);
            foreach (var status in Enum.GetValues<RequestStatus>())
                if (description.SequenceEqual(EnglishStatus(status)))
                    return (message[..separator], status);
        }
        return (null, null);
    }

    // Keep these descriptions compatible with existing queued notifications.
    private static string EnglishStatus(RequestStatus status) => status switch
    {
        RequestStatus.Submitted => "We have received your request and it is awaiting review",
        RequestStatus.UnderReview => "Your request is being reviewed",
        RequestStatus.Verified => "The details of your request have been verified",
        RequestStatus.Approved => "Your request has been approved for assistance",
        RequestStatus.InProgress => "Your assistance is being arranged",
        RequestStatus.PartiallyFulfilled => "Some of your requested assistance has been delivered",
        RequestStatus.Fulfilled => "Your requested assistance has been delivered",
        RequestStatus.Closed => "Your request has been closed",
        RequestStatus.Rejected => "Your request was not approved",
        RequestStatus.Cancelled => "Your request has been cancelled",
        _ => "Your request has been updated"
    };
}
