# Resources & Logistics

Open **Resources** in the admin workspace. The dashboard shows inventory, case-linked and crisis dispatches, depot transfers, and reservations in the administrator’s authorised countries. Country, crisis, depot, category, status and search filters narrow the views. The crisis filter shows inventory with linked logistics records for that response. Compare inventory quantities by unit. When units differ, KPI cards show how many inventory records have stock or reservations.

## Inventory setup

1. Use **Add resource → Register a depot** to register a depot under a verified or legacy-active organisation in its country.
2. Add a resource at that depot. Set its unit and optional low-stock threshold. Alerts appear when available stock is below the threshold.
3. Use **Record stock** to receive stock or record a stocktake adjustment in either direction. Enter a reason. Available stock is physical minus reserved. A downward adjustment must leave enough physical stock to cover reservations.
4. Open a resource’s details to inspect its ledger or configure its code, low-stock threshold, and initial depot association. Legacy inventory retains its original balances and location labels until assigned a depot.

## Shipments and transfers

**Create dispatch** or **Reserve stock** holds available quantities for an active crisis in the source country. A crisis operational area can identify a delivery point. Existing case allocations appear in the same dashboard and continue to use their case workflow. Dispatching subtracts the reserved quantity from both physical and reserved stock. Confirm receipt to mark the shipment delivered. Release a pending reservation to return its quantity to available stock.

To transfer inventory, register the matching resource and unit at a different depot. Permission to manage both countries is required for cross-border transfers. Queuing reserves the quantity at the origin. Dispatch removes it from origin stock. Confirm receipt to add it to destination stock once. The ledger records the linked reference, movement, quantity, origin, destination, operator, reason, and timestamp.

## API and database

- `GET /api/v1/logistics` returns the authorised dashboard snapshot.
- `POST /api/v1/logistics/depots` registers a depot.
- `POST /api/v1/resources` accepts optional depot, stock-warning threshold, and code fields.
- `POST /api/v1/logistics/resources/{id}/stock` records a stock adjustment or receipt.
- `PATCH /api/v1/logistics/resources/{id}/configuration` configures inventory metadata.
- `GET /api/v1/logistics/resources/{id}/history` reads the stock ledger.
- `POST /api/v1/logistics/orders` reserves crisis or transfer stock. `POST /api/v1/logistics/orders/{id}/{action}` accepts `dispatch`, `deliver`, or `cancel`. Case allocations use the parallel `allocations/{id}/{action}` path in the dashboard.

Migration `20261116164617_LogisticsInventory` adds depot and shipment records and nullable metadata to existing resources and ledger entries. Apply it with the existing migration workflow against the intended database after a verified backup. Downward migration discards depot and shipment records and their ledger metadata. Restore the verified backup if the migrated data must be recovered.
