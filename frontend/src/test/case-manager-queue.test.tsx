import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import '../i18n';
import { CaseQueue } from '../StaffPages';
import { get } from '../api';

vi.mock('../auth', () => ({ useAuth: () => ({ user: { id: 'case', roles: ['CaseManager'] } }) }));
vi.mock('../MapView', () => ({ MapView: () => null }));
vi.mock('../api', () => ({
  get: vi.fn((path: string) => {
    if (path.includes('staff/overview'))
      return Promise.resolve({
        hasAccess: true,
        metrics: { assigned: 23, critical: 4, verification: 3, ai: 5, followUps: 2 },
        regions: [{ id: 'region', name: 'Colombo', levelName: 'District' }],
      });
    const params = new URLSearchParams(path.split('?')[1]);
    const page = Number(params.get('page'));
    return Promise.resolve({
      items: [
        {
          id: 'water-' + page,
          reference: 'SK-WATER-' + page,
          category: 'FoodWater',
          status: 'UnderReview',
          priority: 'High',
          quantity: 20,
          deliveredQuantity: 0,
          householdSize: 4,
          description: 'Clarify litres or bottles.',
          createdAt: '2026-11-03T12:00:00Z',
          unit: null,
          unitRequiresClarification: true,
        },
      ],
      total: 23,
      pageNumber: page,
      pageSize: 20,
    });
  }),
  api: { request: vi.fn() },
  errorMessage: () => 'Error',
}));

function RouteState() {
  return <output aria-label="URL filters">{useLocation().search}</output>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('loads queue counts, warns about unknown units, and saves pagination and filters in the URL', async () => {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/staff/cases?view=verification']}>
        <CaseQueue />
        <RouteState />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('link', { name: 'Needs verification (3)' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(screen.getByText('Unit requires clarification')).toBeVisible();
  expect(screen.getByText('Awaiting clarification')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('SK-WATER-2')).toBeVisible();
  expect(screen.getByRole('status', { name: 'URL filters' })).toHaveTextContent('page=2');
  fireEvent.change(screen.getByLabelText('Administrative region'), { target: { value: 'region' } });
  fireEvent.change(screen.getByLabelText('Assistance category'), {
    target: { value: 'FoodWater' },
  });
  fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'High' } });
  await waitFor(() =>
    expect(vi.mocked(get)).toHaveBeenLastCalledWith(
      '/requests?staffRole=CaseManager&assignedToMe=true&page=1&view=verification&category=FoodWater&priority=High&regionId=region',
    ),
  );
  expect(screen.getByRole('status', { name: 'URL filters' })).not.toHaveTextContent('page=');
  expect(screen.getByRole('link', { name: 'Manage assignment availability' })).toHaveAttribute(
    'href',
    '/app/profile?role=CaseManager',
  );
});
