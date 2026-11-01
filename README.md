# සුරැකුම · Surakuma

A local, full-stack humanitarian aid coordination coursework prototype. React/TypeScript → ASP.NET Core 10 → SQL Server. All initial records are synthetic demonstration data. This is not a monitored emergency service.

## Run on Windows

Prerequisites: .NET 10 SDK, Node.js 24+, a running SQL Server Express/Developer instance, and Windows-authenticated database creation permission. The default instance is `.\SQLEXPRESS`. No Docker or paid account is required.

From the repository root, in PowerShell:

```powershell
.\scripts\Setup.ps1
# If your instance differs:
# .\scripts\Setup.ps1 -SqlServer '.\SQLEXPRESS01'
```

In two separate terminals:

```powershell
.\scripts\Start-Api.ps1
```

```powershell
.\scripts\Start-Web.ps1
```

Open **http://localhost:5173**. The API runs at **https://localhost:7043**, OpenAPI UI at **https://localhost:7043/swagger**, liveness at `/api/v1/health`, and database readiness at `/api/v1/ready`. Vite proxies `/api` to the HTTPS backend. Use `localhost` consistently for the local session cookie.

If your browser rejects the API development certificate, run `dotnet dev-certs https --trust` locally, review the Windows prompt, then restart the API. Vite's development proxy accepts this local certificate; this setting must not be used for a public deployment.

## Development accounts

The first development startup generates a random signing key and a random shared **development-only** seed password in `backend/data/development-settings.json`. This file, evidence, and runtime data are ignored by Git. Production requires explicit secrets and never seeds accounts.

Read only the demo password locally:

```powershell
(Get-Content .\backend\data\development-settings.json | ConvertFrom-Json).Seed.Password
```

| Email | Workspace |
| --- | --- |
| citizen@surakuma.test | Citizen requests and tracking |
| coordinator@surakuma.test | Crisis oversight and case review |
| case@surakuma.test | Verification and AI review |
| logistics@surakuma.test | Stock, allocation, dispatch and delivery |
| shelter@surakuma.test | Shelter capacity and placements |
| volunteers@surakuma.test | Volunteer coordination |
| volunteer@surakuma.test | Accept and complete own tasks |
| admin@surakuma.test | Users, memberships, organisations and audits |

Never include the development settings file or passwords in a submission ZIP or screenshots. Public registration always creates a citizen, regardless of additional submitted fields.

## Optional real integrations

Without credentials, AI uses labelled deterministic rules, email is captured in SQL, maps display OpenStreetMap tiles, and route/search requests return an explicit unavailable response. No external result is fabricated.

Set variables in the API terminal before starting it:

| Variable | Purpose |
| --- | --- |
| `ConnectionStrings__Default` | Override SQL Server connection |
| `Ai__ApiKey` | Free Gemini API key |
| `Ai__Model` | Configurable supported free-tier model; default in appsettings |
| `Email__Provider` | `Capture` (default) or `Brevo` |
| `Email__ApiKey` | Brevo key |
| `Email__Sender` | Verified Brevo sender email |
| `Mapping__ApiKey` | openrouteservice key for geocoding/routing |
| `Jwt__Key` | Required strong signing key outside Development |

External AI receives only a synthetic request description, never account identity, evidence or exact coordinates. Leave the synthetic checkbox unchecked for real personal information; those requests cannot reach the free external AI adapter. Free provider access and sender activation must be verified with your own accounts. These calls were not live-tested without credentials.

Provider references: [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini data terms](https://ai.google.dev/gemini-api/terms), [Brevo free plan](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans), [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/), [openrouteservice](https://giscience.github.io/openrouteservice/frequently-asked-questions).

Log in as `admin@surakuma.test` and open Administration → **Integration readiness** to inspect configured modes and notification queue counts. Refreshing is read-only and sends nothing. A `Configured` state still requires live validation; see [integration setup and evidence](docs/integrations.md).

## Test

```powershell
.\scripts\Test.ps1
```

Backend integration tests create a uniquely named `Surakuma_Test_<guid>` database, apply real SQL Server migrations, and delete only that fixture database afterward. They never reset the demonstration database. Set `SURAKUMA_TEST_SERVER` if the test instance differs from `.\SQLEXPRESS`.

Browser tests require both servers above. For the API terminal, use `./scripts/Start-Api.ps1 -BrowserTests` for the automated suite: it temporarily raises only the authentication request allowance for rapid synthetic role switching. Normal startup retains the application's default limit. Restart normally after the suite.

```powershell
cd frontend
npx playwright install chromium
npm run test:e2e
```

The browser tests read the ignored local demo password themselves. They create synthetic requests in the demonstration database. They do not send real email.

Create a source-only submission archive with `.\scripts\Package.ps1`. It excludes generated settings, evidence/runtime data, dependencies, build outputs, logs and test traces. Add the reviewed final report and demonstration link separately before institutional submission.

## Project map

- `frontend/src`: public/citizen translations, accessible components, citizen and staff workspaces.
- `backend/src/Surakuma.Domain`: records and operational invariants.
- `backend/src/Surakuma.Application`: use cases, permissions, allocation strategy and provider ports.
- `backend/src/Surakuma.Infrastructure`: SQL persistence/migrations, Identity, adapters, outbox worker and seed data.
- `backend/src/Surakuma.Api`: HTTP controllers, authentication, rate limiting and error handling.
- `docs`: architecture, editable diagrams, demonstration instructions, testing evidence and implementation checklist.

## Troubleshooting

- **Readiness returns 503:** start the configured SQL instance, check Windows authentication and run setup/migrations. A healthy API alone does not establish database readiness.
- **SQL instance not found:** inspect installed instances in SSMS; configure the intended connection. Setup does not install or start a system SQL service.
- **Login fails:** use the password generated during the original seed. Replacing that file does not reset existing account passwords. Five invalid attempts temporarily lock an account.
- **Port already used:** stop an old owned server or change both launch/proxy settings together.
- **Provider quota/outage:** manual case review and textual location still work; inspect notification status in Administration.
- **409 conflict:** refresh the current case/stock/capacity before retrying. Do not blindly repeat an allocation.
- **PowerShell script restriction:** review the script and use your institution's permitted execution policy; commands can also be run individually.

## Limits and handover

The local assessment materials are indexed in [docs/submission/README.md](docs/submission/README.md). `output/docx/Surakuma-technical-report.docx` and `output/pdf/Surakuma-technical-report.pdf` contain deliberately blank identity/contribution fields. `output/demo/index.html` plays the captioned local browser recording. Translation/UAT/contribution templates have blank approval fields. Rebuild the combined source/report/video archive with `./scripts/Package-Submission.ps1` after completing reviews and edits. From `frontend`, `npm run demo:record` records the synthetic walkthrough when both servers are available and the API uses explicit `-BrowserTests` mode; restart normally afterward.

See `docs/implementation-plan.md`, `docs/architecture/decisions.md` and `docs/testing/results.md`. Human language review, participant UAT, live provider account checks, identity/contribution details and final student editorial review remain outstanding. A captioned local demonstration and an editable report/PDF are prepared. Optional donations, payments, forecasting and offline capture are excluded from the core release. Git history should reflect the actual solo build and subsequent testing/documentation contributions.
