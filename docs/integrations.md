# Integration setup and live evidence

The application works in demonstration mode without external accounts. Administration → Integration readiness reads server configuration and SQL outbox counts. It never tests a key, sends email or changes configuration. `Configured` means required settings exist. Account activation, credentials, quotas, model access and live connectivity remain unverified until tested.

## Configure locally

Create your own provider accounts and use the free options. Keep keys in the API terminal's environment or in an ignored local settings file. README lists the supported environment variables. Stop and restart the API after changing them. Do not paste keys into chat or the report.

For a hidden PowerShell prompt rather than placing a key literally in command history:

```powershell
$env:Ai__ApiKey = [System.Net.NetworkCredential]::new('', (Read-Host 'Gemini key' -AsSecureString)).Password
./scripts/Start-Api.ps1
```

Use the same approach for `Email__ApiKey` before starting the API. The value stays in the current terminal. See the openrouteservice section to save the mapping key for later restarts.

## Gemini

Create an API key through [Google AI Studio](https://aistudio.google.com/). Verify current model access against the official [model catalog](https://ai.google.dev/gemini-api/docs/models) and [free-tier pricing](https://ai.google.dev/gemini-api/docs/pricing). The configured model is `gemini-3.8-flash`, which remains overridable through `Ai__Model`.

Set `Ai__ApiKey`, restart, and generate a recommendation on an explicitly synthetic request. Record the returned provider/model, original recommendation and staff decision. A labelled deterministic fallback is a valid outage demonstration but does not pass the live integration check. Review the [data terms](https://ai.google.dev/gemini-api/terms) before using the service; external free AI is disabled for non-synthetic requests.

## Brevo

Citizen-only accounts receive request submission and status updates through Brevo and their personal inbox. The background worker records each inbox entry before attempting email delivery, with one entry per event. Internal accounts, including accounts with both citizen and staff roles, receive operational notifications in the application. Capture mode remains available for development and automated tests. Apply the `InternalNotificationRouting` migration before starting the updated API. Existing citizen inbox rows are accessible to their request owner.

Create a [Brevo free account](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans), complete required account activation, and verify a sender. Configure `Email__Provider=Brevo`, `Email__ApiKey` and `Email__Sender` in the API terminal. Restart afterward. A configured sender string does not establish verification.

Set `Email__PortalBaseUrl` to the public HTTPS origin of the citizen frontend. The email button opens the corresponding request after sign-in, and email clients load the logo from `/surakuma-email-logo.png` on that origin. Without a portal origin, the email shows the Surakuma wordmark and sign-in instructions. The development default points to `http://localhost:5173` for same-machine testing.

Use a dedicated synthetic citizen account with an email inbox you control and authorise for testing. Trigger one case status update and inspect its outbox event, provider result and received message. Seed addresses ending `@surakuma.test` are placeholders for local capture, not delivery inboxes. Existing captured events are not automatically resent when switching provider. A `Review` result requires provider-side investigation before another attempt. Set `Email__Provider=Capture` and restart to return to local demonstration mode.

## openrouteservice

Copy your Standard API key from the [HeiGIT account dashboard](https://account.heigit.org/). Save it in `.env` at the repository root. Git ignores this file.

```dotenv
Mapping__ApiKey=YOUR_HEIGIT_API_KEY
```

Restart the local API with `./scripts/Start-Api.ps1`. The script loads the mapping key from `.env` unless a key is already set in the terminal environment.

After restart, refresh Administration → Integration readiness and confirm the mapping card says `Configured`. Search for a public Sri Lankan location such as Colombo Fort to verify the key, then generate a short driving route between public points. Record success or explicit unavailability without private household coordinates. The backend uses the [HeiGIT API endpoints](https://playground.heigit.org/). Driving output does not certify a safe evacuation route. OpenStreetMap tiles and routing are separate integrations.

Forward and reverse geocoding apply the selected country's Pelias boundary. Verify public test landmarks independently for each configured country. [Pelias search parameters](https://github.com/pelias/documentation/blob/master/search.md), [Pelias reverse geocoding](https://github.com/pelias/documentation/blob/master/reverse.md).

Optional `Ai__OperationalBriefingsEnabled=true` lets the Gemini adapter draft an internal interpretation from aggregate counts. Optional `Ai__PublicTranslationEnabled=true` supports draft translations of explicitly confirmed public wording. Both require `Ai__ApiKey` and use the configured `Ai__Model`. Failure returns labelled local suggestions or manual translation. Approval and publication still use the existing authorized human workflows.

## Evidence to complete after account setup

| Service | Configuration | Live synthetic check | Evidence |
| --- | --- | --- | --- |
| Gemini | Not configured | Not executed | Provider/model, timestamp, fallback flag, human decision |
| Brevo | Capture mode | Not executed | Authorised recipient, event/reference, received email; redact addresses in shared evidence |
| openrouteservice | Not configured | Not executed | Public search result, route geometry, timestamp |

The table records the local state on 21 October 2026. Update it only after actual live checks. Provider plans and terms can change; official links are the setup reference.
