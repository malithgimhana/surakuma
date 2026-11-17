using Surakuma.Domain;

namespace Surakuma.Infrastructure;

internal static class CitizenEmailCopy
{
    internal sealed record Stage(string Label, string Heading, string Message);
    internal sealed record Labels(string Update, string Heading, string Reference, string Status,
        string ViewRequest, string ViewRequests, string SignIn, string Footer);

    internal static Labels For(string language) => language switch
    {
        "si" => new("ඉල්ලීමේ යාවත්කාලීනය", "ඔබගේ ඉල්ලීම පිළිබඳ යාවත්කාලීනයක්",
            "යොමු අංකය", "තත්ත්වය", "මගේ ඉල්ලීම බලන්න", "මගේ ඉල්ලීම් බලන්න",
            "ඔබගේ ඉල්ලීම බැලීමට සුරැකුම ගිණුමට පිවිසෙන්න.", "ස්වයංක්‍රීය ඉල්ලීම් යාවත්කාලීනය"),
        "ta" => new("கோரிக்கை புதுப்பிப்பு", "உங்கள் கோரிக்கை பற்றிய புதுப்பிப்பு",
            "குறிப்பு எண்", "நிலை", "கோரிக்கையைக் காணுங்கள்", "எனது கோரிக்கைகள்",
            "உங்கள் கோரிக்கையைப் பார்க்க உங்கள் சுரகும கணக்கில் உள்நுழையவும்.", "தானியங்கி கோரிக்கை புதுப்பிப்பு"),
        _ => new("Request update", "An update on your request", "Reference", "Status",
            "View my request", "View my requests", "Sign in to Surakuma to view your request.",
            "Automated request update")
    };

    internal static Stage? ForStatus(RequestStatus? status, string language) => language switch
    {
        "si" => Sinhala(status),
        "ta" => Tamil(status),
        _ => English(status)
    };

    internal static string Color(RequestStatus? status) => status switch
    {
        RequestStatus.UnderReview or RequestStatus.PartiallyFulfilled => "#8a490c",
        RequestStatus.Verified => "#5a3aa0",
        RequestStatus.Approved or RequestStatus.Fulfilled => "#176449",
        RequestStatus.InProgress => "#096477",
        RequestStatus.Closed => "#304e71",
        RequestStatus.Rejected => "#963c45",
        RequestStatus.Cancelled => "#4d576e",
        _ => "#2159a5"
    };

    private static Stage? English(RequestStatus? status) => status switch
    {
        RequestStatus.Submitted => new("Received", "We received your request",
            "Your assistance request has been submitted. A team member will review it."),
        RequestStatus.UnderReview => new("Under review", "Your request is under review",
            "Our team is reviewing your request. You can follow updates in your Surakuma account."),
        RequestStatus.Verified => new("Verified", "Your request details are verified",
            "Our team has verified the details you provided. Your request is ready for an assistance decision."),
        RequestStatus.Approved => new("Approved", "Your request was approved",
            "Your request has been approved for assistance. Check your account for updates as arrangements are made."),
        RequestStatus.InProgress => new("In progress", "We’re arranging your assistance",
            "Arrangements for your assistance are underway. Check your account for the latest details."),
        RequestStatus.PartiallyFulfilled => new("Partially fulfilled", "Some assistance has been delivered",
            "Part of your requested assistance has been delivered. Check your request to see what’s still outstanding."),
        RequestStatus.Fulfilled => new("Fulfilled", "Your assistance has been delivered",
            "Your request is marked as fulfilled. You can review the assistance recorded for this request in your account."),
        RequestStatus.Closed => new("Closed", "Your request is closed",
            "This assistance request has been closed. Its history is available in your Surakuma account."),
        RequestStatus.Rejected => new("Not approved", "Your request was not approved",
            "A decision has been made on your assistance request. Sign in to review your request and any available details."),
        RequestStatus.Cancelled => new("Cancelled", "Your request was cancelled",
            "This assistance request has been cancelled. You can still view the request in your Surakuma account."),
        _ => null
    };

    private static Stage? Sinhala(RequestStatus? status) => status switch
    {
        RequestStatus.Submitted => new("ලැබී ඇත", "ඔබගේ ඉල්ලීම අපට ලැබී ඇත",
            "ඔබගේ සහාය ඉල්ලීම ඉදිරිපත් කර ඇත. අපගේ කණ්ඩායමේ සාමාජිකයෙකු එය සමාලෝචනය කරනු ඇත."),
        RequestStatus.UnderReview => new("සමාලෝචනය වෙමින් පවතී", "ඔබගේ ඉල්ලීම සමාලෝචනය වෙමින් පවතී",
            "අපගේ කණ්ඩායම ඔබගේ ඉල්ලීම සමාලෝචනය කරමින් සිටී. ඔබගේ සුරැකුම ගිණුමෙන් යාවත්කාලීන තොරතුරු බැලිය හැකිය."),
        RequestStatus.Verified => new("තහවුරු කර ඇත", "ඔබගේ ඉල්ලීමේ විස්තර තහවුරු කර ඇත",
            "අපගේ කණ්ඩායම ඔබ ලබා දුන් විස්තර තහවුරු කර ඇත. සහාය ලබා දීම පිළිබඳ තීරණයක් ගැනීමට ඔබගේ ඉල්ලීම සූදානම්ය."),
        RequestStatus.Approved => new("අනුමත කර ඇත", "ඔබගේ ඉල්ලීම අනුමත කර ඇත",
            "සහාය ලබා දීම සඳහා ඔබගේ ඉල්ලීම අනුමත කර ඇත. සහාය සූදානම් කරන අතරතුර නව තොරතුරු සඳහා ඔබගේ ගිණුම බලන්න."),
        RequestStatus.InProgress => new("සහාය සූදානම් වෙමින් පවතී", "අපි ඔබට සහාය ලබා දීමට සූදානම් වෙමින් සිටිමු",
            "ඔබට සහාය ලබා දීම සඳහා කටයුතු සිදු වෙමින් පවතී. නවතම විස්තර සඳහා ඔබගේ ගිණුම බලන්න."),
        RequestStatus.PartiallyFulfilled => new("සහායෙන් කොටසක් ලබා දී ඇත", "ඔබ ඉල්ලූ සහායෙන් කොටසක් ලබා දී ඇත",
            "ඔබ ඉල්ලූ සහායෙන් කොටසක් ලබා දී ඇත. තවමත් ලබා දීමට ඇති සහාය පිළිබඳ විස්තර ඔබගේ ඉල්ලීමෙන් බලන්න."),
        RequestStatus.Fulfilled => new("සහාය ලබා දී ඇත", "ඔබ ඉල්ලූ සහාය ලබා දී ඇත",
            "ඔබගේ ඉල්ලීම ඉටු කර ඇති බව සටහන් කර ඇත. ලබා දුන් සහාය පිළිබඳ විස්තර ඔබගේ ගිණුමෙන් බැලිය හැකිය."),
        RequestStatus.Closed => new("වසා ඇත", "ඔබගේ ඉල්ලීම වසා ඇත",
            "මෙම සහාය ඉල්ලීම වසා ඇත. එහි පෙර තොරතුරු ඔබගේ සුරැකුම ගිණුමෙන් බැලිය හැකිය."),
        RequestStatus.Rejected => new("අනුමත වී නැත", "ඔබගේ ඉල්ලීම අනුමත වී නැත",
            "ඔබගේ සහාය ඉල්ලීම පිළිබඳ තීරණයක් ගෙන ඇත. ඉල්ලීම සහ තිබෙන විස්තර බැලීමට ඔබගේ ගිණුමට පිවිසෙන්න."),
        RequestStatus.Cancelled => new("අවලංගු කර ඇත", "ඔබගේ ඉල්ලීම අවලංගු කර ඇත",
            "මෙම සහාය ඉල්ලීම අවලංගු කර ඇත. ඔබගේ සුරැකුම ගිණුමෙන් එය තවමත් බැලිය හැකිය."),
        _ => null
    };

    private static Stage? Tamil(RequestStatus? status) => status switch
    {
        RequestStatus.Submitted => new("பெறப்பட்டது", "உங்கள் கோரிக்கை எங்களுக்குக் கிடைத்தது",
            "உங்கள் உதவிக் கோரிக்கை சமர்ப்பிக்கப்பட்டுள்ளது. எங்கள் குழுவில் ஒருவர் அதைப் பரிசீலிப்பார்."),
        RequestStatus.UnderReview => new("பரிசீலனையில் உள்ளது", "உங்கள் கோரிக்கை பரிசீலனையில் உள்ளது",
            "எங்கள் குழு உங்கள் கோரிக்கையைப் பரிசீலித்து வருகிறது. புதுப்பிப்புகளை உங்கள் சுரகும கணக்கில் பார்க்கலாம்."),
        RequestStatus.Verified => new("சரிபார்க்கப்பட்டது", "உங்கள் கோரிக்கையின் விவரங்கள் சரிபார்க்கப்பட்டன",
            "நீங்கள் வழங்கிய விவரங்களை எங்கள் குழு சரிபார்த்துள்ளது. உதவி வழங்குவது குறித்து முடிவு எடுக்க உங்கள் கோரிக்கை தயாராக உள்ளது."),
        RequestStatus.Approved => new("அங்கீகரிக்கப்பட்டது", "உங்கள் கோரிக்கை அங்கீகரிக்கப்பட்டது",
            "உதவி வழங்க உங்கள் கோரிக்கை அங்கீகரிக்கப்பட்டுள்ளது. ஏற்பாடுகள் நடைபெறும்போது புதுப்பிப்புகளுக்கு உங்கள் கணக்கைப் பார்க்கவும்."),
        RequestStatus.InProgress => new("ஏற்பாடு நடைபெறுகிறது", "உங்களுக்கான உதவியை ஏற்பாடு செய்கிறோம்",
            "உங்களுக்கான உதவியை வழங்க ஏற்பாடுகள் நடைபெறுகின்றன. சமீபத்திய விவரங்களுக்கு உங்கள் கணக்கைப் பார்க்கவும்."),
        RequestStatus.PartiallyFulfilled => new("பகுதியளவில் வழங்கப்பட்டது", "நீங்கள் கோரிய உதவியில் ஒரு பகுதி வழங்கப்பட்டது",
            "நீங்கள் கோரிய உதவியில் ஒரு பகுதி வழங்கப்பட்டுள்ளது. வழங்கப்பட வேண்டிய உதவி பற்றிய விவரங்களை உங்கள் கோரிக்கையில் பார்க்கவும்."),
        RequestStatus.Fulfilled => new("உதவி வழங்கப்பட்டது", "நீங்கள் கோரிய உதவி வழங்கப்பட்டது",
            "உங்கள் கோரிக்கை நிறைவேற்றப்பட்டதாகப் பதிவு செய்யப்பட்டுள்ளது. வழங்கப்பட்ட உதவியின் விவரங்களை உங்கள் கணக்கில் பார்க்கலாம்."),
        RequestStatus.Closed => new("மூடப்பட்டது", "உங்கள் கோரிக்கை மூடப்பட்டது",
            "இந்த உதவிக் கோரிக்கை மூடப்பட்டுள்ளது. அதன் பதிவுகளை உங்கள் சுரகும கணக்கில் பார்க்கலாம்."),
        RequestStatus.Rejected => new("அங்கீகரிக்கப்படவில்லை", "உங்கள் கோரிக்கை அங்கீகரிக்கப்படவில்லை",
            "உங்கள் உதவிக் கோரிக்கை குறித்து முடிவு எடுக்கப்பட்டுள்ளது. கோரிக்கையையும் கிடைக்கும் விவரங்களையும் பார்க்க உள்நுழையவும்."),
        RequestStatus.Cancelled => new("ரத்து செய்யப்பட்டது", "உங்கள் கோரிக்கை ரத்து செய்யப்பட்டது",
            "இந்த உதவிக் கோரிக்கை ரத்து செய்யப்பட்டுள்ளது. அதை உங்கள் சுரகும கணக்கில் தொடர்ந்து பார்க்கலாம்."),
        _ => null
    };
}
