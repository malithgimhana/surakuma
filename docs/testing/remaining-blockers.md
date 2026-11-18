# Remaining work and verification boundaries

## External verification

| Integration | Current evidence | Required verification |
| --- | --- | --- |
| Gemini classification | Synthetic gate, adapter response/failure tests, deterministic fallback on an isolated API. | Set `Ai__ApiKey` using secure configuration, verify access to the configured `Ai__Model`, then request a recommendation for an explicitly synthetic case. Record the external provider/model and a separate authorized decision. |
| Gemini briefs and translation | Aggregate-only briefing prompt, isolated mock result and outage behavior. Internal summary fallback and manual translation path exercised. | Configure `Ai__OperationalBriefingsEnabled` and/or `Ai__PublicTranslationEnabled` after setting the key. Use synthetic counts and public draft wording with no personal information. Record returned provider, an independent briefing review and the public alert approval outcome. |
| Brevo | Capture-mode completion and donor events, mocked retries and uncertain delivery, SQL outbox/deduplication. | Configure `Email__Provider=Brevo`, `Email__ApiKey` and a verified `Email__Sender`. Use a designated inbox whose owner has authorized the test. Trigger one synthetic event and record both the provider reference and inbox receipt. |
| HeiGIT | Configured endpoint construction for LK/IN/NP, unconfigured reverse/geocode fallback and map views with scoped data. | Set `Mapping__ApiKey`; test geocoding, reverse geocoding and an ordinary route using public landmarks. Record sanitized HTTP success and country/distance evidence. |
| SMS and browser push | Pending implementation. | Choose providers and add independently revocable consent, verified recipient endpoints, quiet preferences where required, provider-specific retries, deduplication and delivery evidence. |

The observed task environment did not supply configured Gemini, Brevo or HeiGIT credentials or an authorized Brevo test inbox. Verification used synthetic records and simulated, fallback or captured provider modes. See the existing [integration runbook](../integrations.md) for secure setup and safe operational recovery.

## Product and rollout

- Add a multilingual citizen-facing AI assistance interface restricted to approved service guidance. Existing AI writes require staff confirmation and localized templates already support citizen journeys.
- Add calibrated confidence if an evaluated model can produce it. Current recommendation confidence can be null and the interface labels it unavailable.
- Record standardized demand units and request-level administrative region data to improve historical grouping and stock risk assessment. The current baseline forecasts weekly request counts in a crisis's region with a minimum data gate.
- Add volunteer recurring availability and consented travel locations for suitability checks. Existing task windows block overlaps for scheduled work and simultaneous starts.
- Add multi-member donor organisation profiles, externally validated finance integrations if required, and any recovery process for ledger corrections after receipt. Current monetary flows record verified references and use one currency per campaign. Material receipts credit pooled stock.
- Add dedicated public service-centre locations and incident coverage comparisons based on population and travel time. Current coverage counts registered shelters, inventory and crises by top-level division.
- Obtain independent native-speaker review, accessibility and participant UAT. Synthetic and automated browser checks are recorded separately.
- Apply pending migrations to the active demonstration database only under an authorized rollout after a verified backup. The coursework implementation used isolated SQL databases and left existing demonstration records in place.
- Review the final report, contribution records and submission package separately. The software percentages do not score the report or an individual's contribution.
