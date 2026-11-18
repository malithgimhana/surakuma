# Surakuma Phase 1 completion

The rollout target is migration [20261117190016_PhaseOneWorkflows](../../backend/src/Surakuma.Infrastructure/Migrations/20261117190016_PhaseOneWorkflows.cs). Verification uses separate SQL Server LocalDB databases and the capture email provider.

## Acceptance checklist

| Acceptance criterion | Classification | Evidence |
| --- | --- | --- |
| Volunteer assignments enforce eligible case statuses | COMPLETE | The [assignment service](../../backend/src/Surakuma.Application/Operations.cs) requires approved or active fulfilment with outstanding assistance. The candidate search uses the same status and outstanding checks. |
| Volunteer completion reports contain meaningful information | COMPLETE | The [volunteer form](../../frontend/src/StaffSupport.tsx) records the work, outcome, optional people assisted, issues and notes. The service validates the work and outcome. |
| Completed volunteer work requires verification | COMPLETE | An authorized independent reviewer can verify or return the report. The [household journey test](../../backend/tests/Surakuma.Tests/DemonstrationIntegrationTests.cs) exercises correction, resubmission, verification and notification. |
| Delivery confirmation records accountable receipt details | COMPLETE | [Delivery receipts](../../backend/src/Surakuma.Application/DeliveryReceipts.cs) validate reference, actual time, method, representative, quantity and exceptions. [Logistics tests](../../backend/tests/Surakuma.Tests/LogisticsTests.cs) cover dispatches and depot transfers. |
| Duplicate fulfilment is prevented | COMPLETE | State transitions, row versions, serializable transactions and a unique delivery receipt per allocation or order protect the ledger. The [workflow tests](../../backend/tests/Surakuma.Tests/WorkflowIntegrationTests.cs) cover receipts before dispatch, over-quantity receipts, retries and partial receipt. |
| AI review no longer defaults to High | COMPLETE | [Case details](../../frontend/src/StaffPages.tsx) show the case and suggested priorities. The [decision regression test](../../frontend/src/test/case-reason.test.tsx) verifies initialization from a Low recommendation and requires a reason to modify it. |
| Allocation controls match backend eligibility | COMPLETE | [Case details](../../frontend/src/StaffPages.tsx) show current status and the approval prerequisite. Resource forms account for stock and outstanding commitments. Shelter forms account for household size, accessibility and active placement. |
| Public alert publication has controlled approval | COMPLETE | [Alert workflow](../../backend/src/Surakuma.Api/Controllers/AlertWorkflow.cs) separates draft, submission, independent review and publication. [Alert integration tests](../../backend/tests/Surakuma.Tests/CrisisOperationsTests.cs) verify visibility, translations, reviewer permissions and withdrawal. |
| Emergency alert overrides are authorized and audited | COMPLETE | Country or System Administrators can publish Critical alerts with justification. An independent post-publication review is tracked even if the alert expires or is withdrawn. |
| Partner workspace is functional and organization-scoped | COMPLETE | [Partner workspace](../../frontend/src/PartnerWorkspace.tsx) uses verified memberships and explicit case-linked work assignments. Offers, commitment decisions and fulfilment progress use separate records. [Permission tests](../../backend/tests/Surakuma.Tests/PhaseOneWorkspaceTests.cs) exercise two organisations and country restrictions. |
| Specialist dashboards show relevant operational information | COMPLETE | [Staff overview](../../frontend/src/StaffOverview.tsx) loads [role-scoped metrics](../../backend/src/Surakuma.Api/Controllers/StaffOverviewController.cs). Links open the appropriate cases, inventory, shelters or volunteer queues. Multi-role accounts can select a dashboard role. |
| Shelter Administrators have an operational dashboard | COMPLETE | The shared [shelter dashboard](../../frontend/src/ShelterDashboard.tsx) includes facility availability, warnings, reservations, check-ins and departures. |
| Shelter information remains organization-scoped | COMPLETE | [Shelter dashboard tests](../../backend/tests/Surakuma.Tests/ShelterDashboardTests.cs) cover System and Country Administrators, Shelter Administrators, a Case Manager, a Citizen, a second organisation and another country. |
| Resource forms avoid incorrect coordinates | COMPLETE | [Location fields](../../frontend/src/ResourceLocationFields.tsx) begin blank for new stock and support country-centered map selection. [Server validation](../../backend/src/Surakuma.Application/CountryLocations.cs) checks against the existing country boundaries and confirms any selected division belongs to that country. |
| Country Administrator label is correct | COMPLETE | [Workspace layout](../../frontend/src/layouts.tsx) uses COUNTRY ADMINISTRATION for national administrators. The live browser suite checks the label. |
| Navigation matches permissions | COMPLETE | [Routes](../../frontend/src/main.tsx) and [navigation](../../frontend/src/layouts.tsx) provide partner, specialist and administration entry points. API permissions control the underlying reads and writes. |
| Notifications and audit history work correctly | COMPLETE | [Notification routing](../../backend/src/Surakuma.Application/InternalNotifications.cs) preserves citizen email policy and routes report, delivery, escalation, partner and alert events to authorized internal recipients. The [household journey](../../backend/tests/Surakuma.Tests/DemonstrationIntegrationTests.cs) verifies captured citizen email, volunteer notices and audit records. |
| Existing administration redesigns are preserved | COMPLETE | The case queue, administration overview, crisis operations, alerts, logistics, shelter and report layouts remain the entry points. Existing administration UI checks run in Vitest and the live browser suite. |
| Multi-country isolation remains intact | COMPLETE | Scope is enforced by country, organisation, crisis, role and ownership. [Live acceptance](../../frontend/e2e/international-live.spec.ts) exercises LK, IN and NP. |
| Frontend and backend builds succeed | COMPLETE | The backend build, TypeScript check and Vite production build passed through the supported script. |
| Relevant tests pass | COMPLETE | 132 backend tests, 67 frontend tests and all three isolated Playwright scenarios passed. |

## API changes

All routes below are under `/api/v1`. The public `GET /alerts` feed retains its country filter and alert content fields.

| Route | Change |
| --- | --- |
| `GET /volunteer-tasks/cases` | Search the first 20 scoped, eligible cases for assignment. |
| `GET /volunteers`, `POST /volunteer-tasks`, `POST /volunteer-tasks/{id}` | Scoped roster history, assignment eligibility and structured completion, return and verification. |
| `POST /allocations/{id}/Deliver`, `GET /allocations/{id}/receipt` | Submit and read an authorized receipt. The request detail exposes only the confirmed amount from the receipt. |
| `GET /logistics`, `POST /logistics/allocations/{id}/deliver`, `POST /logistics/orders/{id}/deliver` | Optional specialist view and receipt payload for allocation, dispatch and transfer completion. Existing stock configuration and ledger operations continue to use the logistics module. |
| `POST /alerts`, `PUT /alerts/{id}` | Create or edit an alert draft. |
| `POST /alerts/{id}/{operation}` | Submit, approve, return, publish, emergency-publish, post-review or unpublish. |
| `GET /alerts/{id}/history`, `GET /staff/alert-workflow`, `GET /admin/crisis-operations/alerts` | Authorized history, reviewer queue and workflow states. |
| `GET /partner`, `GET /partner/commitments` | Verified organization workspace and administrator commitment queue. |
| `POST /partner/contributions`, `PUT /partner/contributions/{id}`, `POST /partner/contributions/{id}/{operation}` | Record offers, edit pending offers, accept, decline, withdraw and record cumulative fulfilment. |
| `GET /partner/cases/{id}/shares`, `PUT /partner/cases/{id}/shares/{organisationId}`, `DELETE /partner/cases/{id}/shares/{organisationId}` | List, assign or revoke case-linked partner work. |
| `GET /staff/overview/{role}`, `GET /requests` | Role dashboard and filtered role-scoped case queues. |
| `GET /staff/shelters?dashboard=true`, `GET /staff/shelters/{id}?allocation=true` | Shelter metrics, detail and candidates scoped to the authenticated specialist or administrator. |
| `POST /resources`, `GET /notifications` | Country-coordinate validation and opt-in scoped partner inbox, including unread count and read operations. |

## Migration and data integrity

- [20261117190016_PhaseOneWorkflows](../../backend/src/Surakuma.Infrastructure/Migrations/20261117190016_PhaseOneWorkflows.cs) adds volunteer task history, delivery receipts, partner contributions, case share instructions, alert workflow metadata and scoped notification fields.
- Existing published alerts are classified as legacy publications with null reviewer and publication-time fields. Historical delivered allocations retain their original quantities without receipt records. Historical volunteer tasks retain their existing states. A legacy task awaiting verification can be returned for a structured report.
- Dispatch deducts source stock. A depot receipt credits the quantity actually received. A failed delivery records zero and frees the outstanding case requirement for further allocation. Corrections to physical stock use the explicit stock movement workflow.
- A partner can read redacted work only after explicit assignment. Offers and fulfilment progress are separate from inventory, dispatch and delivery. The organization profile displays the signed-in representative’s contact details and actual membership scope.
- Volunteer reports store narrative evidence and an optional people count. An authorized volunteer may have one open assignment per case through the case’s assigned organisation.
- Normal alert reviewers are Country or System Administrators with scope to the crisis country. Escalated, partner, receipt and task notices contain operational summaries. Receipt names and report details remain in the relevant scoped records.
- Coordinate validation uses the repository’s existing simplified national map geometry. Staff enter or select the actual location and can review coordinates before saving.

## Files created or modified

| Area | Files |
| --- | --- |
| API controllers | `AlertWorkflow.cs`, `PartnerController.cs`, `StaffOverviewController.cs` (new). `CrisisAdministrationController.cs`, `LogisticsController.cs`, `OperationsController.cs`, `RequestsController.cs`, `ShelterDashboard.cs`. |
| Application and domain | `CountryLocations.cs`, `DeliveryReceipts.cs`, `PartnerContribution.cs` (new). `Contracts.cs`, `InternalNotifications.cs`, `Operations.cs`, `Ports.cs`, `Surakuma.Application.csproj`, `Logistics.cs`, `Models.cs`. |
| Infrastructure | `Data.cs`, `CrisisDbContextModelSnapshot.cs` and the two `20261117190016_PhaseOneWorkflows` migration files. |
| Frontend workspaces | `DeliveryFields.tsx`, `PartnerWorkspace.tsx`, `ResourceLocationFields.tsx`, `StaffOverview.tsx` (new). `AdminLogistics.tsx`, `CitizenPages.tsx`, `CrisisAlerts.tsx`, `CrisisOperationsPage.tsx`, `LogisticsDialogs.tsx`, `MapView.tsx`, `ShelterDashboard.tsx`, `StaffPages.tsx`, `StaffSupport.tsx`, `auth.tsx`, `i18n.ts`, `layouts.tsx`, `locales/ne-hi.ts`, `logistics.ts`, `main.tsx` and `types.ts`. |
| Tests and recording | `PhaseOneWorkspaceTests.cs` (new). `CrisisOperationsTests.cs`, `DemonstrationIntegrationTests.cs`, `InternationalEndpointTests.cs`, `LogisticsTests.cs`, `ShelterDashboardTests.cs`, `WorkflowIntegrationTests.cs`, five frontend regression test files, `acceptance.spec.ts`, `international-live.spec.ts` and `demo/record.ts`. |

## Manual verification by role

1. In an isolated test database, sign in as a Citizen and submit a request. As its Case Manager, begin review, verify the case and open an AI recommendation. Check the initialized priority, attempt a modification with a blank reason and then explicitly record a decision. Approve the case separately.
2. As a Volunteer Coordinator, search for the case before approval and again after approval. Assign a verified volunteer with a suitable skill and future due date. As the volunteer, accept, start and complete the work. As the coordinator, use **Reports awaiting verification** to return it, review the corrected report and verify it.
3. As Logistics Staff, reserve and dispatch stock from the approved case. Enter a receipt for less than the dispatched amount with an exception reason. Check the citizen’s outstanding quantity and the logistics receipt. Retry the same confirmation and check the quantity again.
4. As a Shelter Administrator, reserve a suitable facility and manage the arrival and departure from its detail panel. Compare the visible facilities and allocation candidates with a Country Administrator in that country. Test a second organisation and another country.
5. As a Crisis Coordinator, review assigned crises and filtered case queues. Assign partner work from an approved case. As a verified Partner, review the work and its notification, submit an offer, then record progress after a Country or System Administrator accepts it.
6. Create a public alert draft with the selected country’s required translations. Submit it. Use a separate administrator account to approve it in the review queue, then publish it. Check the public feed in two countries and withdraw the alert with a reason. Test the emergency action using a Critical alert and record the independent post-publication review.
7. Switch among LK, IN and NP in the System Administrator workspace. Open **Overview**, **Crisis operations**, **Resources**, **Shelters** and **Reports**. As a Country Administrator, check the fixed country and sidebar caption. On a narrow viewport, navigate to the Partner assigned work and shelter details with keyboard controls.

## Verification results

- `.\scripts\Test.ps1` passed 132 backend tests and 67 frontend tests. It also passed the TypeScript check and Vite production build. The final run executed by itself after two SQL migrations timed out during an earlier concurrent run with Playwright.
- Playwright ran through `pwsh -NoProfile -File .\scripts\Test-InternationalAcceptance.ps1` against an isolated API and LocalDB database. All three scenarios passed, covering three-country request and receipt workflows, the volunteer report and Partner workspaces, alert approval, and country administrator isolation. The suite checked narrow-screen overflow and serious or critical Axe violations on the tested citizen, Partner and administration pages.
- EF Core reported zero pending model changes and generated an idempotent upgrade script from `20261117120000_DefaultAlertLanguages` to `20261117190016_PhaseOneWorkflows`.
- LocalDB and capture email were used for integration testing. The API in use was holding the default build files open, so the test run used isolated build output under `tmp/phase1/build`. NuGet’s advisory lookup was unavailable in the environment. The runs used cached dependencies and disabled the advisory lookup for the test process.

## Remaining rollout work

Live rollout remains pending. Provider delivery verification covers captured email events. The updated demonstration recording script was checked against the revised flows in source. Running the recorder and refreshing the demonstration media are separate from this verification.
