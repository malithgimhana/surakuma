# Module presentation guide

Assign presenters later. The presenter field is intentionally blank, and presenting a module does not establish authorship of its implementation. Use the recorded walkthrough as a visual rehearsal aid; explain the architecture and limitations in your own words.

| Module | Presenter | Workflow and UI | API and data rule | Relevant evidence | Limitation to explain |
| --- | --- | --- | --- | --- | --- |
| Citizen and public journeys | | Public home, shelters/alerts, four-step request, tracking and feedback | POST requests; stable submission key and citizen ownership; private attachment download | Frontend form tests; citizen browser journey | Human Sinhala/Tamil and assistive-technology review pending |
| Identity and organisation access | | Citizen login, staff roles and administration | AuthController; Identity, hashed rotating refresh sessions, membership/crisis/share checks | Cross-user/org tests, replay test and role injection test | Local prototype has no self-service password reset or complete OAuth/OIDC identity provider |
| Case and AI governance | | Verify, generate advice, review duplicate, modify priority, approve separately | Operations.GenerateAi/Decide; Recommendation and HumanDecision remain distinct | AI fallback/override and complete household API test | Deterministic fallback is not a live Gemini result; similarity is not fraud probability |
| Logistics | | Reserve six of ten, dispatch, deliver, replenish four | IAllocationPolicy; Resource.Stock and Reserved; serializable transaction and rowversion | Stock race tests and browser partial-delivery journey | Staff judge suitability/location; no route optimiser |
| Shelters | | Whole-household reservation, check-in and departure | Shelter available = capacity - reserved - occupancy; accessibility filter and SQL constraint | Real SQL reservation race; recorded shelter check-in | Food and shelter are separate request categories; no household splitting |
| Volunteers | | Verify profile, assign task, accept/start/submit and staff verify | Task status transitions, verified own profile, staff completion authority | Full household API test and recorded coordinator/volunteer work | Schedule text/flag is not a recurring calendar or location-aware AI matching |
| Communications | | Citizen notifications and admin delivery history | Case/outbox atomic save; unique event/recipient keys; bounded retry and Review state | Deduplication tests; queue/readiness panel | Captured means local storage, not real email. Brevo sender and authorised inbox still need setup |
| Administration metrics and maps | | Roles, audit, configuration, operational metrics and public facilities | Admin-only system endpoint; scoped SQL metrics; backend ORS proxy | API access tests, exported Swagger and admin browser test | Configured is not verified. Routes are not certified evacuation routes; live routing pending |

## Suggested questions to rehearse

1. Why a modular monolith? Explain the solo-build/deployment constraints, common SQL transaction boundary and costs of distributed consistency. State the scaling trade-off.
2. Where is the Strategy pattern? Open IAllocationPolicy and ConstraintAllocationPolicy, then show category, quantity, commitments and transport checks. Avoid claiming an optimiser.
3. What prevents overselling? Explain available stock, serializable transaction, rowversion, SQL check constraint and an actual concurrent-allocation test.
4. Is the outbox an Observer implementation? Describe durable event consumption honestly. There is no external fan-out pub/sub bus in this prototype.
5. What happens if AI fails? Show fallback flag/provider/model, nullable confidence, preserved request and manual staff workflow.
6. Why not resend an uncertain email? A provider may have accepted it before a network interruption; Review requires investigation to avoid duplicates.
7. What is still missing from the broader brief? Explain the agreed scope and report limitations, including donations, SMS, richer AI features and live provider validation.
8. How are contributions proven? Record actual work, dated evidence and real Git references. A presentation allocation cannot retroactively establish implementation history.

## Per presenter rehearsal record

- Name and student ID: ____________________
- Module and actual work undertaken: ____________________
- UI/API/database files inspected: ____________________
- Test executed and result: ____________________
- Question rehearsed and explanation: ____________________
- Limitation understood: ____________________
