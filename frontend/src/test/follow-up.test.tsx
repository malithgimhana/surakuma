import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '../i18n';
import { CaseDetails, CaseQueue } from '../StaffPages';
import { get } from '../api';

vi.mock('../auth', () => ({ useAuth: () => ({ user: { id: 'case', roles: ['CaseManager'] } }) }));
vi.mock('../MapView', () => ({ MapView: () => null }));
vi.mock('../api', () => ({
  get: vi.fn((path: string) => Promise.resolve(path === '/requests/escalated'
    ? [{ id: 'closed-case', reference: 'SK-FOLLOWUP', category: 'FoodWater', status: 'Closed' }]
    : path === '/public/lookups' ? { crises: [], organisations: [] }
      : path === '/case-manager/availability' ? [] : { items: [], total: 0, pageNumber: 1, pageSize: 20 })),
  api: { request: vi.fn() },
  errorMessage: () => 'Error',
}));
const defaultGet = vi.mocked(get).getMockImplementation()!;
afterEach(() => {
  cleanup();
  vi.mocked(get).mockImplementation(defaultGet);
});

it('shows closed cases with reported problems in the follow-up queue', async () => {
  vi.mocked(get).mockImplementation(path => path.startsWith('/requests?') && path.includes('view=follow-ups')
    ? Promise.resolve({ items: [{ id: 'closed-case', reference: 'SK-FOLLOWUP', category: 'FoodWater',
      status: 'Closed', priority: 'Normal', householdSize: 2, quantity: 4, deliveredQuantity: 4, unit: 'packs', escalated: true,
      createdAt: '2026-11-03T12:00:00Z' }],
      total: 1, pageNumber: 1, pageSize: 20 }) : defaultGet(path));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/staff/cases?view=follow-ups']}><CaseQueue /></MemoryRouter>
  </QueryClientProvider>);
  expect(await screen.findByRole('link', { name: 'Review case SK-FOLLOWUP' })).toHaveAttribute('href', '/staff/cases/closed-case');
  expect(screen.getByText(/including after delivery or case closure/)).toBeVisible();
});

it('shows the requested amount and the citizen’s specific need from the queue through case details', async () => {
  const request = {
    id: 'water', reference: 'SK-WATER', category: 'FoodWater', status: 'PartiallyFulfilled', priority: 'High',
    quantity: 20, unit: 'l', deliveredQuantity: 15, householdSize: 4, organisationId: 'org',
    description: 'We need drinking water for four people.', createdAt: '2026-11-03T12:00:00Z',
  };
  vi.mocked(get).mockImplementation(path => {
    if (path.startsWith('/requests?')) return Promise.resolve({ items: [request], total: 1, pageNumber: 1, pageSize: 20 });
    if (path === '/requests/water') return Promise.resolve({ request, allocations: [], placements: [], attachments: [],
      history: [{ id: 'recorded-review', status: 'UnderReview', createdAt: '2026-11-03T13:00:00Z', note: 'Reviewed intake.', actorId: 'case' }] });
    if (path === '/requests/water/recommendations') return Promise.resolve({ recommendations: [], decisions: [], duplicates: [] });
    return defaultGet(path);
  });

  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/staff/cases']}>
      <Routes>
        <Route path="/staff/cases" element={<CaseQueue />} />
        <Route path="/staff/cases/:id" element={<CaseDetails />} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>);

  const row = await screen.findByRole('row', { name: /SK-WATER/ });
  expect(screen.getByRole('columnheader', { name: 'Requested assistance' })).toBeVisible();
  expect(within(row).getByText('20 L')).toBeVisible();
  expect(row).toHaveTextContent(request.description);
  expect(within(row).getByText('5 L')).toBeVisible();
  fireEvent.click(within(row).getByRole('link', { name: 'Review case SK-WATER' }));

  expect(await screen.findByText('Quantity required')).toBeVisible();
  expect(screen.getAllByText('20 L', { exact: true })).toHaveLength(2);
  expect(screen.getByText('Citizen’s description')).toBeVisible();
  expect(screen.getByText(request.description)).toBeVisible();
  expect(screen.getAllByText('15 L', { exact: true })).toHaveLength(2);
  expect(screen.getByRole('progressbar', { name: 'Fulfilment progress' })).toHaveValue(75);
  const lifecycle = screen.getByRole('list', { name: 'Case lifecycle' });
  expect(within(lifecycle).getByText('Verified').closest('li')).toHaveAttribute('data-recorded', 'false');
  expect(within(lifecycle).getByText('Under review').closest('li')).toHaveAttribute('data-recorded', 'true');
  expect(screen.getByText('Reviewed intake.')).toBeVisible();
  expect(screen.queryByRole('button', { name: /reserve|allocate/i })).toBeNull();
});
