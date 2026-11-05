# SE205.3 technical report working draft — Surakuma

This document supplies implementation-grounded report content. Complete the institution's cover sheet, citations, word limits, individual reflections and final evidence selection before submission.

## Problem and scope

Surakuma coordinates requests, authorised human decisions, limited resources, shelter spaces and volunteers during multiple Sri Lankan crises. The prototype includes public and citizen access plus operational and administrative workspaces. Its design prioritises traceable decisions and coherent end-to-end behaviour. Seed data is synthetic; the system is not a live emergency service.

## Architectural rationale

A modular monolith provides clear responsibility boundaries without requiring the deployment, consistency and observability infrastructure of microservices. Domain entities protect operational invariants; application services implement workflows through replaceable ports; infrastructure implements SQL Server, Identity and external services; controllers translate HTTP requests. See the decisions register for alternatives and trade-offs.

## Functional implementation

Citizens register, manage household details, submit a guided request with optional private evidence, track progress and provide feedback. Staff verify requests, review AI recommendations, approve assistance, manage limited stock, reserve shelter capacity, assign volunteers and inspect operational metrics. Coordinators create crisis events, operational areas, translated public alerts and explicit case-sharing grants. Administrators grant and revoke memberships and inspect audit/delivery state.

## Data and consistency

EF migrations create normalised identity, membership, crisis, case, AI, resource, shelter, volunteer, notification and audit records. Foreign keys restrict accidental loss of history. Row versions detect competing updates. Critical allocations use serializable SQL transactions, with stock/capacity check constraints as an additional safeguard. A shortage leaves outstanding needs visible rather than marking incomplete aid as complete.

## AI governance and limitations

AI generation returns a proposal, not an operational authorisation. The original output and human response remain separately stored. Human modification requires a reason. Confidence is unavailable unless meaningful evidence exists; it is not fabricated. Duplicate scores are named text-token similarity and require review. A missing, unavailable or malformed external provider produces labelled development rules. External free AI is restricted to explicitly synthetic descriptions and excludes identity, precise location and evidence.

## Security

Identity manages password hashing, unique emails and temporary lockout. JWT bearer validation checks issuer, audience, signature and lifetime. Refresh tokens are random, hashed in SQL, rotated and revocable. Application-level access checks use current memberships and case sharing, not hidden UI buttons. Private evidence uses random storage names, limited PNG/JPEG content, size/count limits, authorised downloads and no public static path. Input DTOs, HTTPS, origin checks, rate limiting and Problem Details support predictable boundaries.

## Reliability and integration

Case changes and outbox events commit together. A SQL-backed worker claims events and records deduplicated notifications/deliveries. Rate-limit retries are bounded; uncertain external sends enter review. AI/manual and mapping/textual-location fallbacks keep core workflows usable. Provider keys are server-side configuration, and no live integration is claimed until its own account has been tested.

## Patterns and diagrams

Repository/DI/strategy/factory/adapter and persisted event processing are demonstrated in concrete code, documented in `architecture/decisions.md`. The editable class, sequence, component, ER and use-case sources are in `diagrams/` and must remain aligned with future changes.

## Verification and evaluation

Use the executed results in `testing/results.md`, not anticipated results. Integration tests target real SQL Server, particularly for stock and shelter races. The complete household acceptance test covers submission, preserved duplicate candidates, human AI override, shortage and partial delivery, a separate accessible-shelter request, volunteer completion with staff verification, captured notifications, closure and audit records. Provider tests simulate malformed responses, throttling and outages. Frontend tests verify critical validation, labels and translation-key coverage. Browser tests cover public layouts, citizen forms, administration readiness and operational journeys. The administration status endpoint exposes configuration modes and SQL queue counts without credentials; it does not establish live provider success. Native-speaker and assistive-technology UAT remain human review activities.

## Contribution evidence

The implementation is a solo build. Add actual Git references, test execution, translation review, documentation and presentation preparation undertaken by each person. Presentation responsibility alone must not be described as authorship of a module's implementation.

## Future work

Donation management, advanced inter-organisation support requests, recurring volunteer scheduling, demand forecasting, optimisation, offline capture and payment processing remain extension areas after core acceptance. Hosting and production operations require a separate rollout assessment.
