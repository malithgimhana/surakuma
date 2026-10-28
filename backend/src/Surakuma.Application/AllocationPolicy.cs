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
        if (!resource.TransportAvailable)
            throw new RuleException("Transport is unavailable for this resource.");
        if (quantity <= 0 || quantity > resource.Available)
            throw new RuleException("Insufficient available stock; allocate a smaller amount or escalate the shortage.");
        if (quantity > request.Quantity - request.DeliveredQuantity - committed)
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
            _ => state.ToString()
        };
        return $"{reference}: {translated}.";
    }
}
