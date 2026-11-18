# Executed coursework workflows

18 November 2026. The browser runner and API integration fixtures used separate, randomly named SQL Server LocalDB databases, generated account credentials and synthetic records. Evidence uploaded by integration tests was stored separately. Email ran in capture mode; AI and authenticated maps used fallback or test adapters.

## Scenario evidence

| Scenario | What the automated workflow verifies | Evidence and boundaries |
| --- | --- | --- |
| A. Sri Lanka flood response | A coordinator records an operational area, submits an alert and publishes only after independent approval. A citizen submits a located case and isolated image. Staff review the AI fallback, override priority with a reason, review a duplicate indicator and approve the case. Logistics verifies stock shortage and partial delivery, receives an accepted case-linked partner offer, and dispatches the remainder. The same household has a separate shelter stay, volunteer report, independent verification, citizen feedback, closure and audit. The coordinator creates a draft briefing and a forecast, and an administrator exports the report. | `DemonstrationIntegrationTests.FloodHouseholdJourneyPreservesHumanReviewStockShelterVolunteerNotificationsAndAudit`. The citizen/staff Playwright workflow separately runs login, submission, review, inventory, dispatch, partial delivery and closure. Sparse forecast withholds an estimate. |
| B. India emergency | Country-admin and assigned coordinator create a geographically scoped crisis for a verified organisation, submit and approve an English/Hindi alert, receive a citizen case, dispatch and confirm aid, reserve and check in a household, and verify coverage. | `CourseworkWorkflowTests.RegionalResponseUsesLocalGeographyAlertPolicyInventorySheltersAndScopedStaff(IN)`, `CrisisOperationsTests` and live browser multi-country shipping. A Sri Lankan coordinator cannot see the foreign case or briefing workspace. |
| C. Nepal emergency | Equivalent regional workflow with Bagmati geography and English/Nepali alert requirements. Tests cover scoped crisis, inventory, shelter and authorised staff and show the correct country in the browser. | `CourseworkWorkflowTests.RegionalResponseUsesLocalGeographyAlertPolicyInventorySheltersAndScopedStaff(NP)` and live browser multi-country shipping. External route/geocode delivery pending. |
| D. Donation lifecycle | Donor profile, campaign, pledge and cancellation, repeat submission, independent receipt, unauthorized access, one accepted concurrent material allocation, confirmed stock intake, actual delivery attribution, financial expense and campaign cap. Scope checks protect invoice and receipt details. Captured donor status, audit and report totals reconcile. | `CourseworkWorkflowTests.FundingLedgerReconcilesPledgesReceiptsStockAllocationsExpensesAndCapturedNotifications`. Browser scenario exercises the monetary lifecycle in the normal funding and donor routes. External receipt examples are synthetic. |
| E. Service failure and conflict | AI unavailable or malformed result, manual translation after missing AI provider, map unavailable, Brevo rate limit and unknown outcome, durable retries and deduplication, SQL races, insufficient stock and space, and funding over-allocation. | `ProviderTests`, `ResilienceTests`, `WorkflowIntegrationTests`, `LogisticsTests` and the funding SQL scenario. Outage tests use fixtures and injected responses. |
| F. Security | Anonymous/authenticated checks; citizen, volunteer, Partner, logistics, shelter, coordinator, funding and administrator role boundaries; case/crisis, organisation and country isolation; allowed and denied evidence, approvals and write operations. | `IntegrationTests`, `CountryAccessIntegrationTests`, `InternationalEndpointTests`, `PhaseOneWorkspaceTests` and the new coursework tests. Browser verifies the country scope of coordinators and administrators. |
| G. Operational edge cases | Submission replay, actual and repeated delivery confirmation, partial delivery, shelter release/capacity conflict, scheduled overlap, volunteer decline and reassignment, expired and critical alert review, pledge cancellation, inter-depot/cross-border inventory and concurrent reservation. | `WorkflowIntegrationTests`, `CrisisOperationsTests`, `InternationalAllocationIntegrationTests`, `LogisticsTests` and the new coursework tests. |

## Running verification

```powershell
$env:SURAKUMA_TEST_SERVER = '(localdb)\MSSQLLocalDB'
dotnet test backend/Surakuma.sln -m:1
Push-Location frontend
npm run build
npm test
Pop-Location
pwsh -NoProfile -File scripts/Test-InternationalAcceptance.ps1
```

The browser runner exports the live development OpenAPI document in the isolated run directory. It includes separate live browser journeys for Sri Lanka, India and Nepal within the international case, funding, alert approval, Partner work, volunteer review, responsive layouts, keyboard and text scaling, contrast, country administration and Swagger. Isolated API tests exercise features beyond the recorded browser paths, including competing donation allocations and regional shelter check-in.

| Final check | Result | Local run evidence |
| --- | --- | --- |
| Backend build and SQL/API suite | 140 passed, zero failed or skipped | `tmp/coursework/results/coursework-final.trx` |
| TypeScript and Vite production build | Passed. Existing dependency annotation and bundle-size warnings remain. | `tmp/coursework/results/frontend-build.log` |
| Vitest | 67 passed across 23 files, zero failed or skipped, using one worker after the browser/SQL runs finished | `tmp/coursework/results/vitest-final.log` |
| Playwright | 16 passed, zero failed or skipped | `tmp/coursework/results/playwright-final.log` |
| EF model and idempotent upgrade script | No pending model changes; generated successfully | `tmp/coursework/coursework-upgrade.sql` |
| Live providers or participant UAT | Pending | [Blockers and exact setup](remaining-blockers.md) |

## Implementation map

| Workspace or service | Principal changes |
| --- | --- |
| Funding | `FundingWorkspace.tsx`, `FundingController.cs`, application/domain `Funding.cs`, Funding Officer grant and administration navigation |
| Decision support | `DecisionSupport.tsx`, crisis workspace entry points, `DecisionSupportController.cs`, application/domain `DecisionSupport.cs`, Gemini draft adapter and alert composer |
| Case and matching rules | `Operations.cs`, `RequestsController.cs`, `StaffPages.tsx`, `CitizenPages.tsx`, `StaffSupport.tsx` |
| NGO support and shelter shortages | `SupplySupport.tsx`, `SupplySupportController.cs`, application/domain `SupplySupport.cs`, partner workspace/controller, shelter dashboard |
| Delivery, maps and accessibility | `NotificationWorker.cs`, `InternalNotifications.cs`, `CitizenEmailContent.cs`, `GeographyController.cs`, mapping adapter, shared workspace and form accessibility fixes |
| SQL and API reference | `Data.cs`, two additive EF Core migrations and model snapshot, [API contracts](../api/contracts.md) and [runtime OpenAPI](../api/openapi.json) |
| Test code | `CourseworkWorkflowTests.cs`, expanded household API scenario, provider checks, Playwright funding test and updated runtime fixtures |

## Migration and operating notes

- `20261118050304_FundingAndDecisionSupport` adds the funding, forecast, summary, investigation, case consolidation, supply handoff and receipt records. It adds nullable start times and offer links, and provisions the Funding Officer role.
- `20261118050949_FundingNotificationOutbox` records country scope for donor email events. Existing case-email rows keep their original scope.
- EF Core reported no model drift and generated an idempotent SQL script at `tmp/coursework/coursework-upgrade.sql`. See the run totals and upgrade evidence below.
- The active demonstration database was outside the test scope. Live provider evidence, participant UAT and translation review remain pending.

## Isolated SQL Server upgrade evidence

The rehearsal database was `Surakuma_CourseworkUpgrade_5e585029aaa144b092b4dec0ccbea19e`. The starting binary applied Phase 1 and seeded synthetic cases, stock, shelter, tasks, alert, user and membership records. A COPY_ONLY backup passed SQL Server `RESTORE VERIFYONLY WITH CHECKSUM` before the upgrade. After both new migrations ran, the selected table counts and operational-field checksums matched the baseline. Migration history confirmed both upgrade IDs and the Funding Officer role. The SQL, migration history, before/after probes and backup verification are in `tmp/coursework`.

## Corrections found during execution

- Swagger returned 500 for duplicate nested DTO schema names. The API now assigns unique names to nested schemas. The UI exercised the public shelter endpoint and direct HTTP confirmed its status.
- Browser QA found an unassociated funding amount label, a counted notification link name mismatch and an inconsistent brand name. The forms and shared accessible names were corrected. The suite also updated stale locators and supplied generated credentials to legacy tests.
- Running every browser case on one loopback IP exhausted the default request allowance. The isolated runner now configures an explicit test limit. The default API allowance stays at 240 per minute.
- The new regional tests exposed a test-helper assumption that successful responses always contain JSON. Countries and verification workflows now exercise the expected 204 response without trying to deserialize an empty body.
- The administrator Vitest file reached its 5-second timeout during two concurrent verification runs. It passed in the standalone full-suite run with one worker and the original assertions and timeouts.

## Playwright and recording evidence

The final Playwright run passed **16/16** in 4.1 minutes. It ran against `Surakuma_Acceptance_317bca4ce7044e4782710751053c9809`. The run log is `tmp/coursework/results/playwright-final.log`. Swagger executed the public shelter GET with HTTP 200 and generated a 146-path OpenAPI snapshot.

The recording directory contains three silent captures from passing browser scenarios. FFmpeg decoded all three. The file names, duration and frame size are included below.

| Local recording | Duration | Frame size |
| --- | ---: | --- |
| [Citizen and logistics](../../output/coursework-demo/citizen-and-logistics.webm) | 32.88 seconds | 800 × 450 |
| [Funding administrator](../../output/coursework-demo/funding-administrator.webm) | 12.20 seconds | 800 × 526 |
| [Donor](../../output/coursework-demo/funding-donor.webm) | 10.80 seconds | 368 × 800 |

The [light desktop funding report](../../output/coursework-demo/funding-admin-light-desktop.png) and [dark mobile donor form](../../output/coursework-demo/funding-donor-dark-mobile.png) were captured from the funding scenario. Browser timings are automated. The recording of the citizen and logistics pages does not replace the broader Sri Lanka SQL/API evidence.
