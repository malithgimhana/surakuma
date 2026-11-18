import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import '../i18n';
import AdminLogistics from '../AdminLogistics';
import { api, get } from '../api';
import { CountryScope } from '../geography';
import type { InventoryItem, LogisticsData } from '../logistics';

vi.mock('../api', () => ({ get: vi.fn(), api: { request: vi.fn().mockResolvedValue({ data: {} }) }, errorMessage: (e: Error) => e.message }));

it('filters inventory by scope and crisis and counts mixed units without summing them', async () => {
  HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function () { this.removeAttribute('open'); };
  const packs: InventoryItem = { id: 'food', name: 'Family packs', code: 'FAMILY', countryCode: 'LK', organisationId: 'org',
    depotId: 'colombo', category: 'FoodWater', unit: 'packs', stock: 500, reserved: 200, available: 300,
    lowStockThreshold: 350, locationText: 'Colombo', suitability: '', transportAvailable: true };
  const water: InventoryItem = { ...packs, id: 'water', name: 'Drinking water', code: 'WATER', countryCode: 'NP',
    depotId: 'kathmandu', unit: 'litres', stock: 20, reserved: 0, available: 20, lowStockThreshold: null };
  const data: LogisticsData = {
    countries: [{ code: 'LK', name: 'Sri Lanka' }, { code: 'NP', name: 'Nepal' }],
    depots: [{ id: 'colombo', name: 'Colombo depot', countryCode: 'LK', location: 'Colombo', organisationId: 'org' },
      { id: 'kathmandu', name: 'Kathmandu depot', countryCode: 'NP', location: 'Kathmandu', organisationId: 'org' }],
    inventory: [packs, water], crises: [{ id: 'flood', name: 'Flood response', countryCode: 'LK', active: true }],
    areas: [], partners: [], actors: { admin: 'Duty administrator' },
    orders: [{ id: 'dispatch', kind: 'Dispatch', status: 'Dispatched', resourceId: 'food', crisisId: 'flood',
      destinationResourceId: null, requestId: null, origin: 'Colombo depot', destination: 'Flood response',
      quantity: 200, actorId: 'admin', reason: 'Flood relief', createdAt: '2026-11-16T10:00:00Z', updatedAt: '2026-11-16T11:00:00Z' }],
  };
  vi.mocked(get).mockResolvedValue(data);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><CountryScope.Provider value="LK"><AdminLogistics /></CountryScope.Provider></MemoryRouter>
  </QueryClientProvider>);
  const inventory = within(await screen.findByRole('table', { name: 'Inventory' }));
  expect(inventory.getByRole('rowheader', { name: /Family packs/ })).toBeVisible();
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
