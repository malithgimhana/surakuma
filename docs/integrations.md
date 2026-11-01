# Integration setup and live evidence

The application works in demonstration mode without external accounts. Administration → Integration readiness reads server configuration and SQL outbox counts. It never tests a key, sends email or changes configuration. `Configured` means required settings exist. Account activation, credentials, quotas, model access and live connectivity remain unverified until tested.

## Configure locally

Create your own provider accounts and use the free options. Keep keys in the API terminal's environment, never in frontend code, screenshots or Git. README lists the supported environment variables. Stop and restart the API after changing them. Do not paste keys into chat or the report.

For a hidden PowerShell prompt rather than placing a key literally in command history:

```powershell
$env:Ai__ApiKey = [System.Net.NetworkCredential]::new('', (Read-Host 'Gemini key' -AsSecureString)).Password
./scripts/Start-Api.ps1
```

Use the same approach for `Mapping__ApiKey` or `Email__ApiKey` before starting the API. This supplies a process environment value; the prompt does not persist it for later terminals. API restarts must use the configured terminal.

## Gemini

Create an API key through [Google AI Studio](https://aistudio.google.com/). Verify current model access against the official [model catalog](https://ai.google.dev/gemini-api/docs/models) and [free-tier pricing](https://ai.google.dev/gemini-api/docs/pricing). The configured model is `gemini-3.8-flash`, which remains overridable through `Ai__Model`.

Set `Ai__ApiKey`, restart, and generate a recommendation on an explicitly synthetic request. Record the returned provider/model, original recommendation and staff decision. A labelled deterministic fallback is a valid outage demonstration but does not pass the live integration check. Review the [data terms](https://ai.google.dev/gemini-api/terms) before using the service; external free AI is disabled for non-synthetic requests.

## Brevo

Create a [Brevo free account](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans), complete required account activation, and verify a sender. Configure `Email__Provider=Brevo`, `Email__ApiKey` and `Email__Sender` in the API terminal. Restart afterward. A configured sender string does not establish verification.

Use a dedicated synthetic citizen account with an email inbox you control and authorise for testing. Trigger one case status update and inspect its outbox event, provider result and received message. Seed addresses ending `@surakuma.test` are placeholders for local capture, not delivery inboxes. Existing captured events are not automatically resent when switching provider. A `Review` result requires provider-side investigation before another attempt. Set `Email__Provider=Capture` and restart to return to local demonstration mode.

## openrouteservice

Create an account through [openrouteservice](https://openrouteservice.org/), select its available free API access, and set `Mapping__ApiKey`. After restart, search for a public Sri Lankan demonstration location and generate a short driving route between public points. Record success or explicit unavailability without private household coordinates. The provider expects longitude before latitude internally; see its [routing guidance](https://giscience.github.io/openrouteservice/frequently-asked-questions). Driving output does not certify a safe evacuation route. OpenStreetMap tiles and routing are separate integrations.

## Evidence to complete after account setup

| Service | Configuration | Live synthetic check | Evidence |
| --- | --- | --- | --- |
| Gemini | Not configured | Not executed | Provider/model, timestamp, fallback flag, human decision |
| Brevo | Capture mode | Not executed | Authorised recipient, event/reference, received email; redact addresses in shared evidence |
| openrouteservice | Not configured | Not executed | Public search result, route geometry, timestamp |

The table records the local state on 21 October 2026. Update it only after actual live checks. Provider plans and terms can change; official links are the setup reference.
