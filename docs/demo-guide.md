# Lecturer demonstration and module handover

Use synthetic records and the development credentials in README. Keep real credentials and the local settings file out of screenshots/recordings.

1. **Public/citizen:** show the mobile homepage and all three languages. Browse shelters/alerts without login. Log in as citizen; submit a synthetic food/water request with a quantity of 10. Show the reference and timeline.
2. **Case review:** log in as case manager. Open the new case, begin review and verify it. Generate a recommendation. Explain the labelled rules fallback when no key is configured; with an enabled free account, demonstrate a real synthetic external recommendation. Modify priority with a reason. Show the preserved original and human decision. Approve the case separately.
3. **Logistics:** log in as logistics manager. Only six food packs are initially available. Reserve six, dispatch them, and confirm delivery. Show six delivered and four outstanding. Replenish four with a reason; reserve/dispatch/deliver the remainder.
4. **Shelters:** use the seeded approved shelter request. Log in as shelter administrator, reserve a suitable accessible shelter for the entire household, show reserved versus checked-in counts, check in, then record departure.
5. **Volunteers:** the coordinator uses the seeded verified volunteer or an administrator-created volunteer membership. Assign a task with a skill and due time. Log in as volunteer, accept, start and submit completion. The volunteer coordinator verifies completion.
6. **Communication:** show the citizen's in-app notification and administrator delivery state. Explain Captured versus Sent. Reprocessing is covered by automated tests. A real email demonstration requires a verified Brevo sender and an authorised test recipient.
7. **Completion:** case manager closes the fulfilled case; citizen confirms receipt or reports a problem. Show the coordinator metrics and administrator audit trail.
8. **Security/reliability:** show forbidden staff actions as a citizen, controlled partner case sharing, provider fallback, and SQL test evidence for simultaneous allocations/reservations.
9. **Integration readiness:** as administrator, show the configuration panel and actual outbox counts. Explain that Configured is distinct from live-tested. Refresh status sends no messages and never reveals API keys.

Each request captures one aid category. The food and accessible-shelter requests represent separate needs for the same household; placing a food request in a shelter is not supported. The repeatable SQL/API acceptance test `FloodHouseholdJourneyPreservesHumanReviewStockShelterVolunteerNotificationsAndAudit` creates both requests and its own stock/shelter in an isolated test database, so it can be rerun after demonstration stock is consumed. It also checks that a volunteer cannot verify their own completion and that a reviewed duplicate candidate remains available.

## Updated isolated coursework demonstration

1. Run `pwsh -NoProfile -File scripts/Test-InternationalAcceptance.ps1` with Windows LocalDB and Edge available. The runner uses generated synthetic accounts, isolated evidence storage and captured email.
2. From the Sri Lanka crisis, draw an operational area, submit a synthetic bilingual/trilingual alert as a coordinator, and approve it as a different administrator. Show the published entry in the Sri Lanka feed.
3. Submit a food request with a synthetic image. Show the AI fallback and the case manager's reason for overriding it. Scan case indicators, resolve the duplicate indicator as staff, then verify and approve the case.
4. Dispatch a partial quantity, record an accountable receipt and check remaining demand. Raise a case-linked supply request. Use a separate verified Partner account to offer stock, an administrator to accept it and the receiving logistics account to record the receipt. Dispatch the remaining packs through the normal case workflow.
5. Use a separate shelter request for the same household. Show availability, reserve and check in. Schedule and assign a volunteer, then use separate volunteer and reviewer accounts for completion and verification. Confirm delivery and close the cases.
6. Generate an internal briefing and review it independently. Forecast a category with sparse history and confirm the UI withholds an estimate. Open the Sri Lanka coverage report, export the operational CSV and inspect audit entries.
7. Under **Funding**, create a synthetic campaign. Under **Donor workspace**, register a profile and record a pledge. Show that received totals are zero until an officer verifies an external reference. Allocate funds to an approved case and record an expenditure. Review the reconciled donor totals. For a material pledge, use a compatible authorized inventory item and reconcile with the matching logistics delivery receipt.
8. Use India and Nepal in the country selector. Exercise a scoped case and shelter in each jurisdiction. Show an unauthorized account receiving a denial and compare the public alert locale policies.

For reproducible browser recording, install the Playwright FFmpeg dependency with `npx playwright install ffmpeg` from `frontend`. In a fresh PowerShell process set `$env:SURAKUMA_DEMO_VIDEO='1'` and rerun the isolated script with `-TestFilter 'citizen submits|donor and funding administrator'`. The Playwright output includes the citizen/staff journey and donor and administrator views. Record only successful scenarios with synthetic accounts. Videos and traces are stored under `frontend/test-results/live-international`.

## Presentation ownership

Each presenter should explain one real module through UI → controller → application rule → database record/constraint → executed test. Presenters may be assigned after implementation. Record actual implementation, testing, translation review and documentation contributions independently of presentation allocation.

## Recording checklist

- Servers running; readiness healthy; demo records available.
- Three language layouts and 375px mobile view checked.
- No API key/password visible.
- Live-provider claims supported by actual calls; fallback mode clearly identified.
- Demonstration link has lecturer viewing permission.
- Report diagrams agree with the delivered code.
