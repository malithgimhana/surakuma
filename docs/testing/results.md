# Executed validation

## Local assessment preparation 22 October 2026

- Expanded Playwright suite: **7 passed together in 58.6 seconds**, including the existing public/language, citizen review/delivery/closure, admin and axe scans, plus keyboard navigation with doubled root text and a real Swagger GET execution.
- Keyboard check: public skip-link focus/activation, login field/button tab order and input text doubling at a 1280px viewport; no horizontal overflow in that checked layout. This is a targeted automated check, not a full screen-reader/elderly-user UAT approval.
- Swagger: executed GET `/api/v1/shelters` through the Swagger UI, observed HTTP 200, and compared a direct public API response. Credential-free metadata is in `swagger-evidence.json`, screenshot in `docs/screenshots/swagger-public-shelters.png`.
- Recorded an actual synthetic full-household UI walkthrough, with AI fallback, shortage rejection, partial delivery/replenishment, a separate accessible shelter, volunteer assignment/verification, citizen feedback, captured notifications, metrics and audit. The WebM decodes at **1280x900, 90.28 seconds**; timed transcript and recording metadata are supplied with it. It is silent with captions.
- Generated an editable 21-page technical report and PDF, with six SVG/PNG figures and deliberately blank identity/contribution fields. Rendered page images were reviewed and diagram labels corrected.
- Prepared all **169** current interface translation rows and blank UAT/contribution approval records. Creating these forms is not evidence that human review occurred.

The 30 backend and nine frontend tests below remain the executed 21 October baseline; those suites were not rerun for this document/recording task. No accounts were activated and no real email was sent. Online OSM tiles are visible in the recording, which does not verify authenticated openrouteservice routing or geocoding.

## Continuation: 21 October 2026

Environment: the same local Windows/.NET 10/SQL Server setup. Added administrator-only integration configuration and actual notification queue counts, an end-to-end household API scenario, operational browser coverage and a translated login-throttling message.

| Check | Executed result |
| --- | --- |
| Backend build and real SQL Server unit/integration suite | 30 passed, zero failed/skipped |
| Final production frontend build | Passed after logout/state-refresh fixes; two upstream Zod annotation warnings remain non-blocking |
| Vitest | 9 passed: routing, citizen validation/translations, system status/retry and distinct sign-in throttling feedback |
| Playwright | 5 passed together, 2.4 minutes: responsive public/language layouts; submission → staff AI review → partial delivery/replenishment → closure → citizen tracking; administrator configuration/queue and 375px fit; trilingual citizen forms; scanned axe checks |
| Configuration security | Anonymous 401; citizen/coordinator/logistics/volunteer 403; administrator 200 with no-store and SQL queue counts |
| Provider configuration cases | Missing, partial, configured, capture and invalid modes covered; credential/sender/connection/signing values omitted |
| Complete household API scenario | Passed: submission, distinct duplicate, human priority override, shortage rejection, partial food delivery and replenishment, separate accessible shelter check-in, volunteer self-service/staff verification, captured notifications, closure and audit |

Browser tests switch synthetic roles rapidly. Start the API with `./scripts/Start-Api.ps1 -BrowserTests` for that suite; it raises the authentication allowance only for the explicit test process. Restart normally afterwards. Default login throttling remains enabled. The suite uses in-app navigation when possible rather than unnecessary document reloads.

Validation found and corrected a SQL translation issue in the new status query. Operational mutations now await query refresh before leaving the pending state. Browser expectations accept valid staff return routes, use the actual translated closure label, and exercise independent inventory so rerunning the scenario does not depend on seeded stock remaining available. A 429 sign-in response now explains throttling in English/Sinhala/Tamil rather than implying invalid credentials. Logout now clears local session data and replaces the document with the homepage after server-side logout, avoiding competing protected-route redirects and discarding the previous account's router state.

No live external provider call or real email was made. Human translation review, assistive-technology UAT, the final report PDF and recording remain outstanding.

## Previous validation: 19 October 2026

Date: 19 October 2026. Environment: Windows, .NET SDK 10.0.401, Node.js 24.16.0, npm 11.13.0, local SQL Server Express.

| Check | Executed result |
| --- | --- |
| Initial schema and localised-notification migrations | Applied successfully to local Surakuma database |
| API liveness / SQL readiness | Frontend HTTP 200 and API `ready` observed; actual OpenAPI JSON exported |
| Backend build | Successful, zero warnings/errors |
| xUnit domain/provider/SQL integration suite | 22 passed, zero failed/skipped |
| Frontend production build | Passed; page-level bundles generated |
| Vitest | 6 passed |
| Playwright browser acceptance / responsive / axe | 4 passed; public desktop and mobile citizen form scans reported zero violations |
| Production frontend dependency audit | Zero known vulnerabilities reported |

## Coverage

Backend tests include anonymous/citizen privilege denial, rejected cross-user reads, public-registration role injection, repeated submission, AI fallback/override history, malformed/outage AI responses, safe/uncertain email outcomes, free-AI synthetic gate, controlled organisation sharing, SQL stock/shelter races, partial delivery and replenishment, closure and staff-visible problem feedback, coordinate validation, notification deduplication and refresh-token replay.

Frontend tests cover role-aware login redirects, status text, retry action, blocked advancement with incomplete request details, draft persistence and complete nonempty translation-key sets. Browser scripts check language switching, 375px layouts, login/refresh, request submission and staff verification/AI review. Screenshots are retained under `docs/screenshots`.

## Defects found and corrected during validation

- Identity foreign-key string lengths prevented the initial SQL migration; corrected before successful schema application.
- Cryptography dependency audit required the patched package release.
- A wrapped SQL deadlock returned 500 instead of a usable 409 conflict; corrected and concurrency checks passed.
- Reserved MVC route parameter `action` caused dispatch/check-in 404s; renamed and complete workflows passed.
- Implicit form labels included help text; replaced with explicit labels and described-by associations.
- Reusing the last-step button could trigger submission while moving into review; prevent-default/distinct keys now preserve explicit submission.
- Public secondary text/step-indicator and mobile workspace link contrast were improved based on axe output.
- Account switching now uses role-aware destinations, and logout unmounts protected routes before session removal to prevent competing redirects.

## Limits

External services have no configured credentials, so live provider success is not verified. Provider failures are simulated; the UI and worker clearly distinguish fallback/capture from real AI/email. Automated axe checks cover their scanned pages and do not establish full WCAG conformance. Translation-key completeness is not native-speaker translation approval.
