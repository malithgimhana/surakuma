using System.Net;
using System.Text.RegularExpressions;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class PasswordResetEmailTests
{
    [Fact]
    public void ResetButtonPreservesEncodedCredentialsWithoutDisplayingTheToken()
    {
        const string url = "https://surakuma.example/reset-password#email=person%2Btest%40example.test&token=abc%2Bdef%2Fghi%3D";
        var content = PasswordResetEmailContent.Create(url, new Uri("https://surakuma.example"));
        var href = Regex.Match(content.Html, "href=\"([^\"]+)\"").Groups[1].Value;
        Assert.Equal(url, WebUtility.HtmlDecode(href));
        Assert.Contains(url, content.Text);
        Assert.DoesNotContain("abc%2Bdef", Regex.Replace(content.Html, "<[^>]+>", ""));
        Assert.Contains("https://surakuma.example/surakuma-email-logo.png", content.Html);
        Assert.Contains("This link expires in 1 hour.", content.Html);
    }

    [Fact]
    public void HostedLogoCanBeUsedWithLocalResetLinksAndAttributesAreEncoded()
    {
        var content = PasswordResetEmailContent.Create(
            "http://localhost:5173/reset-password#token=\"<test>&email=example",
            new Uri("http://localhost:5173"), "https://images.example/logo.png?a=1&b=2");
        Assert.Contains("src=\"https://images.example/logo.png?a=1&amp;b=2\"", content.Html);
        Assert.Contains("token=&quot;&lt;test&gt;&amp;email=example", content.Html);
        Assert.DoesNotContain("<test>", content.Html);
    }
}
