# API contracts

Base prefix `/api/v1`. Development OpenAPI: `https://localhost:7043/swagger`. Enum values use names rather than numeric ordinals. Protected routes require `Authorization: Bearer <accessToken>`. Refresh/logout use the secure HTTP-only cookie and browser-origin checks.

| Area | Routes |
| --- | --- |
| Readiness | GET `/health`, GET `/ready` (database readiness returns 503 on failure) |
| Authentication | POST `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`; GET `/auth/me`; PUT `/auth/profile` |
| Public | GET `/public/lookups`, `/alerts`, `/shelters`; GET `/maps/geocode?query=...` |
| Requests | POST/GET `/requests`; GET `/requests/mine`; GET `/requests/{id}`; PATCH `/requests/{id}/status` |
| Review | GET `/requests/escalated`; POST `/requests/{id}/escalate`, `/escalation/resolve`, `/shares`; GET `/requests/{id}/recommendations`; POST `/requests/{id}/recommendations/generate`, `/decisions`, `/duplicates/{duplicateId}` |
| Evidence/feedback | POST `/requests/{id}/attachments` (multipart file); GET `/requests/{id}/attachments/{attachmentId}`; POST `/requests/{id}/feedback` |
| Logistics | GET/POST `/resources`; POST `/resources/{id}/replenish`; GET `/resources/{id}/movements`; POST `/allocations`, `/allocations/{id}/{Dispatch|Deliver|Cancel}` |
| Shelters | POST `/shelters`; PUT `/shelters/{id}`; POST `/shelter-allocations`, `/shelter-allocations/{id}/{CheckIn|Depart|Cancel}` |
| Volunteers | GET/POST `/volunteers`; POST `/volunteer-tasks`, `/volunteer-tasks/{id}` with action Accept, Decline, Start, Complete or Verify |
| Crises | GET/POST `/crises`; PUT `/crises/{id}`; GET/POST `/crises/{id}/areas`; POST `/alerts`, `/alerts/{id}/unpublish` |
| Communications | GET `/notifications`; POST `/notifications/{id}/read` |
| Mapping | POST `/maps/reverse-geocode` with `{latitude, longitude}`; GET `/maps/route?startLat=...&startLng=...&endLat=...&endLng=...` |
| Reports | GET `/reports/metrics` within current user's visibility |
| Administration | GET/POST `/admin/users`; DELETE `/admin/memberships/{id}`; POST `/admin/organisations`; GET `/admin/audit`, `/admin/deliveries`, `/admin/system` |

Request lists return `{items,total,pageNumber,pageSize}`, with a fixed page size of 20, newest first, optional status/search/page parameters. Audit lists use pages of 50. Resource CRUD reads are limited by organisation visibility; shelter public DTOs contain only facility/availability records.

Admin audit history accepts `page` (one-based) and `pageSize` (1–50, default 50), newest first. Delivery history accepts `page` and `pageSize` (1–100, default 100), and includes the English event message, recipient display name, case reference and delivery provider when available. The English event message is context, not proof of the exact translated email sent; `Sent` indicates provider acceptance, not confirmed inbox delivery.

For either admin history endpoint, `includeTotal=true` returns `{items,total,pageNumber,pageSize}`; without it the response remains an array for existing clients.

Reverse geocoding is an authenticated, rate-limited, explicitly requested lookup. Coordinates are sent to the configured external mapping provider; responses are not cached by the application and carry `Cache-Control: no-store`. A missing or unavailable provider returns 503. The API does not automatically send request locations to the provider.

POST request bodies include crisisId, category, priority, description, locationText, optional latitude/longitude, householdSize, accessibilityNeeds, quantity, submissionKey, synthetic, and optional requestedForSomeoneElse, requesterRelationship and requesterContact. Keep the same submissionKey for a retried submission. Latitude and longitude must appear together. The server chooses the primary centre configured for the crisis, then assigns the available case manager with the fewest open cases at that centre; ties use user ID. The client-supplied organisationId is ignored. No configured centre sends the case to coordinator triage; if no manager is available the centre is retained and the case also appears in triage. Existing requests retain their organisation during migration; existing crises have no configured centre and existing case managers start unavailable until configured.

GET `/requests/triage` lists open cases without a centre or case manager for administrators or coordinators assigned to the relevant crisis. PUT `/crises/{id}/centre` with `{organisationId}` configures the primary centre for administrators or that crisis's coordinators. GET `/case-manager/availability` lists the current manager's centre memberships; PUT `/case-manager/availability/{membershipId}` with `{available}` updates availability. POST `/requests/{id}/reassign` with `{organisationId}` transfers a case and selects an available manager. POST `/requests/{id}/case-manager` with `{userId}` lets an administrator or crisis coordinator manually assign a case manager at the current centre. Changes are recorded in the audit log.

Transfers to another centre are rejected while resource allocations are reserved or dispatched, or shelter placements are reserved or checked in. Complete or cancel those commitments first. Shelter requests represent exactly one household placement (`quantity: 1`); legacy shelter requests with another quantity cannot be reserved or checked in until reviewed and corrected through an appropriate data-repair process.

Citizen request details contain generic status history, including for older records; staff-entered case notes, escalation reasons and actor IDs remain available only to authorised staff. GET `/requests/escalated` lists cases needing follow-up, including closed cases, for authorised case managers and coordinators. POST `/requests/{id}/escalation/resolve` with `{note}` requires a resolution note, clears the flag and records an audit event; later problem feedback can flag the case again.

Revoking a membership invalidates that user's current access and refresh sessions and removes the Identity role when no other membership grants it. After deployment of security-stamp validation, existing access tokens without a stamp are rejected; a still-valid refresh session can obtain a new token, while affected users whose sessions were revoked must sign in again. Revoking a membership does not disable the underlying account.

Administrators can open details of open cases in their triage queue; this does not grant them access to fully assigned cases. Routing decisions acquire a transaction-owned SQL Server application lock and retry deadlock victims a bounded number of times. This serialises routing decisions across centres to preserve workload-based assignment under concurrent submissions; monitor throughput as usage grows. Submission retries must retain the same submissionKey.

Case shares no longer grant partner access: case information is restricted to the requester, the assigned organisation and coordinators for the crisis. The legacy share endpoint rejects new shares; coordinators should assign the case instead.

400: validation/business rule. 401: missing/expired authentication. 403: insufficient authority. 404: absent or invisible case. 409: concurrency/uniqueness conflict requiring refresh. 429: rate limiting. 503: unavailable readiness/map integration. Error bodies use Problem Details with traceId where handled centrally.

`GET /admin/system` requires an active administrator membership and returns `demonstrationMode`, `checkedAt`, `integrations` and `notificationQueue`. Integration entries contain `id`, `name`, `mode`, `state`, `detail` and missing setting **names** only. Configuration is inspected locally without provider calls. `Configured` means required values exist, not that credentials, sender activation, quotas or connectivity have passed a live test. Keys, sender addresses, connection strings and signing secrets are omitted. Queue counts are grouped directly from SQL outbox state. The response uses `Cache-Control: no-store`.
