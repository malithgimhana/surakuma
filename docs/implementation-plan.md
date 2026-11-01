# Implementation checklist

## Implemented core

- [x] React/Vite/TypeScript frontend with shared pastel/navy/coral components and original SVG illustration.
- [x] Public, citizen, operations, volunteer and administrator layouts; page-level lazy loading.
- [x] ASP.NET 10 Domain/Application/Infrastructure/API solution and SQL Server migrations.
- [x] Health and database readiness endpoints; OpenAPI UI.
- [x] Citizen registration, Identity password hashing/lockout, JWT, rotating hashed refresh tokens and logout.
- [x] Administrator-granted staff memberships; organisation/case-scoped access and explicit sharing.
- [x] Guided citizen request, scoped tab draft, idempotency key, private optional PNG/JPEG evidence.
- [x] Request details/timeline, profile, receipt/problem feedback and notifications.
- [x] Case verification/approval, escalation and separate AI review decisions.
- [x] Configurable external AI adapter, labelled deterministic fallback, duplicate similarity flags and audit history.
- [x] Stock ledger, reservations, dispatch, partial delivery/replenishment and closure.
- [x] Whole-household shelter suitability/capacity checks, reservation/check-in/departure.
- [x] Verified volunteers, skills/availability, assignment, accept/decline/start/report completion/staff verification.
- [x] Crisis events, operational areas and translated published alerts.
- [x] Transactional outbox, deduplicated persisted notifications, capture/email adapters and bounded retry/review states.
- [x] OSM maps and server-side openrouteservice search/route adapter with unavailable states.
- [x] Database-derived scoped metrics and administrative audit/delivery views.
- [x] Administrator-only integration configuration and notification queue summary; credentials never returned and configured services do not claim live verification.
- [x] Repeatable full-household SQL/API acceptance scenario covering human AI override, duplicates, partial food delivery, separate shelter need, volunteer verification, capture notifications, closure and audit.
- [x] English/Sinhala/Tamil interface keys and notification templates for citizen journeys.
- [x] Real SQL Server integration tests and simulated provider-failure tests.
- [x] Frontend validation/translation/accessibility tests and browser acceptance scripts.
- [x] Reproducible setup scripts, README, architecture decisions, API contracts and editable UML/ER sources.

## Validation and assessment preparation

Executed results belong in `testing/results.md`; implementation checkboxes alone do not establish verification.

- [ ] Activate free API accounts and run an authorised live synthetic Gemini recommendation.
- [ ] Verify Brevo sender and deliver a test notification to an authorised recipient.
- [ ] Activate openrouteservice key and confirm search/routing with selected Sri Lankan demonstration locations.
- [ ] Have native speakers review critical Sinhala/Tamil wording and staff-entered public free text.
- [ ] Perform user acceptance sessions, including elderly users/keyboard/screen-reader and text-scaling checks.
- [x] Prepare the editable technical report, six rendered editable SVG diagrams and checked PDF. Cover/contribution fields are blank at the user's request.
- [ ] Fill report identity/contribution fields and complete student/lecturer-specific editorial review before final submission.
- [x] Record a real local browser walkthrough with captions and a timed transcript; verify WebM playback locally.
- [ ] Add personal narration or a lecturer-viewable hosted link if required, and check any hosted viewing permissions.
- [x] Prepare blank native-speaker translation, participant UAT and actual contribution records; add module presentation handover.
- [ ] Record actual individual testing, documentation and presentation contributions.
- [x] Create a source-only ZIP excluding credentials, runtime evidence data, dependencies and build outputs. Add reviewed report/video materials separately before submission.
- [x] Provide a combined assessment preparation ZIP with source, report, recording, review forms and a file-hash manifest. Human approvals and live integration checks remain pending.

## Expansion after core acceptance

Donations/campaigns, structured inter-organisation support requests, recurring availability calendars, advanced matching/forecasting, online payments, offline capture and hosted deployment are deliberately deferred.
