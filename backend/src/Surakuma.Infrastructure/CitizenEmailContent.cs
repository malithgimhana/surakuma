using System.Net;

namespace Surakuma.Infrastructure;

public sealed record CitizenEmailContent(string Subject, string Text, string Html)
{
    public static CitizenEmailContent Create(string message, string language)
    {
        var (subject, greeting, heading, instruction, signoff) = language switch
        {
            "si" => ("සුරැකුම ඉල්ලීම පිළිබඳ යාවත්කාලීනයක්", "ආයුබෝවන්,", "ඔබගේ ඉල්ලීම පිළිබඳ යාවත්කාලීනයක්", "වැඩි විස්තර සඳහා සුරැකුම ගිණුමට පිවිස ඔබගේ ඉල්ලීම බලන්න.", "සුරැකුම කණ්ඩායම"),
            "ta" => ("சுரகும கோரிக்கை பற்றிய புதுப்பிப்பு", "வணக்கம்,", "உங்கள் கோரிக்கை பற்றிய புதுப்பிப்பு", "மேலும் விவரங்களுக்கு உங்கள் சுரகும கணக்கில் உள்நுழைந்து கோரிக்கையைப் பார்க்கவும்.", "சுரகும குழு"),
            _ => ("An update on your Surakuma request", "Hello,", "An update on your request", "Sign in to Surakuma to view your request and its latest details.", "The Surakuma team")
        };
        string text = $"{greeting}\n\n{heading}\n\n{message}\n\n{instruction}\n\n{signoff}";
        static string Safe(string value) => WebUtility.HtmlEncode(value);
        string html = $"""
            <!doctype html><html lang="{(language is "si" or "ta" ? language : "en")}"><body style="margin:0;padding:24px 12px;background:#f3f6fb;font-family:Arial,sans-serif;color:#17294d;">
            <table role="presentation" style="width:100%;max-width:560px;margin:0 auto;border-collapse:collapse;"><tr><td style="padding:18px 8px;color:#17294d;font-size:20px;font-weight:bold;">සුරැකුම <span style="color:#ff6b5e;">·</span> Surakuma</td></tr>
            <tr><td style="background:#ffffff;border:1px solid #e1e8f2;border-radius:16px;padding:32px;">
            <p style="margin:0 0 16px;font-size:16px;">{Safe(greeting)}</p>
            <h1 style="margin:0 0 20px;font-size:23px;line-height:1.3;color:#17294d;">{Safe(heading)}</h1>
            <div style="padding:18px;background:#f2f6ff;border-left:4px solid #ff6b5e;border-radius:6px;font-size:16px;line-height:1.6;">{Safe(message)}</div>
            <p style="margin:24px 0;line-height:1.6;color:#405475;">{Safe(instruction)}</p>
            <p style="margin:0;line-height:1.5;">{Safe(signoff)}</p>
            </td></tr></table></body></html>
            """;
        return new(subject, text, html);
    }
}
