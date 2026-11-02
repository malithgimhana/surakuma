# API contracts

Base prefix `/api/v1`. Development OpenAPI: `https://localhost:7043/swagger`. Enum values use names rather than numeric ordinals. Protected routes require `Authorization: Bearer <accessToken>`. Refresh/logout use the secure HTTP-only cookie and browser-origin checks.

| Area | Routes |
| --- | --- |
| Readiness | GET `/health`, GET `/ready` (database readiness returns 503 on failure) |
| Authentication | POST `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`; GET `/auth/me`; PUT `/auth/profile` |
| Public | GET `/public/lookups`, `/alerts`, `/shelters`; GET `/maps/geocode?query=...` |
| Requests | POST/GET `/requests`; GET `/requests/mine`; GET `/requests/{id}`; PATCH `/requests/{id}/status` |
| Review | POST `/requests/{id}/escalate`, `/shares`; GET `/requests/{id}/recommendations`; POST `/requests/{id}/recommendations/generate`, `/decisions`, `/duplicates/{duplicateId}` |
| Evidence/feedback | POST `/requests/{id}/attachments` (multipart file); GET `/requests/{id}/attachments/{attachmentId}`; POST `/requests/{id}/feedback` |
| Logistics | GET/POST `/resources`; POST `/resources/{id}/replenish`; GET `/resources/{id}/movements`; POST `/allocations`, `/allocations/{id}/{Dispatch|Deliver|Cancel}` |
| Shelters | POST `/shelters`; PUT `/shelters/{id}`; POST `/shelter-allocations`, `/shelter-allocations/{id}/{CheckIn|Depart|Cancel}` |
| Volunteers | GET/POST `/volunteers`; POST `/volunteer-tasks`, `/volunteer-tasks/{id}` with action Accept, Decline, Start, Complete or Verify |
| Crises | GET/POST `/crises`; PUT `/crises/{id}`; GET/POST `/crises/{id}/areas`; POST `/alerts`, `/alerts/{id}/unpublish` |
| Communications | GET `/notifications`; POST `/notifications/{id}/read` |
| Mapping | GET `/maps/route?startLat=...&startLng=...&endLat=...&endLng=...` |
| Reports | GET `/reports/metrics` within current user's visibility |
| Administration | GET/POST `/admin/users`; DELETE `/admin/memberships/{id}`; POST `/admin/organisations`; GET `/admin/audit`, `/admin/deliveries`, `/admin/system` |

Request lists return `{items,total,pageNumber,pageSize}`, with a fixed page size of 20, newest first, optional status/search/page parameters. Audit lists use pages of 50. Resource CRUD reads are limited by organisation visibility; shelter public DTOs contain only facility/availability records.

POST request bodies include crisisId, organisationId, category, priority, description, locationText, optional latitude/longitude, householdSize, accessibilityNeeds, quantity, submissionKey and synthetic. Keep the same submissionKey for a retried submission. Latitude and longitude must appear together.

400: validation/business rule. 401: missing/expired authentication. 403: insufficient authority. 404: absent or invisible case. 409: concurrency/uniqueness conflict requiring refresh. 429: rate limiting. 503: unavailable readiness/map integration. Error bodies use Problem Details with traceId where handled centrally.

`GET /admin/system` requires an active administrator membership and returns `demonstrationMode`, `checkedAt`, `integrations` and `notificationQueue`. Integration entries contain `id`, `name`, `mode`, `state`, `detail` and missing setting **names** only. Configuration is inspected locally without provider calls. `Configured` means required values exist, not that credentials, sender activation, quotas or connectivity have passed a live test. Keys, sender addresses, connection strings and signing secrets are omitted. Queue counts are grouped directly from SQL outbox state. The response uses `Cache-Control: no-store`.
