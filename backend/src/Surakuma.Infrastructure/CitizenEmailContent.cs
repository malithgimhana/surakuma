using System.Net;
using Surakuma.Application;

namespace Surakuma.Infrastructure;

public sealed record CitizenEmailContent(string Subject, string Text, string Html)
{
    public static CitizenEmailContent Create(CitizenEmailUpdate update, string? portalBaseUrl)
    {
        var language = update.Language is "si" or "ta" or "hi" or "ne" ? update.Language : "en";
        var labels = CitizenEmailCopy.For(language);
        var stage = CitizenEmailCopy.ForStatus(update.Status, language);
        var color = CitizenEmailCopy.Color(update.Status);
        var status = stage?.Label ?? labels.Update;
        var heading = stage?.Heading ?? labels.Heading;
        var message = (stage?.Message ?? update.Message) + (update.ReviewedCopy is { Length: > 0 } copy ? " " + copy : "");
        var hasRequest = update.RequestId != Guid.Empty;
        var linkLabel = update.Funding ? language switch
        {
            "si" => "පරිත්‍යාග යාවත්කාලීන බලන්න",
            "ta" => "நன்கொடை புதுப்பிப்புகளைப் பார்க்கவும்",
            _ => "View donation updates"
        } : hasRequest ? labels.ViewRequest : labels.ViewRequests;
        var portal = GetPortalOrigin(portalBaseUrl);
        var requestUrl = portal is null ? null : new Uri(portal,
            update.Funding ? "/donor/notifications" : hasRequest ? $"/app/requests/{update.RequestId:D}" : "/app/requests").AbsoluteUri;

        var reference = stage is not null && !string.IsNullOrWhiteSpace(update.Reference) ? update.Reference : null;
        var summary = reference is not null
            ? $"\n\n{labels.Reference}: {reference}\n{labels.Status}: {status}"
            : "";
        var action = requestUrl is null ? labels.SignIn : $"{linkLabel}: {requestUrl}";
        string text = $"{heading}\n\n{message}{summary}\n\n{action}\n\nSurakuma · {labels.Footer}";

        var html = update.Funding
            ? RenderDonationUpdate(language, labels, status, heading, message, reference, color, requestUrl, linkLabel, portal)
            : RenderRequestUpdate(language, labels, status, heading, message, reference, color, requestUrl, linkLabel);
        return new(heading, text, html);
    }

    private static string RenderRequestUpdate(string language, CitizenEmailCopy.Labels labels, string status,
        string heading, string message, string? reference, string color, string? requestUrl, string linkLabel)
    {
        var details = reference is null ? "" : $"""
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#F4F8FC" style="width:100%;border-spacing:0;border:1px solid #D6E5F1;border-radius:12px;background-color:#F4F8FC;">
              <tr><td class="details-pad" style="padding:22px 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td class="details-reference" valign="top" width="48%" style="padding-right:16px;">
                      <p style="margin:0 0 5px;color:#52677D;font-size:13px;line-height:19px;">{Safe(labels.Reference)}</p>
                      <p style="margin:0;color:#10213C;font-size:16px;line-height:24px;font-weight:700;overflow-wrap:anywhere;">{Safe(reference)}</p>
                    </td>
                    <td class="details-status" valign="top" style="padding-left:19px;border-left:1px solid #CBDCEB;">
                      <p style="margin:0 0 5px;color:#52677D;font-size:13px;line-height:19px;">{Safe(labels.Status)}</p>
                      <p style="margin:0;color:{color};font-size:16px;line-height:24px;font-weight:700;">{Safe(status)}</p>
                    </td>
                  </tr>
                </table>
              </td></tr>
            </table>
            """;
        var action = requestUrl is null
            ? $"""<p style="margin:0;color:#52677D;font-size:14px;line-height:22px;">{Safe(labels.SignIn)}</p>"""
            : $"""
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-spacing:0;">
              <tr><td align="center" bgcolor="#EF7865" style="border-radius:10px;background-color:#EF7865;mso-padding-alt:16px 14px;">
                <a href="{Safe(requestUrl)}" style="display:block;padding:16px 14px;border:1px solid #EF7865;border-radius:10px;background-color:#EF7865;color:#10213C;font-size:15px;line-height:22px;font-weight:700;text-decoration:none;mso-padding-alt:0;">{Safe(linkLabel)}&nbsp;&nbsp;&rarr;</a>
              </td></tr>
            </table>
            """;

        return $$"""
            <!doctype html>
            <html lang="{{language}}">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width,initial-scale=1">
              <meta name="color-scheme" content="light">
              <meta name="supported-color-schemes" content="light">
              <title>{{Safe(heading)}} | Surakuma</title>
              <style>
                @media only screen and (max-width: 640px) {
                  .outer { padding: 16px 10px !important; }
                  .masthead { padding: 24px !important; }
                  .content { padding: 28px 24px 30px !important; }
                  .heading { font-size: 27px !important; line-height: 35px !important; }
                  .details-pad { padding: 18px 20px !important; }
                  .footer { padding: 20px 24px !important; }
                }
                @media only screen and (max-width: 420px) {
                  .details-reference, .details-status { display: block !important; width: auto !important; border-left: 0 !important; }
                  .details-reference { padding-right: 0 !important; }
                  .details-status { margin-top: 12px !important; padding: 12px 0 0 !important; border-top: 1px solid #CBDCEB !important; }
                }
              </style>
            </head>
            <body style="margin:0;padding:0;background-color:#F3F6FA;color:#10213C;font-family:Arial,'Nirmala UI',sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#F3F6FA" style="width:100%;border-collapse:collapse;background-color:#F3F6FA;">
                <tr><td class="outer" align="center" style="padding:36px 16px 32px;">
                  <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#FFFFFF" style="width:100%;max-width:600px;border:1px solid #DCE5EF;border-radius:16px;border-spacing:0;background-color:#FFFFFF;color:#10213C;font-family:Arial,'Nirmala UI',sans-serif;">
                    <tr><td height="6" bgcolor="#EF7865" style="height:6px;line-height:6px;font-size:0;border-radius:15px 15px 0 0;background-color:#EF7865;">&nbsp;</td></tr>
                    <tr><td class="masthead" bgcolor="#123452" style="padding:30px 40px 31px;background-color:#123452;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td valign="middle" width="46" style="width:46px;">
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                              <tr><td align="center" valign="middle" width="46" height="46" bgcolor="#EF7865" style="width:46px;height:46px;border-radius:12px;background-color:#EF7865;color:#10213C;font-size:25px;line-height:46px;font-weight:700;">S</td></tr>
                            </table>
                          </td>
                          <td valign="middle" style="padding-left:12px;">
                            <p style="margin:0;color:#FFFFFF;font-size:23px;line-height:28px;font-weight:700;">Surakuma</p>
                            <p lang="en" style="margin:4px 0 0;color:#BED9EB;font-size:10px;line-height:15px;letter-spacing:1.3px;text-transform:uppercase;font-weight:700;">Humanitarian Response Platform</p>
                          </td>
                        </tr>
                      </table>
                    </td></tr>
                    <tr><td class="content" style="padding:38px 42px;overflow-wrap:anywhere;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr><td bgcolor="#EBF4FA" style="padding:7px 12px;border:1px solid #CFE2F0;border-radius:20px;background-color:#EBF4FA;color:{{color}};font-size:11px;line-height:16px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;">{{Safe(status)}}</td></tr>
                      </table>
                      <h1 class="heading" style="margin:18px 0 12px;color:#10213C;font-size:33px;line-height:41px;font-weight:700;">{{Safe(heading)}}</h1>
                      <p style="margin:0 0 24px;color:#52677D;font-size:15px;line-height:25px;">{{Safe(message)}}</p>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-spacing:0;">
                        {{(details.Length == 0 ? "" : $"<tr><td style=\"padding-bottom:22px;\">{details}</td></tr>")}}
                        <tr><td>{{action}}</td></tr>
                      </table>
                    </td></tr>
                    <tr><td class="footer" bgcolor="#F4F8FC" style="padding:22px 42px 24px;border-top:1px solid #DCE5EF;border-radius:0 0 15px 15px;background-color:#F4F8FC;">
                      <p style="margin:0 0 4px;color:#123452;font-size:14px;line-height:21px;font-weight:700;">Surakuma</p>
                      <p style="margin:0;color:#52677D;font-size:12px;line-height:19px;">{{Safe(labels.Footer)}}</p>
                    </td></tr>
                  </table>
                  <!--[if mso]></td></tr></table><![endif]-->
                </td></tr>
              </table>
            </body>
            </html>
            """;
    }

    private static string RenderDonationUpdate(string language, CitizenEmailCopy.Labels labels, string status,
        string heading, string message, string? reference, string color, string? requestUrl, string linkLabel, Uri? portal)
    {
        var logo = portal is null ? "" : $"""
            <td style="padding-right:9px;">
              <img src="{Safe(new Uri(portal, "/surakuma-email-logo.png").AbsoluteUri)}" width="42" height="42" alt="" style="display:block;border:0;">
            </td>
            """;
        var details = reference is null ? "" : $"""
            <tr><td style="padding:0 16px 14px;">
              <table width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f0f5fb" style="border:1px solid #dbe6f3;border-radius:6px;border-spacing:0;background:#f0f5fb;font:400 12px/17px Arial,sans-serif;text-align:left;">
                <tr>
                  <th scope="row" width="36%" style="padding:7px 9px;color:#425570;">{Safe(labels.Reference)}</th>
                  <td align="right" style="padding:7px 9px;font-weight:700;overflow-wrap:anywhere;">{Safe(reference)}</td>
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
        return $"""
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
