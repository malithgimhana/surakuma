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
- Volunteer availability combines a manually reviewed schedule, an availability flag and explicit task windows. New windows are checked across profiles for the same account. Legacy tasks without start times block another simultaneous start once in progress.
- Resource suitability and travel safety require staff judgement. Route output is not a verified safe evacuation route.
- Unknown email outcomes require manual investigation; no unsafe automatic resend button is provided.
- Password recovery uses the configured security email worker. Provider inbox delivery and human review require separate evidence.
- Translation strings exist for citizen journeys; native-speaker review and assistive-technology UAT are required before claiming a reviewed trilingual or accessibility-conformant release.

## Coursework workflow decisions

| Decision | Rationale and boundary |
| --- | --- |
| Funding ledger with transactional receipts | A recorded pledge contributes zero to received funds. Funding staff verify external financial documents. Material confirmation also requires logistics access and admits stock through a tracked movement. Funding allocations, actual expenses and physical case deliveries remain distinct and reconcile against confirmed balances. |
| Funding scope and privacy | Funding grants reuse organisation, country and optional crisis memberships. Grants do not grant case-file or crisis-coordination access. Donors can see their records and campaign aggregates, with case identifiers, receipt and invoice references omitted from donor views. |
| Rule-based forecasts | Eight complete UTC weeks, at least eight submissions in four distinct weeks, arithmetic mean of weekly case counts and descriptive observed bounds. Capture inputs, timeframe, author, category, region reference and model version. Requested quantities lack a common unit and are descriptive. |
| Decision records and communications | Cases and funding use advisory indicators, a recorded staff outcome and audit history. Briefings store structured facts separately from optional Gemini interpretation. Independently reviewed briefings remain internal. Public alert wording continues through the existing approval workflow. |
| Optional external drafting | `Ai__OperationalBriefingsEnabled` passes aggregate counts only. `Ai__PublicTranslationEnabled` accepts explicitly confirmed public wording. Both require a key. Staff must verify all generated text. Missing translations retain the manual-entry path. |
| Consolidation | The original case is retained, linked and made ineligible for further fulfilment. Same citizen/organisation/crisis and matching aid requirement are required. Existing allocations, paid commitments, active sharing or escalation on the original prevent consolidation. |
| Partner and shelter handoff | A requesting organisation scopes a supply request to a verified partner. Administrators approve commitments. Receiving logistics staff record actual quantities and receipt references in the existing stock ledger. Accepted offers and self-reported progress have no stock side effect. |
| Verified send and retry | Existing citizen and staff routing remains in place. Funding adds generic donation email events to the durable outbox and country-scoped staff inbox events. Event-recipient keys prevent double processing. Unknown delivery states require manual reconciliation. |
| Ordinary road routing | Geocoding requests and cache partitions include the selected country. Route responses are labelled ordinary driving estimates. Coverage aggregates by stored administrative hierarchy and reports unclassified legacy records separately. |
