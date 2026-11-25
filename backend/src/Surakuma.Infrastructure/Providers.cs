using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Surakuma.Application;
using Surakuma.Domain;
using Polly.CircuitBreaker;
using Polly.Timeout;

namespace Surakuma.Infrastructure;

public sealed class EmailProvider(HttpClient http, IConfiguration config) : IEmailProvider
{
    public string Name => config["Email:Provider"] == "Brevo" ? "Brevo" : "Development capture";
    public async Task<DeliveryResult> SendAsync(string email, CitizenEmailUpdate update, Guid eventId, CancellationToken ct)
    {
        if (Name != "Brevo")
            return new("Captured", eventId.ToString());
        var key = config["Email:ApiKey"];
        var sender = config["Email:Sender"];
        if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(sender))
            return new("Failed", Error: "Brevo credentials or verified sender are missing.");
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.brevo.com/v3/smtp/email");
            request.Headers.Add("api-key", key);
            var content = CitizenEmailContent.Create(update, config["Email:PortalBaseUrl"]);
            request.Content = JsonContent.Create(new
            {
                sender = new
                {
                    name = "Surakuma",
                    email = sender
                },
                to = new[] { new { email } },
                subject = content.Subject,
                textContent = content.Text,
                htmlContent = content.Html,
                headers = new Dictionary<string, string> { ["X-Surakuma-Event"] = eventId.ToString() }
            });
            using var response = await http.SendAsync(request, ct);
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
                return new("Retry", Error: "Email provider rate limit.");
            if ((int)response.StatusCode >= 500)
                return new("Review", Error: "Provider response uncertain; verify before resending.");
            if (!response.IsSuccessStatusCode)
                return new("Failed", Error: $"Email provider rejected request ({(int)response.StatusCode}).");
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            return new("Sent", json.RootElement.TryGetProperty("messageId", out var id) ? id.GetString() : null);
        }
        catch (BrokenCircuitException)
        {
            return new("Retry", Error: "Email circuit is open; no send was attempted.");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or TimeoutRejectedException)
        {
            if (ct.IsCancellationRequested) throw;
            return new("Review", Error: "Send outcome unknown; verify with provider before retrying.");
        }
    }
}
public sealed class CaptureEmailProvider : IEmailProvider
{
    public string Name => "Development capture";
    public Task<DeliveryResult> SendAsync(string email, CitizenEmailUpdate update, Guid eventId, CancellationToken ct) => Task.FromResult(new DeliveryResult("Captured", eventId.ToString()));
}
public static class EmailProviderFactory
{
    public static IEmailProvider Create(IConfiguration config, EmailProvider brevo) => config["Email:Provider"] switch
    {
        "Brevo" => brevo,
        "Capture" => new CaptureEmailProvider(),
        _ => throw new InvalidOperationException("Choose Email:Provider as Capture or Brevo.")
    };
}
public sealed class MappingProvider(HttpClient http, IConfiguration config) : IMappingProvider
{
    private async Task<object?> Get(string url, CancellationToken ct)
    {
        string? key = config["Mapping:ApiKey"]?.Trim();
        if (string.IsNullOrEmpty(key) || key.Any(char.IsControl))
            return null;
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            // HeiGIT expects the raw key, which can contain characters outside the HTTP auth scheme grammar.
            request.Headers.TryAddWithoutValidation("Authorization", key);
            using var response = await http.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
                return null;
            return JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync(ct));
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or BrokenCircuitException or TimeoutRejectedException)
        {
            if (ct.IsCancellationRequested) throw;
            return null;
        }
    }
    public Task<object?> GeocodeAsync(string query, CancellationToken ct, string countryCode = "LK")
        => Get("https://api.heigit.org/pelias/v1/search?boundary.country=" + Alpha3(countryCode) + "&size=5&text=" + Uri.EscapeDataString(query), ct);
    public Task<object?> ReverseGeocodeAsync(double latitude, double longitude, CancellationToken ct, string? countryCode = null)
        => Get(FormattableString.Invariant($"https://api.heigit.org/pelias/v1/reverse?point.lat={latitude}&point.lon={longitude}&size=5") +
            (countryCode == null ? "" : "&boundary.country=" + Alpha3(countryCode)), ct);
    public Task<object?> RouteAsync(double startLat, double startLng, double endLat, double endLng, CancellationToken ct) => Get(FormattableString.Invariant($"https://api.heigit.org/openrouteservice/v2/directions/driving-car?start={startLng},{startLat}&end={endLng},{endLat}"), ct);
    private static string Alpha3(string code) => code switch
    {
        "LK" => "LKA", "IN" => "IND", "NP" => "NPL", _ => throw new RuleException("Choose a supported mapping country.")
    };
}
