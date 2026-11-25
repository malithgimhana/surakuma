using Microsoft.Extensions.Configuration;

namespace Surakuma.Infrastructure;

public sealed record IntegrationConfigurationStatus(string Id, string Name, string Mode, string State, string Detail, string[] MissingSettings);

/// <summary>Describes local configuration only; never contacts providers or returns credentials.</summary>
public static class IntegrationConfiguration
{
    public static IntegrationConfigurationStatus[] Describe(IConfiguration config)
    {
        bool aiKey = !string.IsNullOrWhiteSpace(config["Ai:OpenAiApiKey"] ?? config["OPENAI_API_KEY"]);
        bool mapKey = !string.IsNullOrWhiteSpace(config["Mapping:ApiKey"]);
        string emailMode = config["Email:Provider"] ?? "Capture";
        var emailMissing = new List<string>();
        if (string.IsNullOrWhiteSpace(config["Email:ApiKey"]))
            emailMissing.Add("Email__ApiKey");
        if (string.IsNullOrWhiteSpace(config["Email:Sender"]))
            emailMissing.Add("Email__Sender");

        return
        [
            new("ai", "AI recommendations", aiKey ? "OpenAI" : "Deterministic fallback",
                aiKey ? "Configured" : "Fallback", aiKey
                    ? "Per-task configuration is active. Real request text stays in Surakuma. Live provider access and quota require verification."
                    : "Local request signals and statistical decision support are available.",
                aiKey ? [] : ["Ai__OpenAiApiKey"]),
            new("email", "Email notifications", emailMode,
                emailMode == "Capture" ? "Capture" : emailMode != "Brevo" ? "Invalid" : emailMissing.Count > 0 ? "Incomplete" : "Configured",
                emailMode == "Capture" ? "Notifications are captured locally in SQL. No email is sent."
                    : emailMode != "Brevo" ? "Choose Capture or Brevo in server configuration."
                    : emailMissing.Count > 0 ? "Brevo cannot send until credentials and a verified sender are configured."
                    : "Credentials and sender are configured. Sender verification and an authorised test delivery still need verification.",
                emailMode == "Brevo" ? emailMissing.ToArray() : emailMode == "Capture" ? [] : ["Email__Provider"]),
            new("mapping", "Location search & driving routes", "openrouteservice", mapKey ? "Configured" : "Unavailable",
                mapKey ? "Credentials are configured. Live search and route results still need verification in the selected country. Routes require staff safety judgement."
                    : "Search and routing are unavailable. Manual location entry and online OpenStreetMap tiles remain available.",
                mapKey ? [] : ["Mapping__ApiKey"])
        ];
    }
}
