# Architecture decisions

| Decision | Reason and trade-off |
| --- | --- |
| Modular monolith | One developer, one SQL transaction boundary, repeatable local setup. Independent scaling of modules is deferred. |
| Clean dependency direction | Domain and Application compile without ASP.NET or EF dependencies. Infrastructure contains Identity/persistence/provider details. |
| EF Code First + SQL Server | Executable migration history and actual row-version/transaction behaviour. Integration tests require SQL Server rather than an in-memory substitute. |
| Scoped repository port | IStore/EfStore centralise persistence and transaction boundaries. IQueryable provides pragmatic EF query composition; a stricter specification repository can replace it if scale warrants it. |
| Dependency injection | Controllers and use cases receive replaceable ports; tests can substitute provider responses without network calls. |
| Strategy | IAllocationPolicy / ConstraintAllocationPolicy enforce category, available quantity, transport and outstanding commitments consistently. Location/suitability are shown for staff verification; no nearest-only automatic dispatch. |
| Factory | EmailProviderFactory selects the explicit Capture or Brevo adapter from configuration and rejects unknown provider modes. |
| Adapters | AI, email and maps expose stable application interfaces while translating external payloads internally. |
| Durable event processing | Outbox records implement a persisted event/consumer workflow; no infrastructure broker is required. |
| Human approval | AI classification/priority are proposals. AI review, request approval and resource/shelter approval are separate operations. |
| Confidence | Null means unavailable; no invented calibrated probabilities. Similarity is stored separately as a named heuristic. |
| Privacy | Synthetic-only external free AI, minimal payloads, private evidence, explicit organisation/case access. |
| JWT and refresh rotation | Access tokens remain in memory; hashed refresh tokens persist and rotate. Replay revokes remaining refresh sessions for that user. Access tokens expire after 15 minutes. |
| Local demonstration | HTTPS API plus local Vite proxy; no hosted account or payment card required. Production hosting/security operations remain outside this local prototype. |

## Known constraints

- External Gemini, Brevo and openrouteservice adapters require account access and live validation; their absence must remain visible.
- Volunteer availability currently combines a manually reviewed schedule string and an available/unavailable flag; recurring calendar conflict optimisation is deferred.
- Resource suitability and travel safety require staff judgement. Route output is not a verified safe evacuation route.
- Unknown email outcomes require manual investigation; no unsafe automatic resend button is provided.
- Authentication does not include self-service forgotten-password/email-verification flows in this core release.
- Translation strings exist for citizen journeys; native-speaker review and assistive-technology UAT are required before claiming a reviewed trilingual or accessibility-conformant release.
- Advanced partner support requests/donation records and optional features are expansion work. Core explicit case sharing is implemented.
