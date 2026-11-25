import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../i18n';
import { api, get } from '../api';
import AdminLogistics from '../AdminLogistics';
import { CountryScope } from '../geography';
import type { InventoryItem, LogisticsData } from '../logistics';
import LogisticsCases from '../LogisticsCases';
import LogisticsOverview from '../LogisticsOverview';
import LogisticsProfile from '../LogisticsProfile';
import LogisticsSupplySupport from '../LogisticsSupplySupport';
import type { FulfillmentCase } from '../LogisticsUi';
import { fulfillmentStage } from '../LogisticsUi';

const account = vi.hoisted(() => ({
  user: {
    id: 'logistics',
    name: 'Warehouse operator',
    email: 'operator@example.test',
    language: 'en',
    roles: ['Logistics'],
    memberships: [{ role: 'Logistics', countryCode: 'LK', organisationId: 'org' }],
  },
  updateUser: vi.fn(),
}));
vi.mock('../auth', () => ({ useAuth: () => account }));
vi.mock('../api', () => ({
  get: vi.fn(),
  api: { post: vi.fn(), patch: vi.fn(), put: vi.fn(), request: vi.fn() },
  errorMessage: (error: Error) => error.message,
}));

const empty: InventoryItem = {
  id: 'food',
  name: 'Family food packs',
  code: 'FOOD',
  countryCode: 'LK',
  organisationId: 'org',
  depotId: 'depot',
  category: 'FoodWater',
  unit: 'packs',
  stock: 0,
  reserved: 0,
  available: 0,
  locationText: 'Colombo',
  lowStockThreshold: 10,
  suitability: '',
  transportAvailable: true,
  canShip: true,
};
const water: InventoryItem = {
  ...empty,
  id: 'water',
  name: 'Drinking water',
  code: 'WATER',
  unit: 'l',
  stock: 6,
  reserved: 4,
  available: 2,
};
const today = new Date().toISOString();
const source = { id: 'org', name: 'Relief centre', countryCode: 'LK' };
const supplier = { id: 'supplier', name: 'Verified supplier' };
const request: FulfillmentCase = {
  id: 'case',
  reference: 'SK-100',
  crisisId: 'flood',
  organisationId: 'org',
  category: 'FoodWater',
  priority: 'High',
  status: 'Approved',
  quantity: 3,
  unit: 'l',
  deliveredQuantity: 0,
  reservedQuantity: 0,
  inTransitQuantity: 0,
  hasReservations: false,
  inTransit: false,
  region: 'Colombo',
  synthetic: false,
};
const inTransit = {
  id: 'in-transit',
  kind: 'Dispatch',
  status: 'Dispatched',
  resourceId: 'water',
  crisisId: 'flood',
  requestId: null,
  destinationResourceId: null,
  origin: 'Colombo depot',
  destination: 'Flood response',
  quantity: 3,
  actorId: 'logistics',
  reason: 'Stock to the area',
  createdAt: today,
  updatedAt: today,
  dispatchedAt: today,
} as const;
const stock: LogisticsData = {
  countries: [{ code: 'LK', name: 'Sri Lanka' }],
  depots: [
    {
      id: 'depot',
      name: 'Colombo depot',
      location: 'Colombo',
      countryCode: 'LK',
      organisationId: 'org',
    },
  ],
  inventory: [empty, water],
  partners: [source],
  organisations: [source],
  crises: [{ id: 'flood', name: 'Flood response', countryCode: 'LK', active: true }],
  areas: [],
  actors: {},
  orders: [
    inTransit,
    { ...inTransit, id: 'short-receipt', status: 'DeliveryException' },
    {
      ...inTransit,
      id: 'hold',
      kind: 'Transfer',
      status: 'Reserved',
      dispatchedAt: null,
    },
  ],
};
const cases = [
  request,
  {
    ...request,
    id: 'ready',
    reference: 'SK-200',
    priority: 'Critical',
    region: 'Gampaha',
    hasReservations: true,
    reservedQuantity: 3,
  },
];

function show(page: React.ReactNode, url = '/staff?role=Logistics') {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[url]}>
        <CountryScope.Provider value="LK">{page}</CountryScope.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
  vi.clearAllMocks();
  vi.mocked(get).mockImplementation(async (path) => {
    if (path.startsWith('/logistics/cases')) return cases;
    if (path.startsWith('/logistics?')) return stock;
    if (path.startsWith('/supply-support'))
      return {
        requests: [],
        organisations: [source, supplier],
        requestingOrganisations: [source],
        commitments: [],
        receivableCommitments: [],
        receipts: [],
      };
    if (path === '/auth/logistics-preferences')
      return {
        dispatchUpdates: true,
        stockAlerts: true,
        supplyUpdates: true,
        assignmentUpdates: true,
      };
    if (path === '/auth/profile')
      return {
        assignments: [
          {
            id: 'grant',
            role: 'Logistics',
            country: 'Sri Lanka',
            organisation: source.name,
            crisis: null,
          },
        ],
        emailConfirmed: true,
        workPhone: '+94 11 555 0100',
      };
    throw new Error(path);
  });
});
afterEach(cleanup);

it('requires authorization and completed packing before marking a case ready', () => {
  const row = {
    ...request,
    requiresCoordinatorAuthorization: true,
    hasReservations: true,
    reservedQuantity: request.quantity,
    packingComplete: false,
  };
  expect(fulfillmentStage(row)).toBe('Pending allocation');
  expect(fulfillmentStage({ ...row, authorizedAt: today })).toBe('Reserved');
  expect(fulfillmentStage({ ...row, authorizedAt: today, packingComplete: true })).toBe(
    'Ready to dispatch',
  );
});

it('persists supported notification switches', async () => {
  vi.mocked(api.put).mockResolvedValue({ data: {} });
  show(<LogisticsProfile />, '/app/profile?role=Logistics');
  fireEvent.click(await screen.findByRole('switch', { name: 'Dispatch updates' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save notification preferences' }));
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/auth/logistics-preferences', {
      dispatchUpdates: false,
      stockAlerts: true,
      supplyUpdates: true,
      assignmentUpdates: true,
    }),
  );
});

it('uses common stock and case counts with links into filtered records', async () => {
  vi.mocked(get).mockImplementation(async path => path.startsWith('/logistics?')
    ? { ...stock, inventory: [empty], caseInventory: [water] }
    : cases);
  show(<LogisticsOverview />);
  const kpis = within(await screen.findByRole('list', { name: 'Operational summary' }));
  expect(kpis.getByText('Inventory records').closest('li')).toHaveTextContent('Inventory records2');
  expect(kpis.getByText('Stock alerts').closest('li')).toHaveTextContent('1 low · 1 out of stock');
  expect(kpis.getByText('Pending reservations').closest('li')).toHaveTextContent('1');
  expect(kpis.getByText('Ready to dispatch').closest('li')).toHaveTextContent('1');
  expect(kpis.getByText('In transit').closest('li')).toHaveTextContent('1');
  expect(kpis.getByText('Delivery exceptions').closest('li')).toHaveTextContent('1');
  expect(screen.getByRole('link', { name: 'Review 1 dispatch exception' })).toHaveAttribute(
    'href',
    expect.stringContaining('status=Exception'),
  );
  expect(screen.getByRole('table', { name: /today’s dispatch queue/i })).toHaveTextContent('3 L');
  expect(screen.getByText('No arrival schedules recorded for active dispatches.')).toBeVisible();
});

it('counts and filters case-only inventory without offering direct stock management', async () => {
  const reservedWater = { ...water, available: 0, reserved: water.stock };
  const formula = { ...empty, id: 'formula', name: 'Baby formula', depotId: 'other-depot', unit: 'pieces',
    available: 4, stock: 4, lowStockThreshold: null };
  vi.mocked(get).mockResolvedValue({ ...stock, inventory: [], partners: [], depots: [], orders: [],
    caseInventory: [reservedWater, formula],
    caseStockScope: [
      { organisationId: 'org', crisisId: 'flood', depotId: 'depot' },
      { organisationId: 'org', crisisId: 'other-crisis', depotId: 'other-depot' },
    ],
    resourceRegistration: { partners: [], depots: [
      { ...stock.depots[0], canManageStock: false },
      { ...stock.depots[0], id: 'other-depot', name: 'Gampaha depot', canManageStock: false },
    ] },
  });
  show(<AdminLogistics specialist />, '/staff/resources?role=Logistics');
  const kpis = within(await screen.findByRole('list', { name: 'Logistics summary' }));
  expect(kpis.getByText('Total resources').closest('li')).toHaveTextContent('Total resources2');
  expect(kpis.getByText('Available stock').closest('li')).toHaveTextContent('Available stock1');
  expect(kpis.getByText('Reserved stock').closest('li')).toHaveTextContent('Reserved stock1');
  const table = within(screen.getByRole('table', { name: 'Inventory' }));
  expect(table.getByText('Gampaha depot')).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: 'Crisis' }), { target: { value: 'flood' } });
  expect(kpis.getByText('Total resources').closest('li')).toHaveTextContent('Total resources1');
  expect(table.queryByText('Baby formula')).toBeNull();
  fireEvent.click(table.getByRole('button', { name: 'Details for Drinking water' }));
  const details = within(screen.getByRole('dialog', { name: 'Resource details' }));
  expect(details.getByText(/6 physical · 6 reserved · 0 available/)).toBeVisible();
  expect(details.queryByRole('button', { name: 'Record stock' })).toBeNull();
  expect(details.queryByText('Stock movement ledger')).toBeNull();
});

it('filters reservations and stock alerts against their actual records', async () => {
  show(<AdminLogistics specialist />, '/staff/resources?status=Stock+alerts');
  const inventory = within(await screen.findByRole('table', { name: 'Inventory' }));
  expect(inventory.getByText('Out of stock')).toBeVisible();
  expect(inventory.getByText('Low stock')).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'Inventory country' })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Drinking water' } });
  expect(inventory.queryByText('Family food packs')).toBeNull();
  const tabs = within(screen.getByRole('navigation', { name: 'Logistics views' }));
  expect(tabs.getByRole('button', { name: 'Reservations (1)' })).toBeVisible();
  fireEvent.click(tabs.getByRole('button', { name: 'Reservations (1)' }));
  const reservations = within(screen.getByRole('table', { name: 'Reservations' }));
  expect(reservations.getByText(/^TRF-/)).toBeVisible();
  expect(reservations.queryByText(/^DSP-/)).toBeNull();
});

it.each(['allocations', 'orders'])('releases %s from the dispatch list in one click and keeps cancelled history', async (source) => {
  const dispatch = { ...inTransit, id: 'pending', reference: 'DSP-1013', status: 'Reserved' as const,
    requestId: source === 'allocations' ? request.id : null };
  let released = false;
  vi.mocked(get).mockImplementation(async () => ({
    ...stock,
    inventory: released ? [{ ...water, reserved: 0, available: water.stock }] : [water],
    orders: [{ ...dispatch, status: released ? 'Cancelled' : 'Reserved' }],
  }));
  vi.mocked(api.post).mockRejectedValueOnce(new Error('Could not release stock.'))
    .mockImplementationOnce(async () => {
      released = true;
      return { data: { ...dispatch, status: 'Cancelled' } };
    });
  show(<AdminLogistics specialist />, '/staff/resources?tab=dispatches');
  const dispatches = within(await screen.findByRole('table', { name: 'Dispatches' }));
  fireEvent.click(dispatches.getByRole('button', { name: 'Release' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(await dispatches.findByRole('alert')).toHaveTextContent('Could not release stock.');
  expect(dispatches.getByText('Pending')).toBeVisible();

  fireEvent.click(dispatches.getByRole('button', { name: 'Release' }));
  expect(await screen.findByText('Reservation released. Stock is available again.')).toBeVisible();
  expect(api.post).toHaveBeenCalledTimes(2);
  expect(api.post).toHaveBeenLastCalledWith(`/logistics/${source}/pending/cancel`, { reason: 'Reservation released by staff.' });
  expect(screen.queryByText('DSP-1013')).toBeNull();
  const summary = within(screen.getByRole('list', { name: 'Logistics summary' }));
  expect(summary.getByText('Reserved stock').closest('li')).toHaveTextContent('Reserved stock0');

  fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'Cancelled' } });
  const history = within(screen.getByRole('table', { name: 'Dispatches' }));
  expect(history.getByText('DSP-1013')).toBeVisible();
  expect(history.getByText('Cancelled')).toBeVisible();
  const recent = within(screen.getByRole('complementary', { name: 'Logistics activity' }));
  expect(recent.getByRole('button', { name: 'DSP-1013' })).toBeVisible();
  expect(history.queryByRole('button', { name: 'Release' })).toBeNull();
});

it('shows current dispatches by default and keeps completed shipments in the status filter', async () => {
  const centreLine = { ...inTransit, requestId: request.id, centreReceivedAt: today };
  vi.mocked(get).mockResolvedValue({
    ...stock,
    orders: [
      { ...inTransit, reference: 'DSP-1018' },
      { ...inTransit, id: 'pending', reference: 'DSP-1019', status: 'Reserved' },
      { ...centreLine, id: 'complete-water', caseDispatchId: 'complete', reference: 'DSP-1020', status: 'Delivered' },
      { ...centreLine, id: 'complete-food', caseDispatchId: 'complete', reference: 'DSP-1020', status: 'Delivered', resourceId: 'food' },
      { ...centreLine, id: 'partial-water', caseDispatchId: 'partial', reference: 'DSP-1021', status: 'Delivered' },
      { ...centreLine, id: 'partial-food', caseDispatchId: 'partial', reference: 'DSP-1021', resourceId: 'food' },
      { ...inTransit, id: 'delivered', reference: 'DSP-1022', status: 'Delivered' },
    ],
  } satisfies LogisticsData);

  show(<AdminLogistics specialist />, '/staff/resources?role=Logistics');
  fireEvent.click(await screen.findByRole('button', { name: 'Dispatches (3)' }));
  const status = screen.getByRole('combobox', { name: 'Status' });
  const dispatches = within(screen.getByRole('table', { name: 'Dispatches' }));
  expect(status).toHaveDisplayValue('Current dispatches');
  expect(dispatches.getByText('DSP-1018')).toBeVisible();
  expect(dispatches.getByText('DSP-1019')).toBeVisible();
  const partial = within(dispatches.getByText('DSP-1021').closest('tr')!);
  expect(partial.getByText('At centre')).toBeVisible();
  expect(partial.getByText('stock lines')).toBeVisible();
  expect(screen.queryByText('DSP-1020')).toBeNull();
  expect(screen.queryByText('DSP-1022')).toBeNull();

  fireEvent.change(status, { target: { value: 'All' } });
  const completed = within(dispatches.getByText('DSP-1020').closest('tr')!);
  expect(completed.getByText('Handover verified')).toBeVisible();
  expect(completed.getByRole('link', { name: 'View dispatch' })).toBeVisible();
  expect(dispatches.getByText('DSP-1022')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Dispatches (5)' })).toBeVisible();
});

it('opens the exact centre receipt from the dispatch register and records it on confirmation', async () => {
  const centre = { id: 'depot', name: 'Colombo depot', location: 'Colombo' };
  let received = false;
  vi.mocked(get).mockImplementation(async path => {
    if (path.startsWith('/logistics?')) return {
      ...stock, orders: [{ ...inTransit, caseDispatchId: 'batch', requestId: request.id, reference: 'DSP-1020' }],
    };
    if (path === '/logistics/cases/case') return {
      case: { ...request, requiresCentreHandover: true, inTransit: !received, atCentre: received },
      allocations: [], history: [],
    };
    if (path === '/fulfillment/cases/case/dispatches') return {
      centre, centres: [], canPlan: false, dispatches: [{
        id: 'batch', reference: 'DSP-1020', centre: centre.name, sentAt: today, receivedAt: received ? today : null,
        canReceive: !received, items: [{ id: 'water-line', name: 'Drinking water', unit: 'l', sent: 3,
          atCentre: received ? 3 : null, givenToCitizen: null }],
      }],
    };
    throw new Error(`Unexpected request ${path}`);
  });
  vi.mocked(api.post).mockImplementationOnce(async () => {
    received = true;
    return { data: {} };
  });
  show(<Routes>
    <Route path="/staff/resources" element={<AdminLogistics specialist />} />
    <Route path="/staff/cases/:id" element={<LogisticsCases />} />
  </Routes>, '/staff/resources?role=Logistics&tab=dispatches');

  const action = await screen.findByRole('link', { name: 'Open centre receipt' });
  expect(action).toHaveAttribute('href', '/staff/cases/case?role=Logistics&dispatch=batch');
  fireEvent.click(action);
  const manifest = await screen.findByRole('region', { name: 'DSP-1020' });
  expect(manifest.querySelector('details')).toHaveAttribute('open');
  expect(api.post).not.toHaveBeenCalled();
  const receipt = within(manifest);
  fireEvent.change(receipt.getByLabelText(/Received Drinking water/), { target: { value: '3' } });
  fireEvent.click(receipt.getByRole('button', { name: 'Confirm centre receipt' }));

  expect(await receipt.findByText('At the centre, awaiting volunteer handover')).toBeVisible();
  expect(api.post).toHaveBeenCalledWith('/fulfillment/dispatches/batch/receive', {
    items: [{ allocationId: 'water-line', quantity: 3 }], note: '',
  });
});

it('combines case state, urgency and region filters and shows compatible stock in the requested unit', async () => {
  vi.mocked(get).mockImplementation(async path => path.startsWith('/logistics/cases') ? cases : {
    ...stock, orders: [...stock.orders, { ...inTransit, id: 'released', requestId: request.id, status: 'Cancelled' }],
  });
  show(<LogisticsCases />, '/staff/cases');
  const results = within(await screen.findByRole('table', { name: 'Case fulfillment queue' }));
  expect(results.getByText('2 L in depot stock')).toBeVisible();
  expect(results.getByText('Partial match')).toBeVisible();
  expect(results.getByText('Stock released to depot')).toBeVisible();
  const stages = within(screen.getByRole('group', { name: 'Case fulfillment stages' }));
  expect(stages.getByRole('button', { name: /Pending allocation.*1/ })).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: 'Urgency' }), {
    target: { value: 'Critical' },
  });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'gampaha' } });
  expect(results.queryByText('SK-100')).toBeNull();
  expect(stages.getByRole('button', { name: /Pending allocation.*0/ })).toBeVisible();
  expect(stages.getByRole('button', { name: /Ready to dispatch.*1/ })).toBeVisible();
  expect(results.getByRole('link', { name: 'Prepare dispatch' })).toHaveAttribute(
    'href',
    '/staff/cases/ready?role=Logistics',
  );
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
});

it('refreshes the cached case stage and counts when packed stock is dispatched', async () => {
  const item = { id: 'water-need', name: 'Drinking water', category: 'FoodWater', unit: 'l',
    requiredQuantity: 3, approvedQuantity: 3, deliveredQuantity: 0 };
  const allocation = { id: 'case-dispatch', needId: item.id, name: item.name, resourceId: water.id,
    depot: 'Colombo depot', quantity: 3, unit: 'l', requestQuantity: 3, createdAt: today, updatedAt: today,
    packedAt: today };
  let dispatched = false;
  let queueReads = 0;
  vi.mocked(api.request).mockImplementation(async () => {
    dispatched = true;
    return { data: { ...allocation, status: 'Dispatched' } };
  });
  vi.mocked(get).mockImplementation(async path => {
    const row = { ...request, needCount: 1,
      items: [{ ...item, reservedQuantity: dispatched ? 0 : 3, inTransitQuantity: dispatched ? 3 : 0 }], hasReservations: !dispatched,
      packingComplete: !dispatched, needsPending: false, inTransit: dispatched };
    if (path.startsWith('/logistics/cases?')) {
      queueReads++;
      return [row];
    }
    if (path === '/logistics/cases/case') return { case: row, history: [],
      allocations: [{ ...allocation, status: dispatched ? 'Dispatched' : 'Reserved' }] };
    if (path.startsWith('/logistics?')) return stock;
    throw new Error(`Unexpected request ${path}`);
  });
  show(<Routes><Route path="/staff/cases/:id?" element={<LogisticsCases />} /></Routes>, '/staff/cases?role=Logistics');
  fireEvent.click(await screen.findByRole('link', { name: 'Prepare dispatch' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Dispatch packed stock' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Dispatch stock' }));
  fireEvent.change(dialog.getByLabelText('Reason'), { target: { value: 'Shipment left the depot.' } });
  const readsBeforeDispatch = queueReads;
  fireEvent.click(dialog.getByRole('button', { name: 'Dispatch stock' }));
  expect(await screen.findByText('Stock dispatched.')).toBeVisible();
  expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ url: '/logistics/allocations/case-dispatch/dispatch' }));
  expect(queueReads).toBeGreaterThan(readsBeforeDispatch);
  fireEvent.click(screen.getByRole('link', { name: 'Back to fulfillment queue' }));

  const stages = within(screen.getByRole('group', { name: 'Case fulfillment stages' }));
  expect(stages.getByRole('button', { name: /Pending allocation.*0/ })).toBeVisible();
  expect(stages.getByRole('button', { name: /Ready to dispatch.*0/ })).toBeVisible();
  fireEvent.click(stages.getByRole('button', { name: /In transit.*1/ }));
  const results = within(screen.getByRole('table', { name: 'Case fulfillment queue' }));
  expect(results.getByText('In transit')).toBeVisible();
  expect(results.getByRole('link', { name: 'Review shipment' })).toBeVisible();
});

it.each([true, false])('combines same-depot stock and allows reserving across records (item case: %s)', async (itemCase) => {
  const large = { ...water, stock: 52, reserved: 2, available: 50 };
  const small = { ...water, id: 'water-topup', unit: 'litres', stock: 10, reserved: 0, available: 10 };
  const otherDepot = { ...small, id: 'water-other', depotId: 'another-depot', locationText: 'Another depot' };
  const incompatiblePackage = { ...small, id: 'water-bottles', unit: 'bottles' };
  const resources = [large, small, otherDepot, incompatiblePackage];
  const item = { id: 'water-need', name: 'Drinking water', category: 'FoodWater', unit: 'l',
    requiredQuantity: 60, approvedQuantity: 60, deliveredQuantity: 0, reservedQuantity: 0, inTransitQuantity: 0 };
  vi.mocked(api.post).mockResolvedValue({ data: [] });
  vi.mocked(get).mockImplementation(async path => {
    if (path === '/logistics/cases/case') return { case: { ...request, quantity: 60, needCount: itemCase ? 1 : 0,
      items: itemCase ? [item] : [] }, allocations: [], history: [] };
    if (path.startsWith('/logistics?')) return { ...stock, inventory: resources };
    if (path.includes('/allocation-recommendations')) return { outstanding: 60, candidates: resources.slice(0, 3).map(resource => ({
      resourceId: resource.id, name: resource.name, unit: resource.unit, available: resource.available,
      suggestedQuantity: resource.available, transportAvailable: true,
    })) };
    throw new Error(`Unexpected request ${path}`);
  });
  show(<Routes><Route path="/staff/cases/:id" element={<LogisticsCases />} /></Routes>, '/staff/cases/case');
  if (itemCase) fireEvent.click(await screen.findByRole('button', { name: 'Review stock for Drinking water' }));

  const selector = await screen.findByLabelText('Stock source');
  const combined = within(selector).getByRole('option', { name: /Drinking water · Colombo depot · 60 L/ });
  expect(within(selector).getByRole('option', { name: 'Drinking water · Another depot · 10 L' })).toBeVisible();
  expect(within(selector).queryByRole('option', { name: /50 L|bottles/ })).toBeNull();
  fireEvent.change(selector, { target: { value: (combined as HTMLOptionElement).value } });
  const quantity = screen.getByLabelText('Quantity (L)');
  expect(quantity).toHaveAttribute('max', '60');
  fireEvent.change(quantity, { target: { value: '55' } });
  fireEvent.click(screen.getByRole('button', { name: itemCase ? 'Reserve item' : 'Reserve stock' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/allocations/group', expect.objectContaining({
    requestId: request.id, resourceId: large.id, quantity: 55, ...(itemCase ? { needId: item.id } : {}),
  })));
});

it('reviews stock by item and refreshes its remaining quantity after a reservation', async () => {
  const items = [
    { id: 'formula', name: 'Baby formula', unit: 'pieces', requiredQuantity: 1, approvedQuantity: 1 },
    { id: 'drinking-water', name: 'Drinking water', unit: 'l', requiredQuantity: 3, approvedQuantity: 3 },
  ].map(item => ({ ...item, category: 'FoodWater', deliveredQuantity: 0, inTransitQuantity: 0 }));
  const bottledWater = { ...water, unit: 'ml', available: 2000 };
  const allocation = { id: 'allocation', needId: 'drinking-water', name: 'Drinking water', resourceId: water.id,
    status: 'Reserved', depot: 'Colombo depot', quantity: 2000, unit: 'ml', requestQuantity: 2,
    createdAt: today, updatedAt: today };
  let allocationStatus: 'Reserved' | 'Cancelled' | undefined;
  vi.mocked(api.post).mockImplementation(async () => {
    allocationStatus = 'Reserved';
    return { data: allocation };
  });
  vi.mocked(get).mockImplementation(async path => {
    if (path === '/logistics/cases/case') return {
      case: { ...request, needCount: items.length, items: items.map(item => ({ ...item,
        reservedQuantity: item.id === allocation.needId && allocationStatus === 'Reserved' ? 2 : 0 })) },
      allocations: allocationStatus ? [{ ...allocation, status: allocationStatus }] : [], history: [],
    };
    if (path.startsWith('/logistics?')) return { ...stock, inventory: allocationStatus === 'Reserved' ? [] : [bottledWater] };
    if (path.includes('allocation-recommendations')) return {
      candidates: [], shortageExplanation: 'Compare transport-ready stock with the approved balance.',
    };
    throw new Error(`Unexpected request ${path}`);
  });
  show(<Routes><Route path="/staff/cases/:id" element={<LogisticsCases />} /></Routes>, '/staff/cases/case');

  fireEvent.click(await screen.findByRole('button', { name: 'Review stock for Baby formula' }));
  const shortage = within(screen.getByRole('dialog', { name: 'Reserve Baby formula' }));
  expect(shortage.getByText('No compatible stock')).toBeVisible();
  expect(shortage.getByRole('button', { name: 'Reserve item' })).toBeDisabled();
  fireEvent.click(shortage.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Review stock for Drinking water' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Reserve Drinking water' }));
  expect(dialog.getByText('3 L awaiting allocation')).toBeVisible();
  fireEvent.change(dialog.getByLabelText('Stock source'), { target: { value: water.id } });
  const quantity = dialog.getByLabelText('Quantity (mL)');
  expect(quantity).toHaveAttribute('max', '2000');
  expect(dialog.getByText('2,000 mL available · Up to 2,000 mL for this case')).toBeVisible();
  expect(dialog.getByRole('button', { name: 'Reserve item' })).toBeDisabled();
  fireEvent.change(quantity, { target: { value: '2001' } });
  expect(dialog.getByRole('button', { name: 'Reserve item' })).toBeDisabled();
  fireEvent.change(quantity, { target: { value: '2000' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Reserve item' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.post).toHaveBeenCalledWith('/allocations', expect.objectContaining({
    requestId: 'case', needId: 'drinking-water', resourceId: water.id, quantity: 2000,
  }));
  expect(screen.getByRole('status')).toHaveTextContent(/reserved for Drinking water/);
  const card = screen.getByRole('heading', { name: 'Drinking water' }).closest('li')!;
  expect(within(card).getByText('Reserved').parentElement).toHaveTextContent('2 L');
  expect(within(card).getByText('Awaiting allocation').parentElement).toHaveTextContent('1 L');

  vi.mocked(api.post).mockImplementationOnce(async () => {
    allocationStatus = 'Cancelled';
    return { data: { ...allocation, status: 'Cancelled' } };
  });
  fireEvent.click(screen.getByRole('button', { name: 'Release' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Reservation released. Stock is available again.'));
  expect(api.post).toHaveBeenLastCalledWith('/logistics/allocations/allocation/cancel', { reason: 'Reservation released by staff.' });
  expect(within(card).getByText('Awaiting allocation').parentElement).toHaveTextContent('3 L');
  expect(screen.queryByRole('button', { name: 'Release' })).toBeNull();
});

it('shows approved, reserved, in-transit and delivered figures even when shipment rows are outside depot access', async () => {
  const item = { id: 'water-need', name: 'Drinking water', category: 'FoodWater', unit: 'l',
    requiredQuantity: 12, approvedQuantity: 10, deliveredQuantity: 1, reservedQuantity: 2, inTransitQuantity: 4 };
  vi.mocked(get).mockImplementation(async path => {
    if (path === '/logistics/cases/case') return { case: { ...request, needCount: 1, items: [item], inTransit: true },
      allocations: [], history: [] };
    if (path.startsWith('/logistics?')) return stock;
    if (path.includes('/allocation-recommendations')) return { candidates: [] };
    throw new Error(`Unexpected request ${path}`);
  });
  show(<Routes><Route path="/staff/cases/:id" element={<LogisticsCases />} /></Routes>, '/staff/cases/case');

  const card = within((await screen.findByRole('heading', { name: 'Drinking water' })).closest('li')!);
  for (const [label, quantity] of [['Required', '12 L'], ['Approved', '10 L'], ['Reserved', '2 L'],
    ['In transit', '4 L'], ['Delivered', '1 L'], ['Awaiting allocation', '3 L']]) {
    expect(card.getByText(label, { exact: true }).parentElement).toHaveTextContent(quantity);
  }
});

it('prefills a stock gap using the selected depot item and submits a matching quantity and unit', async () => {
  vi.mocked(api.post).mockResolvedValue({ data: { id: 'request' } });
  show(<LogisticsSupplySupport />, '/staff/supply-support');
  fireEvent.click(await screen.findByRole('button', { name: 'Drinking water' }));
  expect(screen.getByLabelText('Unit')).toHaveValue('l');
  expect(screen.getByRole('spinbutton', { name: 'Quantity' })).toHaveValue(8);
  expect(screen.getByLabelText('Requesting organisation')).toHaveAttribute('readonly');
  fireEvent.change(screen.getByLabelText('Supplying organisation'), {
    target: { value: 'supplier' },
  });
  fireEvent.change(screen.getByLabelText('Operational justification'), {
    target: { value: 'Restore depot stock.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Submit supply request' }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/supply-support/LK',
      expect.objectContaining({
        destinationResourceId: 'water',
        requestingOrganisationId: source.id,
        targetOrganisationId: supplier.id,
        unit: 'l',
        quantity: 8,
      }),
    ),
  );
});

it('patches only changed profile fields and keeps identity and unsupported preferences read-only', async () => {
  vi.mocked(api.patch).mockResolvedValue({ data: account.user });
  show(<LogisticsProfile />, '/app/profile?role=Logistics');
  expect(await screen.findByText('Email verified')).toBeVisible();
  expect(screen.getByLabelText('Email address')).toHaveAttribute('readonly');
  expect(await screen.findByRole('switch', { name: 'Dispatch updates' })).toBeChecked();
  expect(await screen.findByText('Colombo depot')).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: /work phone/i }), {
    target: { value: '+94 11 555 0199' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith('/auth/profile/contact', {
      workPhone: '+94 11 555 0199',
    }),
  );
  await waitFor(() => expect(account.updateUser).toHaveBeenCalledWith(account.user));
});
