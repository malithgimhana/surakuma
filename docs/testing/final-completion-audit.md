# Coursework completion audit

18 November 2026. The starting commit was `b01a16601b3df3c3662613d2017f6faf61a91583` on `main`, confirmed identical to GitHub `main`. This audit covers the implementation in the working tree and the original SE205.3 Software Architecture coursework brief, specifically sections 1.1, 5.I and 7.

## Scoring

Each requirement has equal weight within its own set. **0** means missing, **25** means preliminary work or configuration only, **50** means a partial functioning path, **75** means implemented with major verification gaps, **90** means an operational path verified through automation, and **100** requires complete applicable demonstration and external evidence. Intermediate scores reflect the scope in each row and the severity of the listed gaps. These are software completion estimates. The report, grading rubric and individual contribution evidence have separate assessment criteria.

| Set | Calculation | Completion |
| --- | --- | ---: |
| Minimum prototype | (94 + 95 + 95 + 96 + 94 + 95 + 96 + 97 + 90 + 84 + 85 + 97) ÷ 12 | **93.2%** |
| Full functional requirements A–J | (88 + 94 + 85 + 93 + 95 + 95 + 91 + 94 + 68 + 90) ÷ 10 | **89.3%** |
| Section 7 advanced requirements | (98 + 92 + 97 + 95 + 96 + 95 + 90 + 98 + 95) ÷ 9 | **95.1%** |
| Test and validation readiness | (98 + 98 + 95 + 99 + 50 + 25 + 95) ÷ 7 | **80.0%** |

## 5.I Minimum prototype deliverables

| Exact deliverable | Status | Backend and stored evidence | Frontend evidence | Automated checks and limits | Score |
| --- | --- | --- | --- | --- | ---: |
| Affected Person / Citizen Portal | Verified in isolation | Identity, household, case history/evidence, feedback and outbox | Guided request, timeline and profile | Citizen Playwright, household SQL and scope tests. Participant UAT and live email pending. | 94 |
| Emergency Coordination Dashboard | Verified in isolation | Crisis, area, grants, recommendation, review, case linkage and reports | Staff and admin crisis/case workspaces | Flood, crisis alert, three-country checks. Pending broader operational and translation review. | 95 |
| Resource / Logistics functionality | Verified in isolation | Inventory, movements, reservations, receipts, transfers, partner and donation credit | Logistics workspace and case approvals | Logistics and concurrency tests, recorded partial fulfilment scenario. Field logistics validation pending. | 95 |
| Shelter Management functionality | Verified in isolation | Capacity, placements, stay events and shortage handoff | Shelter dashboard, maps and ranked candidates | SQL concurrent reservation, multi-country check-in and supply tests. Field review pending. | 96 |
| Volunteer Management functionality | Verified in isolation | Volunteer profile, assignment windows and task events | Roster, candidate ranking, volunteer reports and reviewer workflow | Overlap, decline/reassignment, independent verification. Recurring planning and travel checks pending. | 94 |
| Administration functionality | Verified in isolation | Membership scopes, audit, country registration, verification and change review | Existing dashboards with funding, coverage and partner operations | Admin and scope tests plus browser navigation. Operations sign-off and deployment pending. | 95 |
| ASP.NET Web API backend | Verified in isolation | Controllers, application services, provider adapters and EF transactions | Requests use normal app entry points | Backend suite and real browser/API journeys. Distributed operational load remains untested. | 96 |
| SQL Server database | Verified in isolation | Additive migrations, FKs, check constraints, row versions, idempotent event and receipt indexes | UI reads/writes real stored records | Isolated SQL Server LocalDB clean install and preserved-data upgrade. Active deployment remains pending. | 97 |
| AI-assisted feature(s) | Automated fallback and mock verified | Provider ports, recommendations, human decisions, flags, forecasts and briefings | Case AI review, crisis briefing, forecast and investigation workspaces | Synthetic fallback, draft adapter and SQL governance. Live Gemini and calibrated confidence pending. | 90 |
| At least one communication integration | Capture verified; configured delivery pending | Brevo adapter, durable outbox, delivery attempts and notification ownership | Staff and citizen inbox and donor updates | Capture/resend and mocked provider tests. Live sender/inbox pending. | 84 |
| At least one mapping integration | Scoped maps and adapter checks verified | Country geography, coordinate checks, route provider and distance calculations | Maps, location selection and regional coverage | Endpoint shape, outage and browser flows. Live authenticated route/geocode pending. | 85 |
| API testing using Postman and/or Swagger | Verified in isolation | Development OpenAPI from registered endpoints and typed contracts | Swagger UI executes public GET | Automated Swagger GET and direct HTTP comparison. Protected contracts covered by authenticated API tests. | 97 |

## 1.1 Functional requirements A–J

The [traceability matrix](requirements-traceability.md) lists the exact bullets and the relevant subsystems, data and tests for each group.

| Exact group | Status | Evidence considered | Main deduction | Score |
| --- | --- | --- | --- | ---: |
| A. Affected Person / Citizen Portal | Partially complete | Identity, household, case/attachment/history, feedback, translations and browser/SQL citizen journey | Citizen-facing AI support, dedicated service-centre map and live email | 88 |
| B. Emergency Coordination Dashboard | Verified in isolation | Crisis/areas, scoped case controls, consolidation, alert review, partner handoff and reporting | Broad human review and numeric AI confidence | 94 |
| C. AI Decision-Support Services | Partially complete | Provider tests, deterministic recommendations and matching, structured briefs, anomaly queue and weekly forecast records | Live Gemini, automatic classification on all submissions, request-level regional forecasting, volunteer travel data and multilingual citizen generation | 85 |
| D. Human-in-the-Loop Governance | Verified in isolation | Original suggestions, nullable confidence, authorized decisions/timestamps, role gates and audit records | Calibrated confidence and dedicated post-incident AI report | 93 |
| E. Resource and Logistics Management | Verified in isolation | Scoped stock/depot ledger, shortages, recommendations, transfers and accepting verified inter-organisation supply | Fleet/personnel detail and real transport validation | 95 |
| F. Shelter Management | Verified in isolation | Registered facility, capacity and location, concurrency, reservation/check-in and structured shortages | Dedicated centre stock/capacity expansion management | 95 |
| G. Volunteer Management | Verified in isolation | Profile, skill candidates, task windows, workflow and staff verification, decline/reassignment checks | Recurring calendar and location-aware volunteer scheduling | 91 |
| H. Donor and Donation Management | Verified in isolation | Donor profile, country campaign, monetary/material ledger, review flags, receipt replay protection, portal transparency and browser/SQL reconciliation | Multi-member donor organisations and live notification evidence | 94 |
| I. Communication Services | Partially complete | Brevo adapter and in-app routing, country alert publication, local templates, donation and case status events | SMS/push and live Brevo, broadcast subscriptions and independent language review | 68 |
| J. Mapping and Location Services | Implemented; live verification pending | Scoped maps and regional coverage, country geocoding, geographic distance and authenticated route adapter tests | Live HeiGIT call and dedicated centre coverage | 90 |

## 7. Advanced / Novel Requirements

| Exact requirement | Status and evidence | Remaining verification | Score |
| --- | --- | --- | ---: |
| 1. AI recommendations must be reviewable and overridable by authorised staff. | Verified. `Decide`, `HumanDecision`, and case controls support approve, modify, reject and defer. Household SQL and browser tests exercise separate human decisions. | Live Gemini recommendation and independent UAT. | 98 |
| 2. Every AI-assisted decision must produce an audit record containing the recommendation, confidence, human action, and timestamp. | Verified for persisted case recommendations and their review. Stored recommendations, nullable confidence, human decisions and audit entries preserve the inputs and actors. | Numeric confidence is unavailable for uncalibrated provider and fallback outputs. Some decision support is advisory only. | 92 |
| 3. The system must identify potential duplicate assistance requests without automatically deleting valid requests. | Verified. Stored `PotentialDuplicate` candidates, independent review state, case investigation and explicit consolidation with preserved original record. | Wider representative and cross-organisation duplicate review. | 97 |
| 4. The resource-allocation mechanism must consider multiple constraints rather than simply selecting the nearest resource. | Verified. `RankedAllocationStrategy`, stock and commitment records, accessible descriptions and manual confirmation. | Travel and unit suitability require operator checks. | 95 |
| 5. The system must handle a shortage scenario in which multiple urgent requests compete for the same limited resource. | Verified. Scoped priority/approval-age ranking and serializable allocation protect scarce stock; household scenario replenishes through a partner receipt. | Concurrent and cross-agency field operation beyond the test profiles. | 96 |
| 6. The notification workflow must avoid duplicate user notifications when the same event is processed more than once. | Verified. SQL event/recipient uniqueness, lease/attempt state and no automatic retry of unknown send outcomes. Existing captured case event and new funding event tests. | Provider-side delivery reconciliation under a real response interruption. | 95 |
| 7. The system must handle temporary failure of an external AI, mapping, or communication service. | Verified in tests. Labelled rules fallback, manual map/location entry, missing translation status, retry/uncertain states and captured operational evidence. | Actual provider failure testing pending authorization/configuration. | 90 |
| 8. At least one major workflow should be implemented using asynchronous processing or an event-driven mechanism, with the architecture clearly documented. | Verified. A committed SQL outbox drives the background worker and recovery workflow. [Architecture](../architecture/decisions.md) documents the worker boundary and persisted retry. | Multi-instance operations and live provider reconciliation. | 98 |
| 9. The solution should expose suitable operational metrics such as unresolved cases, average response time, resource utilisation, shelter occupancy, and AI override frequency. | Verified. `Operations.Metrics` and country reports use persisted case transitions, stock reservation/fulfilment, shelter places and human-decision counts. | No audited replication against field statistics. | 95 |

## Test and validation readiness inputs

| Dimension | Score | Rationale |
| --- | ---: | --- |
| Backend, unit, API and SQL operations | 98 | Automated operational and integrity coverage. Independent staging release pending. |
| Frontend typecheck, production build and Vitest | 98 | Automated build/type and unit UI validation. |
| Browser journeys, themes, keyboard and accessibility | 95 | Automated selected routes at desktop and mobile widths. Broad assistive-technology UAT pending. |
| Migrations and data preservation | 99 | Clean isolated application and upgrade from a verified synthetic Phase 1 backup. |
| External service verification | 50 | Adapter behavior and capture verified. Authenticated provider and inbox checks pending. |
| Participant and language review | 25 | Review scaffolding and automated evidence only. |
| Reproducible synthetic workflows and audit evidence | 95 | Executed workflows and demonstration instructions. Field evidence is outside this record. |

See the [executed results](full-workflow-results.md) for commands, pass/fail counts and scenario evidence. [Remaining blockers](remaining-blockers.md) tracks applicable live checks and unfinished scope.
