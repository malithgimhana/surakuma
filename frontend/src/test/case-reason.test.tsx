import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../i18n';
import { CaseDetails } from '../StaffPages';
import { api } from '../api';
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: ['CaseManager'] } }) }));
vi.mock('../MapView', () => ({ MapView: () => null }));
vi.mock('../api', () => ({
  get: vi.fn((path: string) => Promise.resolve(path === '/public/lookups' ? { crises: [], organisations: [] } : path.endsWith('/recommendations') ? { recommendations: [], decisions: [], duplicates: [] } : { request: { id: 'case', status: 'Submitted', category: 'FoodWater', priority: 'High', quantity: 2, deliveredQuantity: 0, householdSize: 1, description: 'Test request', organisationId: 'org' }, history: [], allocations: [], placements: [], attachments: [] })),
  api: { request: vi.fn().mockResolvedValue({ data: {} }) },
  errorMessage: () => 'Error',
}));
it('clears a saved case note so the next action cannot resend it', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/staff/cases/case']}><Routes><Route path="/staff/cases/:id" element={<CaseDetails />} /></Routes></MemoryRouter></QueryClientProvider>);
  const note = await screen.findByLabelText('Reason / case note');
  fireEvent.change(note, { target: { value: 'It has children also' } });
  fireEvent.click(screen.getByRole('button', { name: 'Begin review' }));
  await waitFor(() => expect(note).toHaveValue(''));
  expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'UnderReview', reason: 'It has children also' } }));
});
