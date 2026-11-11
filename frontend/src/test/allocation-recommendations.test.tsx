import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../i18n';
import { CaseDetails } from '../StaffPages';
import { api } from '../api';

vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: ['Logistics'] } }) }));
vi.mock('../MapView', () => ({ MapView: () => null }));
vi.mock('../api', () => ({
  get: vi.fn((path: string) => {
    if (path === '/public/lookups') return Promise.resolve({ crises: [], organisations: [] });
    if (path.endsWith('/resources')) return Promise.resolve([{ id: 'one', name: 'First packs', category: 'FoodWater', unit: 'packs', available: 4, locationText: 'Depot' }, { id: 'two', name: 'Alternative packs', category: 'FoodWater', unit: 'packs', available: 8, locationText: 'Depot' }]);
    if (path.endsWith('/allocation-recommendations')) return Promise.resolve({ outstanding: 10, shortage: true, queuePosition: 2, competingRequests: 3, shortageExplanation: 'Potential shortage: escalate for review.', candidates: [{ resourceId: 'one', name: 'First packs', unit: 'packs', available: 4, suggestedQuantity: 4, score: 70, transportAvailable: true, shortForRequest: true, reason: 'First candidate rationale' }, { resourceId: 'two', name: 'Alternative packs', unit: 'packs', available: 8, suggestedQuantity: 8, score: 60, transportAvailable: true, shortForRequest: true, reason: 'Alternative rationale' }] });
    return Promise.resolve({ request: { id: 'case', status: 'Approved', category: 'FoodWater', priority: 'High', quantity: 10, deliveredQuantity: 0, householdSize: 1, description: 'Test request', organisationId: 'org' }, history: [], allocations: [], placements: [], attachments: [] });
  }),
  api: { request: vi.fn().mockResolvedValue({ data: {} }) },
  errorMessage: () => 'Error',
}));

it('explains shortage and records when staff reserve the alternative', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/staff/cases/case']}><Routes><Route path="/staff/cases/:id" element={<CaseDetails />} /></Routes></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText(/Next-best alternative: Alternative packs/)).toBeVisible();
  expect(screen.getByText(/Queue position: 2 of 3/)).toBeVisible();
  fireEvent.click(screen.getAllByRole('button', { name: 'Choose for review' })[1]);
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Approve reservation' }));
  await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ url: '/allocations', data: { requestId: 'case', resourceId: 'two', quantity: 2, recommendedResourceId: 'one' } })));
});
