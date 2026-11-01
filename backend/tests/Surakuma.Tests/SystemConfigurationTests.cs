using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class SystemConfigurationTests
{
    [Fact]
    public void AbsentKeysExplainFallbackCaptureAndUnavailableRoutes()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection().Build();
        var status = IntegrationConfiguration.Describe(config);
        Assert.Equal("Fallback", status.Single(x => x.Id == "ai").State);
        Assert.Equal("Capture", status.Single(x => x.Id == "email").State);
        Assert.Equal("Unavailable", status.Single(x => x.Id == "mapping").State);
        Assert.Contains("Ai__ApiKey", status.Single(x => x.Id == "ai").MissingSettings);
    }

    [Theory]
    [InlineData("Brevo", "", "", "Incomplete")]
    [InlineData("Brevo", "synthetic-email-secret", "", "Incomplete")]
    [InlineData("Brevo", "synthetic-email-secret", "sender@example.test", "Configured")]
    [InlineData("Capture", "synthetic-email-secret", "sender@example.test", "Capture")]
    [InlineData("Unknown", "", "", "Invalid")]
    public void ConfiguredDoesNotClaimLiveVerificationOrExposeSecrets(string provider, string emailKey, string sender, string expected)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Ai:ApiKey"] = "synthetic-ai-secret",
            ["Mapping:ApiKey"] = "synthetic-map-secret",
            ["Email:Provider"] = provider,
            ["Email:ApiKey"] = emailKey,
            ["Email:Sender"] = sender,
            ["Jwt:Key"] = "synthetic-signing-secret",
            ["ConnectionStrings:Default"] = "synthetic-private-connection"
        }).Build();
        var status = IntegrationConfiguration.Describe(config);
        Assert.Equal(expected, status.Single(x => x.Id == "email").State);
        Assert.Equal("Configured", status.Single(x => x.Id == "ai").State);
        Assert.Contains("still need verification", status.Single(x => x.Id == "ai").Detail);
        string json = JsonSerializer.Serialize(status);
        foreach (string secret in new[] { "synthetic-ai-secret", "synthetic-map-secret", "synthetic-email-secret", "sender@example.test", "synthetic-signing-secret", "synthetic-private-connection" })
            Assert.DoesNotContain(secret, json);
    }
}
