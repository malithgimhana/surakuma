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

## Presentation ownership

Each presenter should explain one real module through UI → controller → application rule → database record/constraint → executed test. Presenters may be assigned after implementation. Record actual implementation, testing, translation review and documentation contributions independently of presentation allocation.

## Recording checklist

- Servers running; readiness healthy; demo records available.
- Three language layouts and 375px mobile view checked.
- No API key/password visible.
- Live-provider claims supported by actual calls; fallback mode clearly identified.
- Demonstration link has lecturer viewing permission.
- Report diagrams agree with the delivered code.
