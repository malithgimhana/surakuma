using System.Net;
using Surakuma.Application;
using Surakuma.Domain;
using Surakuma.Infrastructure;

namespace Surakuma.Tests;

public sealed class CitizenEmailTests
{
    [Theory]
    [InlineData(RequestStatus.Submitted, "We received your request", "Received")]
    [InlineData(RequestStatus.UnderReview, "Your request is under review", "Under review")]
    [InlineData(RequestStatus.Verified, "Your request details are verified", "Verified")]
    [InlineData(RequestStatus.Approved, "Your request was approved", "Approved")]
    [InlineData(RequestStatus.InProgress, "We’re arranging your assistance", "In progress")]
    [InlineData(RequestStatus.PartiallyFulfilled, "Some assistance has been delivered", "Partially fulfilled")]
    [InlineData(RequestStatus.Fulfilled, "Your assistance has been delivered", "Fulfilled")]
    [InlineData(RequestStatus.Closed, "Your request is closed", "Closed")]
    [InlineData(RequestStatus.Rejected, "Your request was not approved", "Not approved")]
    [InlineData(RequestStatus.Cancelled, "Your request was cancelled", "Cancelled")]
    public void QueuedStatusesUseTheirOwnTemplateInEachSupportedLanguage(RequestStatus status, string heading, string label)
    {
        const string reference = "SK-27B4E8A190";
        var entry = new OutboxMessage { RequestId = Guid.NewGuid(), Message = CitizenMessages.Status(reference, status, "en") };
        var english = CitizenEmailContent.Create(CitizenEmailUpdate.FromOutbox(entry, "en"), "http://localhost:5173");
        Assert.Equal(heading, english.Subject);
        Assert.Contains($"Status: {label}", english.Text);
        Assert.Contains("<h1 class=\"heading\"", english.Html);
        Assert.Contains($">{WebUtility.HtmlEncode(heading)}</h1>", english.Html);
        Assert.Contains($">{reference}</p>", english.Html);
        Assert.Contains($">{label}</p>", english.Html);

        foreach (var (language, scriptStart, scriptEnd) in new[] { ("si", '\u0d80', '\u0dff'), ("ta", '\u0b80', '\u0bff') })
        {
            var update = CitizenEmailUpdate.FromOutbox(entry, language);
            var content = CitizenEmailContent.Create(update, "https://surakuma.example.test");
            var generic = CitizenEmailContent.Create(update with { Status = null }, null);
            Assert.Equal(status, update.Status);
            Assert.NotEqual(generic.Subject, content.Subject);
            Assert.Contains(content.Subject, character => character >= scriptStart && character <= scriptEnd);
            Assert.Contains(reference, content.Text);
            Assert.Contains($"lang=\"{language}\"", content.Html);
        }
    }

    [Theory]
    [InlineData((string?)null)]
    [InlineData("javascript:alert(1)")]
    [InlineData("http://surakuma.example.test")]
    [InlineData("https://surakuma.example.test/unexpected/path")]
    public void UnrecognizedLegacyMessagesRemainReadableWithNoUsablePortalUrl(string? portalBaseUrl)
    {
        const string message = "A legacy update with <private> & other text.";
        var update = CitizenEmailUpdate.FromOutbox(new OutboxMessage { Message = message }, "en");
        var content = CitizenEmailContent.Create(update, portalBaseUrl);
        Assert.Null(update.Status);
        Assert.Contains(message, content.Text);
        Assert.Contains(WebUtility.HtmlEncode(message), content.Html);
        Assert.Contains("Sign in to Surakuma to view your request.", content.Text);
        Assert.Contains("Humanitarian Response Platform", content.Html);
        Assert.DoesNotContain("class=\"details-reference\"", content.Html);
        Assert.Contains("Sign in to Surakuma to view your request.", content.Html);
        Assert.DoesNotContain("href=", content.Html);
        Assert.DoesNotContain("<img", content.Html);
    }

    [Fact]
    public void DonationUpdatesKeepTheirOwnButtonAndBranding()
    {
        var update = new CitizenEmailUpdate("A donation update is available.", Funding: true);
        var content = CitizenEmailContent.Create(update, "https://surakuma.example.test");

        Assert.Contains("View donation updates: https://surakuma.example.test/donor/notifications", content.Text);
        Assert.Contains("href=\"https://surakuma.example.test/donor/notifications\"", content.Html);
        Assert.Contains("src=\"https://surakuma.example.test/surakuma-email-logo.png\"", content.Html);
    }
}
