import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import '../i18n';
import AdminLogistics from '../AdminLogistics';
import { api, get } from '../api';
import { CountryScope } from '../geography';
import type { InventoryItem, LogisticsData } from '../logistics';

vi.mock('../api', () => ({ get: vi.fn(), api: { request: vi.fn().mockResolvedValue({ data: {} }) }, errorMessage: (e: Error) => e.message }));
afterEach(cleanup);

it('finds country-scoped places from the resource map and applies the selected coordinates', async () => {
  HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function () { this.removeAttribute('open'); };
  const data: LogisticsData = {
    countries: [{ code: 'LK', name: 'Sri Lanka' }], depots: [], inventory: [], crises: [], areas: [],
    actors: {}, orders: [], partners: [{ id: 'saviya', name: 'Saviya Organisation', countryCode: 'LK' }],
  };
  vi.mocked(get).mockImplementation(async path => {
    if (path.startsWith('/logistics?')) return data;
    if (path === '/countries/LK/divisions') return [{ id: 'gampaha', name: 'Gampaha', levelName: 'District', parentId: null }];
    if (path.startsWith('/maps/geocode?')) return { features: [
      { properties: { label: 'Gampaha, Western Province' }, geometry: { coordinates: [80.0, 7.09] } },
      { properties: { label: 'Gampaha District' }, geometry: { coordinates: [80.02, 7.11] } },
    ] };
    return [];
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><CountryScope.Provider value="LK"><AdminLogistics specialist /></CountryScope.Provider></MemoryRouter>
  </QueryClientProvider>);

  fireEvent.click(await screen.findByRole('button', { name: 'Add resource' }));
  const modal = screen.getByRole('dialog', { name: 'Add resource' });
  const form = within(modal);
  expect(await form.findByRole('option', { name: 'Gampaha' })).toHaveValue('gampaha');
  fireEvent.click(form.getByRole('button', { name: 'Choose location on map' }));
  const search = form.getByRole('searchbox', { name: 'Search location' });
  fireEvent.change(search, { target: { value: 'Gampaha' } });
  expect(fireEvent.keyDown(search, { key: 'Enter' })).toBe(false);
  const result = await form.findByRole('button', { name: 'Gampaha, Western Province' });
  expect(get).toHaveBeenCalledWith('/maps/geocode?countryCode=LK&query=Gampaha');
  expect(form.getByLabelText('Latitude')).toHaveValue(null);
  fireEvent.click(result);
  expect(form.getByLabelText('Latitude')).toHaveValue(7.09);
  expect(form.getByLabelText('Longitude')).toHaveValue(80);
  expect(search).toHaveValue('Gampaha, Western Province');
});

it('allows crisis-assigned Logistics staff to register stock without exposing general stock actions', async () => {
  HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function () { this.removeAttribute('open'); };
  const depot = { id: 'gampaha', name: 'Gampaha depot', countryCode: 'LK', location: 'Gampaha', organisationId: 'saviya', canManageStock: false };
  const data: LogisticsData = {
    countries: [{ code: 'LK', name: 'Sri Lanka' }],
    depots: [], inventory: [], crises: [], areas: [], actors: {}, orders: [], partners: [],
    resourceRegistration: {
      depots: [depot],
      partners: [{ id: 'saviya', name: 'Saviya Organisation', countryCode: 'LK', canRegisterDepot: false }],
    },
  };
  vi.mocked(get).mockImplementation(async path => path.startsWith('/logistics?') ? data : []);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><CountryScope.Provider value="LK"><AdminLogistics specialist /></CountryScope.Provider></MemoryRouter>
  </QueryClientProvider>);

  fireEvent.click(await screen.findByRole('button', { name: 'Add resource' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Add resource' }));
  expect(dialog.getByRole('option', { name: 'Gampaha depot' })).toBeInTheDocument();
  expect(dialog.queryByRole('button', { name: 'Register a depot' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Create dispatch' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Record stock' })).toBeNull();
});

it('keeps the resource draft when cancelling or saving depot registration', async () => {
  HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function () { this.removeAttribute('open'); };
  const depot = { id: 'new-depot', name: 'New receiving centre', countryCode: 'LK', location: 'Gampaha', organisationId: 'org' };
  const data: LogisticsData = {
    countries: [{ code: 'LK', name: 'Sri Lanka' }], depots: [], inventory: [], orders: [], crises: [], areas: [],
    actors: {}, partners: [{ id: 'org', name: 'Relief organisation', countryCode: 'LK' }],
  };
  vi.mocked(get).mockImplementation(async path => path.startsWith('/logistics?') ? data : []);
  vi.mocked(api.request).mockResolvedValueOnce({ data: depot });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><CountryScope.Provider value="LK"><AdminLogistics specialist /></CountryScope.Provider></MemoryRouter>
  </QueryClientProvider>);

  fireEvent.click(await screen.findByRole('button', { name: 'Add resource' }));
  const draft = within(screen.getByRole('dialog', { name: 'Add resource' }));
  fireEvent.change(draft.getByLabelText('Resource name'), { target: { value: 'Water' } });
  fireEvent.change(draft.getByLabelText('Opening stock'), { target: { value: '30' } });
  fireEvent.change(draft.getByLabelText('Low-stock threshold'), { target: { value: '5' } });
  fireEvent.click(draft.getByRole('button', { name: 'Register a depot' }));
  const registration = within(screen.getByRole('dialog', { name: 'Register depot' }));
  fireEvent.click(registration.getByRole('button', { name: 'Cancel' }));
  expect(draft.getByLabelText('Opening stock')).toHaveValue(30);
  expect(draft.getByLabelText('Low-stock threshold')).toHaveValue(5);
  fireEvent.click(draft.getByRole('button', { name: 'Register a depot' }));
  fireEvent.change(registration.getByLabelText('Organisation'), { target: { value: 'org' } });
  fireEvent.change(registration.getByLabelText('Depot name'), { target: { value: depot.name } });
  fireEvent.change(registration.getByLabelText('Depot location'), { target: { value: depot.location } });
  fireEvent.click(registration.getByRole('button', { name: 'Save depot' }));
  await screen.findByRole('dialog', { name: 'Add resource' });
  expect(draft.getByLabelText('Depot')).toHaveValue(depot.id);
  expect(draft.getByLabelText('Resource name')).toHaveValue('Water');
  expect(draft.getByLabelText('Opening stock')).toHaveValue(30);
  expect(draft.getByLabelText('Low-stock threshold')).toHaveValue(5);
});

it.each([false, true])('filters Add resource items and units by category and resets quantities (specialist: %s)', async (specialist) => {
  HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function () { this.removeAttribute('open'); };
  const data: LogisticsData = {
    countries: [{ code: 'LK', name: 'Sri Lanka' }],
    depots: [{ id: 'depot', name: 'Gampaha Centre', location: 'Gampaha', organisationId: 'org', countryCode: 'LK' }],
    inventory: [], crises: [], areas: [], actors: {}, orders: [],
    partners: [{ id: 'org', name: 'Relief organisation', countryCode: 'LK' }],
  };
  const catalog = [
    { code: 'pieces', label: 'Pieces', allowsFractions: false, stockCategories: ['FoodWater', 'Medical', 'Shelter', 'Transportation', 'Accessibility', 'Other'] },
    { code: 'kg', label: 'Kilograms (kg)', allowsFractions: true, stockCategories: ['FoodWater', 'Other'] },
    { code: 'vials', label: 'Vials', allowsFractions: false, stockCategories: ['Medical'] },
    { code: 'rolls', label: 'Rolls', allowsFractions: false, stockCategories: ['Shelter'] },
    { code: 'l', label: 'Litres (L)', allowsFractions: true, stockCategories: ['Transportation', 'FoodWater'] },
    { code: 'pairs', label: 'Pairs', allowsFractions: false, stockCategories: ['Accessibility', 'Other'] },
    { code: 'persons', label: 'Persons', allowsFractions: false, stockCategories: [] },
  ];
  vi.mocked(get).mockImplementation(async (path) => path.startsWith('/logistics?') ? data :
    path === '/public/resource-units' ? catalog : []);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><CountryScope.Provider value="LK"><AdminLogistics specialist={specialist} /></CountryScope.Provider></MemoryRouter>
  </QueryClientProvider>);

  fireEvent.click(await screen.findByRole('button', { name: 'Add resource' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Add resource' }));
  const category = dialog.getByRole('combobox', { name: 'Category' });
  const resource = dialog.getByRole('combobox', { name: 'Resource name' });
  const unit = dialog.getByRole<HTMLSelectElement>('combobox', { name: 'Unit' });
  await within(unit).findByRole('option', { name: 'Pieces' });
  expect(unit).toHaveValue('');
  for (const [categoryCode, expected, example] of [
    ['FoodWater', ['', 'pieces', 'kg', 'l'], 'Drinking water'],
    ['Medical', ['', 'pieces', 'vials'], 'Medical support kits'],
    ['Shelter', ['', 'pieces', 'rolls'], 'Tents'],
    ['Transportation', ['', 'pieces', 'l'], 'Fuel'],
    ['Accessibility', ['', 'pieces', 'pairs'], 'Wheelchairs'],
    ['Other', ['', 'pieces', 'kg', 'pairs'], 'Protective gloves'],
  ] as const) {
    fireEvent.change(category, { target: { value: categoryCode } });
    expect(within(resource).getByRole('option', { name: example })).toBeVisible();
    expect(resource).toHaveValue('');
    expect(Array.from(unit.options, option => option.value)).toEqual(expected);
    expect(unit).toHaveValue('');
    fireEvent.change(unit, { target: { value: 'pieces' } });
  }
  fireEvent.change(category, { target: { value: 'FoodWater' } });
  expect(within(resource).getByRole('option', { name: 'Baby formula' })).toBeVisible();
  expect(within(resource).getByRole('option', { name: 'Cleaning supplies' })).toBeVisible();
  fireEvent.change(resource, { target: { value: 'Water' } });
  expect(category).toHaveValue('FoodWater');
  expect(category).toBeEnabled();
  expect(unit).toHaveValue('l');
  expect(dialog.getByLabelText('Opening stock')).toHaveAttribute('step', '1');
  expect(dialog.getByLabelText('Low-stock threshold')).toHaveAttribute('step', '1');
  expect(dialog.queryByLabelText('Custom resource name')).toBeNull();
  fireEvent.change(dialog.getByLabelText('Opening stock'), { target: { value: '0.02' } });
  expect(dialog.getByLabelText('Opening stock')).toBeInvalid();
  fireEvent.change(unit, { target: { value: 'kg' } });
  expect(dialog.getByLabelText('Opening stock')).toHaveAttribute('step', '0.01');
  fireEvent.change(dialog.getByLabelText('Opening stock'), { target: { value: '3.5' } });
  expect(dialog.getByLabelText('Opening stock')).toBeValid();
  fireEvent.change(dialog.getByLabelText('Low-stock threshold'), { target: { value: '1.5' } });
  fireEvent.change(category, { target: { value: 'Shelter' } });
  expect(within(resource).queryByRole('option', { name: 'Drinking water' })).toBeNull();
  expect(resource).toHaveValue('');
  expect(unit).toHaveValue('');
  fireEvent.change(resource, { target: { value: 'Tents' } });
  expect(unit).toHaveValue('pieces');
  expect(dialog.getByLabelText('Opening stock')).toHaveValue(0);
  expect(dialog.getByLabelText('Opening stock')).toHaveAttribute('step', '1');
  expect(dialog.getByLabelText('Low-stock threshold')).toHaveValue(null);
  fireEvent.change(resource, { target: { value: 'custom' } });
  expect(category).toBeEnabled();
  expect(unit).toHaveValue('');
  expect(dialog.getByLabelText('Custom resource name')).toBeRequired();

  vi.mocked(api.request).mockClear();
  fireEvent.click(dialog.getByRole('button', { name: 'Remove Tents' }));
  fireEvent.click(dialog.getByRole('button', { name: 'Remove Other resource' }));
  fireEvent.change(category, { target: { value: 'FoodWater' } });
  fireEvent.change(resource, { target: { value: 'Water' } });
  fireEvent.change(unit, { target: { value: 'l' } });
  fireEvent.change(dialog.getByLabelText('Depot'), { target: { value: 'depot' } });
  fireEvent.change(dialog.getByLabelText('Opening stock'), { target: { value: '3' } });
  fireEvent.change(dialog.getByLabelText('Latitude'), { target: { value: '7.09' } });
  fireEvent.change(dialog.getByLabelText('Longitude'), { target: { value: '80' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Save resource' }));
  await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
    url: '/resources', data: expect.objectContaining({ name: 'Drinking water', category: 'FoodWater', unit: 'l', stock: 3 }),
  })));
});

it('keeps each selected resource editable and submits the remaining items in one batch', async () => {
  HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function () { this.removeAttribute('open'); };
  const data: LogisticsData = {
    countries: [{ code: 'LK', name: 'Sri Lanka' }],
    depots: [{ id: 'depot', name: 'Gampaha Centre', location: 'Gampaha', organisationId: 'org', countryCode: 'LK' }],
    inventory: [], crises: [], areas: [], actors: {}, orders: [],
    partners: [{ id: 'org', name: 'Relief organisation', countryCode: 'LK' }],
  };
  vi.mocked(get).mockImplementation(async path => path.startsWith('/logistics?') ? data :
    path === '/public/resource-units' ? [
      { code: 'l', label: 'Litres (L)', allowsFractions: true, stockCategories: ['FoodWater'] },
      { code: 'cartons', label: 'Cartons', allowsFractions: false, stockCategories: ['FoodWater'] },
      { code: 'pieces', label: 'Pieces', allowsFractions: false, stockCategories: ['FoodWater', 'Shelter'] },
    ] : []);
  vi.mocked(api.request).mockClear();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><CountryScope.Provider value="LK"><AdminLogistics specialist /></CountryScope.Provider></MemoryRouter>
  </QueryClientProvider>);

  fireEvent.click(await screen.findByRole('button', { name: 'Add resource' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Add resource' }));
  const resource = dialog.getByLabelText('Resource name');
  const stock = dialog.getByLabelText('Opening stock');
  const threshold = dialog.getByLabelText('Low-stock threshold');
  const code = dialog.getByLabelText('Resource code');
  const category = dialog.getByLabelText('Category');
  await dialog.findByRole('option', { name: 'Pieces' });
  fireEvent.change(dialog.getByLabelText('Depot'), { target: { value: 'depot' } });
  fireEvent.change(resource, { target: { value: 'Water' } });
  fireEvent.change(stock, { target: { value: '20' } });
  fireEvent.change(threshold, { target: { value: '5' } });
  fireEvent.change(code, { target: { value: 'WATER' } });
  fireEvent.change(resource, { target: { value: 'BabyFormula' } });
  fireEvent.change(stock, { target: { value: '8' } });
  fireEvent.change(resource, { target: { value: 'Cleaning' } });
  fireEvent.change(stock, { target: { value: '12' } });
  const chips = dialog.getByRole('list', { name: 'Selected resources' });
  expect(threshold.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(chips.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(chips).getByRole('button', { name: 'Cleaning supplies · 12 cartons' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(within(chips).getByRole('button', { name: 'Remove Cleaning supplies' }));

  fireEvent.change(category, { target: { value: 'Shelter' } });
  fireEvent.change(resource, { target: { value: 'Tents' } });
  fireEvent.change(stock, { target: { value: '4' } });
  fireEvent.click(within(chips).getByRole('button', { name: 'Drinking water · 20 L' }));
  expect(category).toHaveValue('FoodWater');
  expect(stock).toHaveValue(20);
  expect(threshold).toHaveValue(5);
  expect(code).toHaveValue('WATER');
  fireEvent.change(stock, { target: { value: '25' } });
  expect(within(chips).getByRole('button', { name: 'Drinking water · 25 L' })).toBeVisible();
  fireEvent.change(dialog.getByLabelText('Latitude'), { target: { value: '7.09' } });
  fireEvent.change(dialog.getByLabelText('Longitude'), { target: { value: '80' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Save 3 resources' }));

  await waitFor(() => expect(api.request).toHaveBeenCalledTimes(1));
  expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ url: '/resources/batch', data: { resources: [
    expect.objectContaining({ operationId: expect.any(String), depotId: 'depot', name: 'Drinking water', unit: 'l', stock: 25, lowStockThreshold: 5, code: 'WATER' }),
    expect.objectContaining({ operationId: expect.any(String), depotId: 'depot', name: 'Baby formula', unit: 'pieces', stock: 8, lowStockThreshold: null, code: null }),
    expect.objectContaining({ operationId: expect.any(String), depotId: 'depot', name: 'Tents', category: 'Shelter', unit: 'pieces', stock: 4 }),
  ] } }));
  expect(await screen.findByText('3 resources registered.')).toBeVisible();
});

it('filters inventory by scope and crisis and counts mixed units without summing them', async () => {
  HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function () { this.removeAttribute('open'); };
  const packs: InventoryItem = { id: 'food', name: 'Family packs', reference: 'RES-1001', code: 'FAMILY', countryCode: 'LK', organisationId: 'org',
    depotId: 'colombo', category: 'FoodWater', unit: 'packs', stock: 500, reserved: 200, available: 300,
    lowStockThreshold: 350, locationText: 'Colombo', suitability: '', transportAvailable: true };
  const water: InventoryItem = { ...packs, id: 'water', name: 'Drinking water', reference: 'RES-1002', code: 'WATER', countryCode: 'NP',
    depotId: 'kathmandu', unit: 'litres', stock: 20, reserved: 0, available: 20, lowStockThreshold: null };
  const data: LogisticsData = {
    countries: [{ code: 'LK', name: 'Sri Lanka' }, { code: 'NP', name: 'Nepal' }],
    depots: [{ id: 'colombo', name: 'Colombo depot', countryCode: 'LK', location: 'Colombo', organisationId: 'org' },
      { id: 'kathmandu', name: 'Kathmandu depot', countryCode: 'NP', location: 'Kathmandu', organisationId: 'org' }],
    inventory: [packs, water], crises: [{ id: 'flood', name: 'Flood response', countryCode: 'LK', active: true }],
    areas: [], partners: [], actors: { admin: 'Duty administrator' },
    orders: [{ id: 'dispatch', reference: 'DSP-1001', kind: 'Dispatch', status: 'Dispatched', resourceId: 'food', crisisId: 'flood',
      destinationResourceId: null, requestId: null, origin: 'Colombo depot', destination: 'Flood response',
      quantity: 200, actorId: 'admin', reason: 'Flood relief', createdAt: '2026-11-16T10:00:00Z', updatedAt: '2026-11-16T11:00:00Z' }],
  };
  vi.mocked(get).mockResolvedValue(data);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><CountryScope.Provider value="LK"><AdminLogistics /></CountryScope.Provider></MemoryRouter>
  </QueryClientProvider>);
  const inventory = within(await screen.findByRole('table', { name: 'Inventory' }));
  expect(inventory.getByRole('rowheader', { name: /Family packs.*RES-1001.*FAMILY/i })).toBeVisible();
  expect(inventory.queryByRole('rowheader', { name: /Drinking water/ })).toBeNull();
  expect(screen.getByText('300 packs left')).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: 'Inventory country' }), { target: { value: '' } });
  expect(inventory.getByRole('rowheader', { name: /Drinking water/ })).toBeVisible();
  const summary = within(screen.getByRole('list', { name: 'Logistics summary' }));
  expect(summary.getByText('Items with available stock').closest('li')).toHaveTextContent('2');
  expect(summary.queryByText('320')).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: 'Crisis' }), { target: { value: 'flood' } });
  expect(inventory.queryByRole('rowheader', { name: /Drinking water/ })).toBeNull();

  fireEvent.click(within(screen.getByRole('navigation', { name: 'Logistics views' })).getByRole('button', { name: /Dispatches/ }));
  const dispatches = within(screen.getByRole('table', { name: 'Dispatches' }));
  expect(dispatches.getByText('DSP-1001')).toBeVisible();
  expect(dispatches.getByText('In transit')).toBeVisible();
  expect(dispatches.getByText('Duty administrator')).toBeVisible();
  expect(dispatches.getByRole('button', { name: 'Confirm receipt' })).toBeEnabled();
  fireEvent.click(dispatches.getByRole('button', { name: 'Confirm receipt' }));
  const receipt = within(screen.getByRole('dialog', { name: 'Confirm receipt' }));
  fireEvent.change(receipt.getByLabelText('Delivery reference'), { target: { value: 'QA-RECEIPT' } });
  fireEvent.change(receipt.getByLabelText('Confirmed quantity (packs)'), { target: { value: '195' } });
  fireEvent.change(receipt.getByLabelText('Receiving person or representative'), { target: { value: 'Receiving officer' } });
  expect(receipt.getByLabelText('Delivery exception details')).toBeRequired();
  fireEvent.change(receipt.getByLabelText('Delivery exception details'), { target: { value: 'Five packs damaged in transit.' } });
  fireEvent.click(receipt.getByRole('button', { name: 'Confirm receipt' }));
  await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
    url: '/logistics/orders/dispatch/deliver',
    data: { delivery: { reference: 'QA-RECEIPT', confirmedQuantity: 195, receivedAt: null, receivedBy: 'Receiving officer',
      method: 'RecipientAcknowledgment', exceptionDetail: 'Five packs damaged in transit.', note: '' } },
  })));
});
