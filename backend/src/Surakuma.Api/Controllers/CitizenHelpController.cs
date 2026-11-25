using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Surakuma.Application;
using Surakuma.Domain;

namespace Surakuma.Api.Controllers;

public sealed record CitizenHelpInput([Required, StringLength(75)] string Topic, [Required, StringLength(12)] string Language,
    [Required, StringLength(2, MinimumLength = 2)] string Country);

[ApiController, Authorize(Roles = Roles.Citizen), Route("api/v1/citizen/help")]
public sealed class CitizenHelpController(IAiProvider ai, IStore store) : ControllerBase
{
    private static readonly Dictionary<string, (string Path, string[] Text)> Guidance = new(StringComparer.Ordinal)
    {
        ["request"] = ("/app/requests/new", [
            "Open the assistance form, choose the kind of help you need and review your answers before submitting.",
            "ආධාර ඉල්ලුම්පත විවෘත කර ඔබට අවශ්‍ය ආධාර වර්ගය තෝරන්න. යොමු කිරීමට පෙර ඔබේ පිළිතුරු පරීක්ෂා කරන්න.",
            "உதவிப் படிவத்தைத் திறந்து தேவையான உதவி வகையைத் தேர்ந்தெடுக்கவும். சமர்ப்பிக்கும் முன் பதில்களைச் சரிபார்க்கவும்.",
            "सहायता फ़ॉर्म खोलें, ज़रूरत का प्रकार चुनें और भेजने से पहले अपने उत्तर जाँचें।",
            "सहायता फाराम खोल्नुहोस्, आवश्यक सहायताको प्रकार छान्नुहोस् र पठाउनुअघि उत्तरहरू जाँच्नुहोस्।"]),
        ["medicine"] = ("/app/requests/new?category=Medical", [
            "Open the medicine and medical support request form and select what help you are asking for.",
            "ඖෂධ සහ වෛද්‍ය සහාය ඉල්ලුම්පත විවෘත කර ඔබට අවශ්‍ය සහාය තෝරන්න.",
            "மருந்து மற்றும் மருத்துவ உதவிப் படிவத்தைத் திறந்து தேவையான உதவியைத் தேர்ந்தெடுக்கவும்.",
            "दवा और चिकित्सा सहायता फ़ॉर्म खोलें और अपनी ज़रूरत की सहायता चुनें।",
            "औषधि र चिकित्सा सहायता फाराम खोल्नुहोस् र आवश्यक सहायता छान्नुहोस्।"]),
        ["track"] = ("/app/requests", [
            "Open My requests and select the request you want to track. Its timeline shows recorded updates.",
            "මගේ ඉල්ලීම් විවෘත කර ඔබට නිරීක්ෂණය කිරීමට අවශ්‍ය ඉල්ලීම තෝරන්න. යාවත්කාලීන එහි දැක්වේ.",
            "எனது கோரிக்கைகள் பக்கத்தைத் திறந்து பார்க்க வேண்டிய கோரிக்கையைத் தேர்ந்தெடுக்கவும். அதன் காலவரிசையில் புதுப்பிப்புகள் தெரியும்.",
            "मेरे अनुरोध खोलें और जिस अनुरोध को देखना है उसे चुनें। उसकी समयरेखा में दर्ज अपडेट दिखते हैं।",
            "मेरा अनुरोधहरू खोल्नुहोस् र हेर्न चाहेको अनुरोध छान्नुहोस्। समयरेखामा दर्ता भएका अपडेट देखिन्छन्।"]),
        ["centres"] = ("/app/assistance-centres", [
            "Open Assistance centres for your selected country. Each listing shows the services and accessibility information published by staff.",
            "තෝරා ඇති රටේ ආධාර මධ්‍යස්ථාන විවෘත කරන්න. එක් එක් මධ්‍යස්ථානයේ ප්‍රකාශිත සේවා සහ ප්‍රවේශ තොරතුරු දැක්වේ.",
            "தேர்ந்தெடுத்த நாட்டின் உதவி மையங்களைத் திறக்கவும். வெளியிடப்பட்ட சேவைகளும் அணுகல் தகவலும் ஒவ்வொரு பதிவிலும் உள்ளன.",
            "चुने हुए देश के सहायता केंद्र खोलें। हर सूची में प्रकाशित सेवाएँ और पहुँच की जानकारी दिखती है।",
            "छानिएको देशका सहायता केन्द्रहरू खोल्नुहोस्। प्रत्येक सूचीमा प्रकाशित सेवा र पहुँचसम्बन्धी जानकारी देखिन्छ।"]),
        ["shelters"] = ("/app/shelters", [
            "Open Shelters for your selected country to see listed locations and their current published details.",
            "තෝරා ඇති රටේ නවාතැන් පිටුව විවෘත කර ප්‍රකාශිත ස්ථාන සහ විස්තර බලන්න.",
            "தேர்ந்தெடுத்த நாட்டின் தங்குமிடங்களைத் திறந்து வெளியிடப்பட்ட இடங்களையும் தகவல்களையும் பார்க்கவும்.",
            "चुने हुए देश के आश्रय खोलकर प्रकाशित स्थान और विवरण देखें।",
            "छानिएको देशका आश्रयहरू खोल्नुहोस् र प्रकाशित स्थान तथा विवरण हेर्नुहोस्।"])
    };

    [HttpPost, EnableRateLimiting("ai-drafts")]
    public async Task<IActionResult> Help(CitizenHelpInput input, CancellationToken ct)
    {
        var languageIndex = Array.IndexOf(new[] { "en", "si", "ta", "hi", "ne" }, input.Language);
        if (languageIndex < 0 || !Guidance.TryGetValue(input.Topic, out var guide))
            throw new RuleException("Choose a supported guidance topic and language.");
        if (!(await store.ListAsync(store.Query<Country>().Where(c => c.Code == input.Country), ct)).Any())
            throw new MissingException();
        var reference = guide.Text[languageIndex];
        var explanation = await ai.ExplainPortalGuidanceAsync(reference, input.Language, ct);
        return Ok(new { reference, explanation = explanation?.Text, path = guide.Path,
            source = explanation is null ? "Published Surakuma guidance" : AiPresentation.Source(explanation.Source) });
    }
}
