# Architecture overview

Surakuma is a modular monolith with four backend projects and one React client. Operational modules share a SQL database but use application workflows rather than controller-to-controller calls.

The Domain project depends on no framework. Application depends only on Domain, exposing IStore, IAiProvider, IEmailProvider, IMappingProvider, ICurrentActor and IAllocationPolicy. Infrastructure implements SQL persistence and external adapters. API composes these dependencies and exposes versioned HTTP contracts. Identity-specific operations remain in Infrastructure because they depend directly on ASP.NET Identity.

## Trust and access

AccessService evaluates current database memberships for every protected business operation. Citizens access their own cases. Organisation staff access their organisation or explicitly shared cases; assigned crisis coordinators can oversee that crisis. Resource ownership permissions are checked in addition to case permissions. A shared case does not grant permission to change a partner's inventory.

Administrator membership grants administration APIs, not operational approval. Volunteer task updates require verified ownership and an active volunteer membership. Public data endpoints expose shelters, active crises, organisations and published alerts, not citizen case locations or evidence.

## Transactions and state

Requests carry immutable reference numbers and a per-citizen submission key. The unique constraint protects repeated processing. Status histories, audit events and outbox records are saved with state changes. No operational delete endpoint exists. Inventory and shelter workflows use serializable transactions, row-version optimistic concurrency and database check constraints. Deadlock victims and stale updates return HTTP 409 for refresh/review.

Inventory stock is physical on-hand quantity, including reservations. Available = Stock - Reserved. Dispatch removes reserved and physical stock; delivery increases the request's delivered quantity. A request remains partially fulfilled until its outstanding quantity reaches zero.

Shelter available = Capacity - Reserved - Occupancy. Reservations preserve whole households. Check-in transfers reserved spaces to occupancy and fulfils the shelter request. Departure releases occupancy.

## AI governance

Generating a recommendation cannot approve a case or dispatch aid. Each recommendation preserves source/model, rationale, optional confidence and fallback designation. Human decisions reference the original record and retain their actor/reason/time. Unavailable confidence stays null. Duplicate similarity is explicitly token-overlap similarity, not a probability. Staff resolve duplicate flags without deleting cases.

## Asynchronous communication

A committed outbox event is claimed by a background worker. It creates a uniquely keyed in-app notification and delivery record before sending. Capture mode demonstrates persistence without claiming external email delivery. Explicit throttling is retried with bounded backoff. Ambiguous send outcomes and stale processing claims enter Review to avoid a blind duplicate send. This is durable application deduplication, not an assertion of end-to-end exactly-once email delivery.

## Frontend

Public, citizen, staff, volunteer and administrator layouts share tokens and controls. TanStack Query owns server state; the auth context owns the in-memory access token session. Refresh credentials are HTTP-only cookies. Draft request text is scoped to the citizen in sessionStorage and removed on logout. All critical public/citizen labels use English/Sinhala/Tamil keys; published alerts require three language versions. Facility notes and other staff-entered free text require editorial translation review.
