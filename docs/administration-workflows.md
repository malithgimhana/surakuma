# International administration workflows

Surakuma helps citizens request assistance and helps authorised teams coordinate, deliver and track humanitarian aid across countries. Administration supports that journey by finding response delays, managing trusted partners and restoring interrupted services. Human staff retain responsibility for case decisions and delivery verification.

## Operating the new features

- **System Administrator:** access belongs to the account and covers every country. To appoint a Country Administrator, select their country, open **Users & access**, and choose **Country Administrator** in the staff form. Country Administrators manage their assigned country's crises, staffing, shelters and other response operations. The System Administrator can switch between countries or choose **All countries** in Reports.
- **Crises:** each crisis belongs to one country. The Country Administrator runs that response from **Crisis operations**. Each country has its own response even when an event affects more than one country.
- **Users & access:** the directory shows local staff grants and people who have submitted a request in the selected country. Suspend or reactivate staff access from Account actions to change grants in that country. Citizen access survives staff suspension. Whole-account disable remains a separate global-admin action. Permission changes invalidate existing sessions.
- **Password recovery:** use Forgot password on sign-in, or Send password reset email in account actions. Reset links last one hour, are invalid after use, and revoke existing sessions. Security email is separate from operational email. In Capture mode, messages are marked Captured without contacting a provider. Reset tokens are encrypted in the queue and never returned by admin APIs or included in audit details.
- **Organisations:** Country Administrators can use **Remove from [country]** to close a local registration. This ends the associated staff access and returns open cases in that country to the unassigned queue. The System Administrator can also delete an unused organisation or archive an organisation with linked records in all countries. New and reopened country registrations start Pending. Country Administrators record verification evidence, and the System Administrator can Verify or Reject the registration.
- **Activity / Integrations:** audit history, email deliveries, and queue counts follow the selected country. The provider configuration is shared. Audit events without a known country, such as general sign-ins, do not appear in a country view. Delivery recovery also supports state and date filters. For a Review item, confirm non-delivery before retrying, or record provider acceptance without resending.
- **Country settings:** Country Administrators can publish changes to public emergency contacts, available languages, and required alert languages for their assigned country. Each update is recorded in **Activity** with the country and actor, and active System Administrators receive an in-app notification.
- **System Administrator access requests:** use **Users & access** to review grants of access across all countries. A different active System Administrator must approve. The original requester must still have authority. A change to the target account invalidates the proposal. Proposals expire after seven days and target an existing account.
- **Alerts:** the notification bell includes administrator alerts; the inbox links to the alert queue. Unassigned requests older than one hour, cases without an active assigned manager, failed/uncertain citizen emails, three provider failures in ten minutes, and five denied administrator actions per account in ten minutes create deduplicated alerts. Evaluation runs each minute. Acknowledgement records responsibility; it does not resolve the condition. Provider alerts need an observed successful recovery; no synthetic health requests are sent.
- **Notifications:** citizen case updates use email plus in-app notifications, including accounts which also hold staff roles. Staff operational events remain in-app. Mixed-role inboxes combine only the citizen's own messages and operational messages within their current grants.

## Reporting definitions

Current overview case totals cover all requests. Operational Reports default to the last 30 UTC calendar days, including today. The From and Through dates are inclusive in the UI. The API accepts an inclusive start and exclusive end. Clear both dates to report on all submissions. The country and crisis filters determine which requests are counted. A selected crisis must belong to an authorised country in the report scope.

Submitted includes every request created during the period. The other case counts use those requests' current statuses. Open excludes Fulfilled, Closed, Rejected and Cancelled. Resolved includes Fulfilled and Closed. Unassigned means missing a response centre or case manager among open cases. Overdue means an open request created more than 24 hours ago. An open case can be both overdue and unassigned.

Active crises and stock are current snapshots. Inventory covers the selected countries and is grouped by resource name, category, and unit. Available is on hand minus reserved. A missing stock row represents inventory with no recorded quantity for that resource and country.

Submitted volume is compared with the immediately preceding equal-length period using the same scope and crisis. The percentage is shown only when that period has a positive count. Historical crisis activity, case status, and inventory snapshots are unavailable.

CSV and A4 PDF exports include the same filters, totals, country rows, stock, definitions, and UTC metadata. The PDF adds a country submissions chart for multi-country reports or a case-status chart for one country when there are submissions. Downloads from the dashboard include its report version. If the figures have changed, the dashboard refreshes so the administrator can review the updated counts before downloading.

## Interfaces and permissions

All paths are under `/api/v1`. Existing access and revocation endpoints remain.

| Interface | Behaviour |
|---|---|
| `GET admin/reports/filters` | Countries and crises the current administrator is authorised to report on |
| `GET admin/reports` | `scope=all` or `scope=country` with `countryCode`. Optional `crisisId` and paired `from`/`to` UTC boundaries |
| `GET admin/reports/export`, `GET admin/reports/export/pdf` | CSV and A4 PDF with the summary filters. Optional `version` verifies the displayed figures still match |
| `POST admin/users/{id}/staff-status` | `{active,reason}`; the admin workspace passes the selected `countryCode` |
| `POST admin/users/{id}/account-status` | `{active,reason}`; global admins only |
| `POST auth/forgot-password`, `POST auth/reset-password` | Generic recovery request; token-based reset, rate limited |
| `POST admin/users/{id}/password-reset` | Send security email; scoped administrators |
| `POST admin/organisations/{id}/countries/{country}/verification` | `{evidence,decision,reason}`; decision null saves evidence; Verified/Rejected needs global admin |
| `GET admin/organisations/{id}/countries/{country}/deletion`, `DELETE admin/organisations/{id}/countries/{country}` | Preview and remove a registration in the specified country |
| `PUT countries/{code}/services` | Publishes country settings and returns 204. The assigned Country Administrator or a System Administrator can save. |
| `GET admin/approvals`, `POST admin/approvals/{id}/decision` | System Administrator access requests and Approve/Reject/Cancel actions |
| `GET admin/delivery-management`, `POST admin/delivery-management/{id}` | Global delivery inspection, Retry or Accepted with documented checks |
| `GET admin/alerts`, `POST admin/alerts/{id}/acknowledge` | Country operational alerts and global service/access alerts |

`POST admin/users` with Administrator creates a pending proposal for an existing account. Outstanding country-settings proposals from the previous workflow are marked stale. Review and save any intended changes directly in **Organisations → Country settings**.

## Operator setup and migrations

Two active System Administrators are needed for proposals that require a different reviewer. When there is only one, the system operator can use `scripts/Bootstrap-SecondAdministrator.ps1 -UserId <existing-account-id>` to appoint an explicitly designated second administrator. The script audits the grant. After two administrators exist, use the approval workflow.

Migration `20261116084654_AdministratorScopes` copies existing eligible System Administrator grants to the account, consolidates Country Administrator grants to one per account and country, and adds a removal date to country registrations. Pending proposals for organisation-linked System Administrator grants become stale so the account-wide role receives fresh approval. Historical incident rows and links are retained. Take a verified backup before applying the migration and use that backup for rollback.

Migration `20261113052857_AdministrationWorkflows` is additive. It preserves IDs, assignments, deliveries and history, labels existing organisation-country operations LegacyActive, and carries lifetime delivery attempts into the initial retry cycle. Membership filtering excludes suspended grants and disabled users; management screens explicitly read inactive grants where authorised.

Apply `20261115124733_AdminCountryAudit` before starting the updated API. It records the country for audit events and fills in historical values where the original subject identifies a country. Events that cannot be assigned reliably stay in the audit log without a country.

Generate the migration SQL using `dotnet ef migrations script 20261112045341_InternalNotificationRouting --project backend/src/Surakuma.Infrastructure --startup-project backend/src/Surakuma.Api --configuration Release --no-build --output tmp/administration-migration.sql`. The local rollout script targets the verified LocalDB `Surakuma` database; inspect the active connection before reuse in another environment. `scripts/Test-AdministrationMigration.ps1` takes a checksum-verified COPY_ONLY backup, restores two uniquely named copies, migrates one and compares every original column except SQL rowversion. It leaves backup and comparison evidence in `tmp/administration-rollout/`. `-ApplyLive` applies only after rehearsal succeeds. Stop the API for the final backup/migration and restart after completion.

Live provider delivery, human language review and participant UAT remain separate from automated acceptance. No live reset or citizen email is needed for validation; use Capture mode.

## Executed rollout

On 13 November 2026, the additive migration was applied to the existing local database after backup, rehearsal and comparison of every original record. Backup/evidence is retained at `tmp/administration-rollout/20261113-193638/`. API and frontend health checks passed after restart. Existing organisation-country operations remain active pending review. One global administrator currently exists; a designated second administrator is needed to approve sensitive proposals. No live account was created or elevated by this rollout.

See [executed validation](testing/results.md) for backend, frontend, browser, migration and visual-check evidence, and the remaining live-provider/human-review limits.
