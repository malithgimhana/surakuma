using System.Net;
using Surakuma.Application;

namespace Surakuma.Infrastructure;

public sealed record CitizenEmailContent(string Subject, string Text, string Html)
{
    public static CitizenEmailContent Create(CitizenEmailUpdate update, string? portalBaseUrl)
    {
        var language = update.Language is "si" or "ta" ? update.Language : "en";
        var labels = CitizenEmailCopy.For(language);
        var stage = CitizenEmailCopy.ForStatus(update.Status, language);
        var color = CitizenEmailCopy.Color(update.Status);
        var status = stage?.Label ?? labels.Update;
        var heading = stage?.Heading ?? labels.Heading;
        var message = stage?.Message ?? update.Message;
        var hasRequest = update.RequestId != Guid.Empty;
        var linkLabel = update.Funding ? language switch
        {
            "si" => "පරිත්‍යාග යාවත්කාලීන බලන්න",
            "ta" => "நன்கொடை புதுப்பிப்புகளைப் பார்க்கவும்",
            _ => "View donation updates"
        } : hasRequest ? labels.ViewRequest : labels.ViewRequests;
        var portal = GetPortalOrigin(portalBaseUrl);
        var requestUrl = portal is null ? null : new Uri(portal,
            update.Funding ? "/funding/notifications" : hasRequest ? $"/app/requests/{update.RequestId:D}" : "/app/requests").AbsoluteUri;

        var summary = stage is not null && !string.IsNullOrWhiteSpace(update.Reference)
            ? $"\n\n{labels.Reference}: {update.Reference}\n{labels.Status}: {status}"
            : "";
        var action = requestUrl is null ? labels.SignIn : $"{linkLabel}: {requestUrl}";
        string text = $"{heading}\n\n{message}{summary}\n\n{action}\n\nSurakuma · {labels.Footer}";

        var logo = portal is null ? "" : $"""
            <td style="padding-right:9px;">
              <img src="{Safe(new Uri(portal, "/surakuma-email-logo.png").AbsoluteUri)}" width="42" height="42" alt="" style="display:block;border:0;">
            </td>
            """;
        var details = summary.Length == 0 ? "" : $"""
            <tr><td style="padding:0 16px 14px;">
              <table width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f0f5fb" style="border:1px solid #dbe6f3;border-radius:6px;border-spacing:0;background:#f0f5fb;font:400 12px/17px Arial,sans-serif;text-align:left;">
                <tr>
                  <th scope="row" width="36%" style="padding:7px 9px;color:#425570;">{Safe(labels.Reference)}</th>
                  <td align="right" style="padding:7px 9px;font-weight:700;overflow-wrap:anywhere;">{Safe(update.Reference!)}</td>
                </tr>
                <tr>
                  <th scope="row" style="padding:7px 9px;border-top:1px solid #dbe6f3;color:#425570;">{Safe(labels.Status)}</th>
                  <td align="right" style="padding:7px 9px;border-top:1px solid #dbe6f3;color:{color};font-weight:700;">{Safe(status)}</td>
                </tr>
              </table>
            </td></tr>
            """;
        var actionHtml = requestUrl is null
            ? $"""<p style="margin:0;color:#3e506a;font:400 14px/20px Arial,sans-serif;">{Safe(labels.SignIn)}</p>"""
            : $"""
            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
              <tr><td align="center" bgcolor="#194b88" style="background:#194b88;border-radius:7px;mso-padding-alt:11px 17px;">
                <a href="{Safe(requestUrl)}" style="display:inline-block;border:1px solid #194b88;border-radius:7px;color:#ffffff;padding:11px 17px;font:700 14px/19px Arial,sans-serif;text-decoration:none;">{Safe(linkLabel)}&nbsp;&nbsp;&rarr;</a>
              </td></tr>
            </table>
            """;
        string html = $"""
            <!doctype html>
            <html lang="{language}">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width,initial-scale=1">
              <title>{Safe(heading)} | Surakuma</title>
            </head>
            <body style="margin:0;background:#eef3f9;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#eef3f9" style="background:#eef3f9;">
                <tr><td align="center" style="padding:24px 12px;">
                  <!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:560px;border:1px solid #dbe3ee;border-radius:12px;border-spacing:0;background:#ffffff;color:#142742;font-family:Arial,sans-serif;">
                    <tr><td bgcolor="#12213a" style="padding:12px 17px;background:#12213a;border-radius:11px 11px 0 0;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          {logo}
                          <td style="vertical-align:middle;color:#ffffff;">
                            <strong lang="si" style="display:block;font:700 21px/25px 'Nirmala UI','Noto Sans Sinhala',sans-serif;">සුරැකුම</strong>
                            <span style="display:block;font:700 9px/12px Arial,sans-serif;letter-spacing:2px;color:#e4ecfa;">SURAKUMA</span>
                          </td>
                        </tr>
                      </table>
                    </td></tr>
                    <tr><td style="padding:15px 16px 0;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr><td bgcolor="{color}" style="background:{color};border-radius:5px;color:#ffffff;padding:6px 9px;font:700 11px/15px Arial,sans-serif;letter-spacing:.55px;text-transform:uppercase;">{Safe(status)}</td></tr>
                      </table>
                      <h1 style="margin:12px 0 8px;font:700 22px/26px Arial,sans-serif;letter-spacing:-.45px;">{Safe(heading)}</h1>
                      <p style="margin:0 0 14px;color:#3e506a;font:400 14px/20px Arial,sans-serif;">{Safe(message)}</p>
                    </td></tr>
                    {details}
                    <tr><td align="center" style="padding:0 16px 15px;">{actionHtml}</td></tr>
                    <tr><td bgcolor="#f6f8fb" style="border-top:1px solid #e3eaf3;border-radius:0 0 11px 11px;background:#f6f8fb;padding:10px 16px;color:#425570;font:400 11px/16px Arial,sans-serif;">
                      <strong style="color:#203752;">Surakuma</strong> &nbsp;&middot;&nbsp; {Safe(labels.Footer)}
                    </td></tr>
                  </table>
                  <!--[if mso]></td></tr></table><![endif]-->
                </td></tr>
              </table>
            </body>
            </html>
            """;
        return new(heading, text, html);
    }

    private static Uri? GetPortalOrigin(string? value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var portal)
            || (portal.Scheme != Uri.UriSchemeHttps && !(portal.IsLoopback && portal.Scheme == Uri.UriSchemeHttp))
            || portal.Host.Length == 0 || portal.UserInfo.Length != 0
            || portal.AbsolutePath != "/" || portal.Query.Length != 0 || portal.Fragment.Length != 0)
            return null;
        return portal;
    }

    private static string Safe(string value) => WebUtility.HtmlEncode(value);
}
