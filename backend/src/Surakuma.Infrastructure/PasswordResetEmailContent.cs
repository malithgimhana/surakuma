using System.Net;

namespace Surakuma.Infrastructure;

public sealed record PasswordResetEmailContent(string Subject, string Text, string Html)
{
    public static PasswordResetEmailContent Create(string resetUrl, Uri portal, string? logoUrl = null)
    {
        var safeUrl = WebUtility.HtmlEncode(resetUrl);
        var safeLogo = WebUtility.HtmlEncode(string.IsNullOrWhiteSpace(logoUrl)
            ? new Uri(portal, "/surakuma-email-logo.png").AbsoluteUri
            : logoUrl);
        const string subject = "Reset your Surakuma password";
        var text = $"Reset your password\n\nWe received a request to reset your Surakuma password.\n\nReset password: {resetUrl}\n\nThis link expires in 1 hour.\n\nIf you didn’t request this, you can ignore this email.";
        var html = $"""
            <!doctype html>
            <html lang="en">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width,initial-scale=1">
              <title>Reset your password | Surakuma</title>
            </head>
            <body style="margin:0;padding:0;background:#eef2f6;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef2f6">
                <tr><td align="center" style="padding:20px 12px;">
                  <!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:560px;background:#ffffff;border-radius:10px;color:#303234;font-family:Arial,Helvetica,sans-serif;">
                    <tr><td align="center" style="padding:28px 24px;border-radius:10px 10px 0 0;">
                      <img src="{safeLogo}" width="74" height="74" alt="" style="display:block;width:74px;height:74px;border:0;">
                      <p style="margin:4px 0 0;color:#202020;font:700 30px/36px Arial,Helvetica,sans-serif;">Surakuma</p>
                    </td></tr>
                    <tr><td align="center" bgcolor="#fff0ec" style="padding:40px 20px;background:#fff0ec;">
                      <h1 style="margin:0;color:#102641;font:700 34px/40px Arial,Helvetica,sans-serif;letter-spacing:-0.6px;">Reset your password</h1>
                    </td></tr>
                    <tr><td align="center" style="padding:42px 32px 32px;">
                      <p style="margin:0;font:400 18px/27px Arial,Helvetica,sans-serif;">We received a request to reset your Surakuma password.</p>
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:340px;margin-top:32px;">
                        <tr><td align="center" bgcolor="#a63c30" style="background:#a63c30;border-radius:10px;mso-padding-alt:15px 24px;">
                          <a href="{safeUrl}" style="display:block;padding:15px 24px;border:1px solid #a63c30;border-radius:10px;color:#ffffff;font:700 22px/26px Arial,Helvetica,sans-serif;text-decoration:none;">Reset password</a>
                        </td></tr>
                      </table>
                      <p style="margin:24px 0 0;font:400 16px/24px Arial,Helvetica,sans-serif;">This link expires in 1 hour.</p>
                    </td></tr>
                    <tr><td style="padding:0 32px 30px;border-radius:0 0 10px 10px;">
                      <p style="margin:0;border-top:1px solid #ddd6d3;padding-top:22px;text-align:center;color:#45484b;font:400 15px/23px Arial,Helvetica,sans-serif;">If you didn’t request this, you can ignore this email.</p>
                    </td></tr>
                  </table>
                  <!--[if mso]></td></tr></table><![endif]-->
                </td></tr>
              </table>
            </body>
            </html>
            """;
        return new(subject, text, html);
    }
}
