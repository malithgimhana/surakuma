# International country support

## Implementation

The existing `Administrator` role retains global oversight. `CountryAdministrator` is a separate role. Memberships retain their IDs, roles and organisations and now carry a country plus optional crisis scope. Enabling an organisation in another country does not extend its members' access. Grants and revocation are checked against the database; revocation invalidates the user's sessions.

The shared frontend country selector filters public crisis lookups, contacts, alerts, shelters and operational country views. Changing country clears cached responses and remounts the page so old form selections are discarded. Crisis, resource and shelter forms use country-aware region fields. The administration workspace displays grant scope, enables organisation countries, and edits public contacts and language policy. Country administrators can manage users in their country; global audit, delivery-history and organisation-country configuration remain restricted to global administrators.

Administrative division parent relationships, crisis/resource/shelter regions and crisis-scoped memberships use composite foreign keys to enforce matching countries. The reference coverage is 25 LK districts; seven NP provinces, 77 districts and 753 local authorities; and 36 IN states/union territories, 784 districts and 5,050 urban local bodies. Hierarchical selectors offer progressively narrower regions and preserve the selected region during shelter edits. Indian local bodies without a district identifier in the source are attached to their known state, never an invented district. Rural Indian village/panchayat coverage is not included.

## Public service configuration

`GET /api/v1/countries` returns country settings. `GET /api/v1/countries/{code}/divisions` returns region records. `PUT /api/v1/countries/{code}/services` accepts `languages`, `requiredAlertLanguages` (comma-separated codes) and `contacts` (label, telephone number, HTTPS source URL). English remains the fallback and required base alert language.

Defaults preserve LK English/Sinhala/Tamil requirements. NP and IN default to English-only alert publication, with optional Nepali/Hindi and other configured translations. Administrators can require configured translations. Alerts retain the existing Sinhala/Tamil fields and support additional translated content. Public alert rendering falls back to English when selected wording is unavailable. The existing interface translation catalogue now has Nepali and Hindi entries, with tests checking every English catalogue key and interpolation token. Existing English, Sinhala and Tamil remain available. Staff-authored alerts are separate from interface translation; no automatic translation is claimed. Existing staff administration strings outside the translation catalogue remain English. Native-language editorial review is still advisable.

Initial contact sources checked on 10 November 2026:
- [Sri Lanka Police](https://www.police.lk/?page_id=1334)
- [1990 Suwa Seriya](https://www.1990.lk/)
- [Nepal Police](https://ncb.nepalpolice.gov.np/safety-and-security/)
- [India Ministry of Home Affairs](https://www.mha.gov.in/emergency-response-support-system-erss)

Region references: [Sri Lanka Election Commission](https://elections.gov.lk/en/download/download_LocalAuthoritiesDetals_E.html), [Nepal Tourism Board](https://ntb.gov.np/en/provinces), [India national directory](https://www.india.gov.in/directory/web-directory/state-uts). These are initial configurable operational defaults, not a claim to provide every emergency contact or local administrative level.

## Populated migration rehearsal

On 10 November 2026 a COPY_ONLY backup of `(localdb)\MSSQLLocalDB` database `Surakuma` was restored twice: `Surakuma_InternationalBaseline_20261110` remained untouched and `Surakuma_InternationalRehearsal_20261110` received all four international migrations. The source at rehearsal time remained on `20261107130000_CrisisCentreRouting`.

`scripts/verify-international-rehearsal.sql` compares all original columns with SQL EXCEPT and checks table counts. No original records were missing or changed, including 17 users, nine requests, 15 memberships, four crises, four resources, three shelters, allocations, history, notifications and refresh sessions. The only added row in an original table is the CountryAdministrator identity role. After the regional-detail migration, reference region counts were 25/837/5,870 for LK/NP/IN.

Comparing directly to the active source initially detected refresh-session changes made by the running application after backup. The successful comparison uses the two identical backup snapshots, which avoids attributing live session activity to migration behaviour. Local backup, database files and detailed comparison output remain under ignored `tmp/international-rehearsal/`.

On 11 November 2026 the actual `(localdb)\MSSQLLocalDB` database `Surakuma` received all four international migrations. The API was already stopped when work resumed. A fresh COPY_ONLY/CHECKSUM backup was verified and restored as `Surakuma_RolloutBaseline_20261111` before migration. Comparing every original column and record count against this baseline passed before restarting the API. All 17 users, nine requests, 15 memberships, four crises, four resources, three shelters and operational history were preserved; only the CountryAdministrator identity role was added to an existing table. Existing IDs, foreign keys, location strings, coordinates and polygons are retained. No new sample accounts or crises were inserted into the live database.

Local backup: `tmp/international-rollout/20261111-070156/Surakuma-before-upgrade.bak`. The same directory holds migration logs, `verification.txt`, and live mobile screenshots. The ignored development settings now point to the verified LocalDB database, so ordinary local restarts use the correct database. The API restarted on HTTPS 7043 / HTTP 5043 and returned ready; the frontend is running on port 5173. Country contacts, English/Nepali/Hindi rendering and keyboard focus order passed live browser checks. Keep the backup outside disposable build cleanup.

For another deployment, stop writers, take and verify a fresh backup, rehearse against its restored copy, apply migrations, compare original records, then restart. Geographic constraints may reject pre-existing inconsistent international rows. RegionalDetail is forward-only: restore the backup with the matching prior application version if rollback is required, accepting that post-backup writes need separate recovery.

## Tests and limits

The complete backend suite has passed 75 tests. Added coverage includes country-specific reference contacts, foreign case/AI/allocation reads, stock mutations, crisis routing, lists, reports, country-admin settings and directory boundaries, citizen submissions, public alert filtering, matching-region constraints, explicit crisis grants, global oversight, and immediate grant revocation.

Frontend unit tests cover 28 existing and adapted behaviours, including localisation catalogue completeness. The isolated Edge Playwright journey covers country switching without stale contacts, region selection in crisis submission, optional country-appropriate alert fields and country-service settings. That regression uses mocked responses; the separate `international-live.spec.ts` acceptance passed against the real API and SQL Server, covering all three countries and the incident-management interface. This is not a full manual audit or every possible endpoint/payload combination.

Global administrators can create international incidents and link/unlink national crises in the Organisations administration section. Incident links never grant access to another country. Crisis-only staff can select eligible resources/shelters and obtain allocation recommendations through an authorised case; national stock administration still requires a country-wide grant. The existing disabled sharing endpoint remains disabled and is tested as such.

## Regional snapshot provenance

The frozen `ReferenceData/regions-20261110.json` is embedded in the data-only RegionalDetail migration. IDs are deterministic and inserts are idempotent. Snapshot files must not be changed after deployment; later reference corrections require a new migration. The migration's Down operation deliberately refuses to delete regions that could be in operational use. Restore a reviewed backup for rollback.

- Nepal: [Abin Rimal administrative divisions](https://github.com/abinrimal/nepal-administrative-divisions-json), MIT licence included as `np-license.txt`. A duplicated Chatrakot entry was deduplicated and the missing Dhurkot municipality restored from the [Gulmi District Administration local-level directory](https://daogulmi.moha.gov.np/en/page/local-level-details). Local authority type codes are not treated as unique IDs.
- India: [Kalyan Gupta Indian cities data](https://github.com/kalyangupta12/indian-cities-data), MIT licence included as `in-license.txt`; LGD-derived archive snapshot dated 23 September 2026, metadata included. The snapshot provides usable operational geography, not a live national registry.

## Reproducible real browser acceptance

Run `pwsh -File scripts/Test-InternationalAcceptance.ps1` from the repository root with LocalDB, .NET 10, frontend dependencies and Microsoft Edge installed. It creates a uniquely named `Surakuma_Acceptance_*` database, migrates and seeds only that isolated database, starts the API on HTTPS 7143, and runs Vite on 5192 through its normal same-origin API proxy. Credentials are generated for that run. It stops its API in a finally block and retains the isolated database and ignored logs under `tmp/acceptance/` for inspection. It never targets the live database.

The test creates one national crisis per country, explicit crisis-only staff grants and eligible stock. It submits citizen requests from a 390-pixel mobile viewport, uses the staff UI for review, verification, approval, reservation, dispatch and delivery, and checks cross-country record denial in both directions. The global-admin UI creates an incident and unlinks/relinks a national crisis. Mobile overflow and axe serious/critical WCAG A/AA checks cover the citizen tracking pages. The run is paced to respect the normal per-IP limiter. This broadens coverage; it is not an exhaustive security or accessibility certification.

Final verification: 75 backend tests, 28 frontend tests, production frontend build, the country-administration browser regression and the real three-country browser acceptance passed. The acceptance database retained for audit is `Surakuma_Acceptance_2f498a0c07bd434b81b76e2a8dcb9ee7`. Build warnings concern existing third-party annotation hints and bundle size, not failed checks. Browser checks also fixed a low-contrast tracking label and a compressed mobile country selector.
