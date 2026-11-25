using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection;
using Surakuma.Domain;

namespace Surakuma.Infrastructure;

public sealed record StaffInvitationEmail(string Email, string Password, Guid MembershipId)
{
    internal const string ProtectionPurpose = "Surakuma.StaffInvitation";

    public static SecurityEmail Queue(AppUser user, Membership membership, string password, IDataProtectionProvider protection)
    {
        var invitation = new StaffInvitationEmail(user.Email!, password, membership.Id);
        return new SecurityEmail
        {
            UserId = user.Id,
            Kind = SecurityEmailKind.StaffInvitation,
            ProtectedToken = protection.CreateProtector(ProtectionPurpose).Protect(JsonSerializer.Serialize(invitation))
        };
    }

    internal static StaffInvitationEmail Read(string protectedToken, IDataProtectionProvider protection) =>
        JsonSerializer.Deserialize<StaffInvitationEmail>(protection.CreateProtector(ProtectionPurpose).Unprotect(protectedToken))!;

    public (string Subject, string Text, string Html) CreateContent(string name, string role, string country, Uri portal)
    {
        var signInUrl = new Uri(portal, "/login").AbsoluteUri;
        role = Regex.Replace(role, "([a-z])([A-Z])", "$1 $2");
        const string subject = "Welcome to Surakuma | Your account details";
        var text = $"""
            Hello {name},

            Your Surakuma account is ready.

            Login email address: {Email}
            Initial password: {Password}
            Assigned role: {role}
            Workspace / country: {country}

            Sign in to Surakuma: {signInUrl}

            Keep your sign-in details private. Use Forgot password on the sign-in page to set a new password.
            If you did not expect this invitation, contact your administrator.

            Surakuma Team
            """;
        var email = WebUtility.HtmlEncode(Email);
        var password = WebUtility.HtmlEncode(Password);
        var url = WebUtility.HtmlEncode(signInUrl);
        name = WebUtility.HtmlEncode(name);
        role = WebUtility.HtmlEncode(role);
        country = WebUtility.HtmlEncode(country);
        var html = $$"""
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <meta name="color-scheme" content="light">
              <meta name="supported-color-schemes" content="light">
              <title>Welcome to Surakuma</title>
              <style>
                @media only screen and (max-width: 640px) {
                  .shell { width: 100% !important; max-width: 100% !important; }
                  .outer { padding: 16px 10px !important; }
                  .masthead { padding: 27px 25px !important; }
                  .content { padding: 30px 24px 32px !important; }
                  .details-pad { padding: 22px 20px !important; }
                  .footer { padding: 22px 22px !important; }
                  .heading { font-size: 28px !important; line-height: 36px !important; }
                  .btn-text { display: block !important; padding: 16px 12px !important; }
                  .col { display: block !important; width: 100% !important; padding: 0 !important; border-left: none !important; }
                  .col+.col { padding-top: 17px !important; }
                  .mobile-hide { display: none !important; }
                }
              </style>
            </head>
            <body style="margin:0;padding:0;background-color:#F3F6FA;color:#10213C;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
              <div style="display:none!important;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;visibility:hidden;">Your Surakuma account is ready. Find your sign-in details and assigned workspace inside.</div>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;background-color:#F3F6FA;">
                <tr><td class="outer" align="center" style="padding:36px 16px 32px;">
                  <table class="shell" role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;border-collapse:separate;border-spacing:0;background-color:#FFFFFF;border:1px solid #DCE5EF;border-radius:16px;overflow:hidden;">
                    <tr><td height="6" style="height:6px;line-height:6px;font-size:0;background-color:#EF7865;">&nbsp;</td></tr>
                    <tr>
                      <td class="masthead" style="padding:30px 40px 31px;background-color:#123452;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                          <tr>
                            <td valign="middle" width="52" style="width:52px;">
                              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" width="46" height="46" style="width:46px;height:46px;border-radius:12px;background:#EF7865;font-family:Arial,sans-serif;font-size:25px;line-height:46px;color:#FFFFFF;font-weight:800;">S</td></tr></table>
                            </td>
                            <td valign="middle" style="padding-left:11px;">
                              <div style="font-size:23px;line-height:27px;font-weight:800;letter-spacing:.2px;color:#FFFFFF;">Surakuma</div>
                              <div style="padding-top:4px;font-size:10px;line-height:15px;text-transform:uppercase;letter-spacing:1.8px;font-weight:700;color:#BED9EB;">Humanitarian Response Platform</div>
                            </td>
                            <td class="mobile-hide" valign="middle" align="right" style="text-align:right;">
                              <div style="display:inline-block;border:1px solid #5D7C95;border-radius:18px;padding:7px 11px;font-size:10px;letter-spacing:1px;color:#DCECF6;font-weight:700;white-space:nowrap;">ACCOUNT ACCESS</div>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td class="content" style="padding:38px 42px 38px;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:7px 12px;border-radius:20px;background-color:#EBF4FA;border:1px solid #CFE2F0;color:#1673AE;font-size:11px;font-weight:700;letter-spacing:1px;line-height:15px;">NEW ACCOUNT INVITATION</td></tr></table>
                        <h1 class="heading" style="margin:20px 0 13px;color:#10213C;font-size:33px;font-weight:800;letter-spacing:-.9px;line-height:40px;">Welcome to Surakuma<span style="color:#EF7865;">.</span></h1>
                        <p style="margin:0 0 12px;color:#10213C;font-size:16px;line-height:25px;font-weight:700;">Hello {{name}},</p>
                        <p style="margin:0 0 26px;color:#52677D;font-size:15px;line-height:25px;">Your Surakuma account is ready. Sign in to your assigned workspace to help with humanitarian response.</p>

                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:separate;background-color:#F4F8FC;border:1px solid #D6E5F1;border-radius:12px;">
                          <tr><td class="details-pad" style="padding:23px 24px 21px;">
                            <p style="margin:0 0 19px;color:#1673AE;font-size:11px;line-height:15px;font-weight:800;letter-spacing:1.4px;">YOUR ACCOUNT DETAILS</p>
                            <p style="margin:0 0 5px;color:#667C90;font-size:12px;line-height:18px;">Login email address</p>
                            <p style="margin:0 0 20px;color:#10213C;font-size:16px;line-height:23px;font-weight:700;word-break:break-word;">{{email}}</p>
                            <p style="margin:0 0 5px;color:#667C90;font-size:12px;line-height:18px;">Initial password</p>
                            <p style="margin:0 0 20px;color:#10213C;font-size:16px;line-height:23px;font-weight:700;overflow-wrap:anywhere;white-space:pre-wrap;"><code style="font-family:Consolas,monospace;">{{password}}</code></p>
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">
                              <tr>
                                <td class="col" valign="top" width="48%" style="padding-right:12px;">
                                  <div style="font-size:12px;line-height:18px;color:#667C90;margin-bottom:5px;">Assigned role</div>
                                  <div style="font-size:15px;line-height:22px;color:#10213C;font-weight:700;overflow-wrap:anywhere;">{{role}}</div>
                                </td>
                                <td class="col" valign="top" style="padding-left:19px;border-left:1px solid #CBDCEB;">
                                  <div style="font-size:12px;line-height:18px;color:#667C90;margin-bottom:5px;">Workspace / country</div>
                                  <div style="font-size:15px;line-height:22px;color:#10213C;font-weight:700;overflow-wrap:anywhere;">{{country}}</div>
                                </td>
                              </tr>
                            </table>
                          </td></tr>
                        </table>

                        <h2 style="margin:27px 0 10px;color:#10213C;font-size:17px;line-height:24px;font-weight:800;">Sign in to your account</h2>
                        <p style="margin:0 0 21px;color:#52677D;font-size:14px;line-height:23px;">Use the email address and initial password above to sign in to your Surakuma workspace.</p>
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:separate;border-radius:10px;background-color:#EF7865;">
                          <tr>
                            <td align="center" style="border-radius:10px;background-color:#EF7865;">
                              <a class="btn-text" href="{{url}}" target="_blank" style="display:block;padding:17px 16px;border:1px solid #EF7865;border-radius:10px;text-align:center;background-color:#EF7865;font-size:15px;line-height:21px;font-weight:800;text-decoration:none;color:#10213C;">Sign in to Surakuma&nbsp;&nbsp;&rarr;</a>
                            </td>
                          </tr>
                        </table>

                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:25px;width:100%;border-collapse:separate;border:1px solid #D2EBDC;background-color:#F1FAF4;border-radius:11px;">
                          <tr>
                            <td width="37" valign="top" style="padding:18px 0 18px 17px;width:37px;">
                              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" width="25" height="25" style="width:25px;height:25px;border-radius:50%;background:#2EA77E;color:#FFFFFF;font-size:15px;line-height:25px;font-weight:bold;">&#10003;</td></tr></table>
                            </td>
                            <td valign="top" style="padding:17px 18px 17px 0;">
                              <div style="color:#1A634C;font-weight:800;font-size:13px;line-height:20px;margin-bottom:4px;">Your account security matters</div>
                              <div style="color:#466A59;font-size:12px;line-height:20px;">Keep your sign-in details private. Use Forgot password on the sign-in page to set a new password.</div>
                            </td>
                          </tr>
                        </table>
                        <p style="margin:23px 0 0;color:#667C90;font-size:12px;line-height:20px;">If you did not expect this invitation, contact your administrator.</p>
                      </td>
                    </tr>
                    <tr>
                      <td class="footer" style="padding:24px 42px 27px;background-color:#F4F8FC;border-top:1px solid #DCE5EF;">
                        <p style="margin:0 0 7px;color:#123452;font-size:14px;line-height:21px;font-weight:800;">Surakuma Team</p>
                        <p style="margin:0 0 13px;color:#708398;font-size:12px;line-height:19px;">Supporting coordinated humanitarian response, together.</p>
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
                          <td style="color:#91A2B2;font-size:11px;line-height:18px;">This is an automated account invitation.</td>
                          <td align="right" style="color:#A5B2C0;font-size:11px;line-height:18px;font-weight:700;">SURAKUMA</td>
                        </tr></table>
                      </td>
                    </tr>
                  </table>
                </td></tr>
              </table>
            </body>
            </html>
            """;
        return (subject, text, html);
    }
}
