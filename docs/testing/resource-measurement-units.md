# Resource measurement units verification

18 November 2026. The resource measurement phase starts from `716fb690f8cc0f9f412ae4153545304c3cead1ff` and is implemented on `codex/resource-measurement-units`.

## Operational behavior

- The citizen form records the quantity, chosen unit and optional administrative region from the crisis country. Case tracking and case management display the stored measurement. Shelter requests continue to represent one household placement and use household size for capacity.
- Allocation enforces category and unit compatibility, scoped access, transport availability, unreserved physical stock and the uncommitted request balance. Reservation, dispatch and receipt use the inventory unit. The case balance uses the case unit throughout.
- Depot transfers, partner receipts and confirmed material donations credit inventory in the destination unit. The receiver must be able to represent the converted amount exactly. Donation attribution retains the donation's original unit and reconciles against the converted logistics receipt.
- Forecasts use eight full UTC weeks. Quantities are grouped by recorded region and compatible unit. Mass groups use grams and volume groups use millilitres. Unknown-unit cases count towards case totals and are identified separately.

## Configuration and historical records

The built-in units are pieces, packs, kilograms, grams, litres, millilitres and persons. Surakuma also ships with kits as a configured count unit. Add distinct count units in `ResourceUnits:Additional` using a stable `Code`, a display `Label` and `AllowsFractions: false`. For example, an additional entry can use `boxes` as its code and `Boxes` as its label. Restart the API after a configuration change. A configured count unit matches itself. Keep the same code for the life of its records.

Migration `20261118062152_ResourceMeasurement` adds nullable unit, region and reservation-equivalent fields. It increases delivery precision from two to five decimal places without reducing the supported whole-number range. Historical requests with unspecified measurements retain their quantities, references and history. Valid one-household shelter requests receive the established household unit. Legacy regions remain unrecorded until staff have case-specific evidence. Staff clarify matching historical commitments with an audit reason. Resolve mismatched commitments through verified ledger and case evidence before further fulfilment.

## Verification procedure

Use the standard SQL Server fixtures and the isolated acceptance runner. The fixture database names are generated for each run. The runner starts a separate API with capture-mode email and synthetic users.

```powershell
$env:SURAKUMA_TEST_SERVER = '(localdb)\MSSQLLocalDB'
dotnet test backend/Surakuma.sln --no-restore -m:1
npm --prefix frontend test
npm --prefix frontend run build
pwsh -NoProfile -File scripts/Test-InternationalAcceptance.ps1 -TestFilter '20 L request|citizen submits, staff review AI|mobile citizen form|real three-country|donor and funding administrator|Swagger'
```

| Check | Result |
| --- | --- |
| Backend build and full xUnit suite | 159 passed on SQL Server LocalDB, including conversions, invalid inputs, cross-country denial, scoped legacy clarification, competing reservations, shortages, mixed-unit transfers, donation attribution and forecasting. |
| Migration and standalone script | Clean migration succeeded. The focused upgrade test applied the generated idempotent SQL twice to the prior schema and verified preserved case references, balances, history and inventory. EF reported no model changes pending. |
| Frontend production build and Vitest | TypeScript and Vite build passed. All 67 Vitest tests passed. |
| Isolated Playwright acceptance | Seven scenarios passed. A focused rerun against the final application build passed both water cases and the mobile keyboard and accessibility check. |
| Swagger | The generated contract exposes the resource-unit catalog, measurement clarification, and unit-aware allocation and forecast schemas. |

Browser acceptance observed the same 15 L available and 5 L remaining for inventories recorded as 15 L and 15,000 mL. Both cases showed 15 of 20 L delivered after the real receipt was saved and the page reloaded. The retained browser scenarios also exercised previous pack-based fulfilment, a 375 px keyboard-accessible citizen form, the monetary funding flow, and separately scoped Sri Lanka, India and Nepal journeys.

Before operational deployment, review unresolved legacy records with authorized staff, verify the organization-specific counting conventions for packaged items, and obtain operational and native-speaker acceptance. The demonstration database was outside the migration test scope. The measurement workflow itself requires no external provider.
