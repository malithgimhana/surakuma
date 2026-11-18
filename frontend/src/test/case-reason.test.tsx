import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../i18n';
import { CaseDetails } from '../StaffPages';
import { api, get } from '../api';
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: ['CaseManager'] } }) }));
vi.mock('../MapView', () => ({ MapView: () => null }));
vi.mock('../api', () => ({
  get: vi.fn((path: string) => Promise.resolve(path === '/public/lookups' ? { crises: [], organisations: [] } : path.endsWith('/recommendations') ? { recommendations: [], decisions: [], duplicates: [] } : { request: { id: 'case', status: 'Submitted', category: 'FoodWater', priority: 'High', quantity: 2, deliveredQuantity: 0, householdSize: 1, description: 'Test request', organisationId: 'org' }, history: [], allocations: [], placements: [], attachments: [] })),
  api: { request: vi.fn().mockResolvedValue({ data: {} }) },
  errorMessage: () => 'Error',
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('clears a saved case note so the next action cannot resend it', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/staff/cases/case']}><Routes><Route path="/staff/cases/:id" element={<CaseDetails />} /></Routes></MemoryRouter></QueryClientProvider>);
  const note = await screen.findByLabelText('Reason / case note');
  fireEvent.change(note, { target: { value: 'It has children also' } });
  fireEvent.click(screen.getByRole('button', { name: 'Begin review' }));
  await waitFor(() => expect(note).toHaveValue(''));
  expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'UnderReview', reason: 'It has children also' } }));
});

it('starts each AI modification at the recommendation and requires a human explanation', async () => {
  const original = vi.mocked(get).getMockImplementation()!;
  vi.mocked(get).mockImplementation((path) => path.endsWith('/recommendations')
    ? Promise.resolve({ recommendations: [{ id: 'low', priority: 'Low', category: 'FoodWater', explanation: 'Lower priority', confidence: null,
      confidenceKind: 'Unavailable', reviewState: 'Pending' }], decisions: [], duplicates: [] })
    : original(path));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/staff/cases/case']}>
    <Routes><Route path="/staff/cases/:id" element={<CaseDetails />} /></Routes>
  </MemoryRouter></QueryClientProvider>);
  const priority = await screen.findByLabelText('Final priority for modification');
  expect(priority).toHaveValue('Low');
  expect(screen.getByText('Current priority')).toHaveTextContent('High');
  expect(screen.getByText('AI recommendation')).toHaveTextContent('Low');
  const modify = screen.getByRole('button', { name: 'Modify' });
  expect(modify).toBeDisabled();
  fireEvent.change(priority, { target: { value: 'Normal' } });
  expect(modify).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Decision / override reason'), { target: { value: 'Verified household circumstances.' } });
  fireEvent.click(modify);
  await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
    url: '/requests/case/decisions',
    data: { recommendationId: 'low', action: 'Modify', finalPriority: 'Normal', finalCategory: 'FoodWater', reason: 'Verified household circumstances.' },
  })));
});
