import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '../i18n';
import { CaseQueue } from '../StaffPages';

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

it('shows closed cases with reported problems in the follow-up queue', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><CaseQueue /></MemoryRouter>
  </QueryClientProvider>);
  expect(await screen.findByRole('link', { name: 'SK-FOLLOWUP' })).toHaveAttribute('href', '/staff/cases/closed-case');
  expect(screen.getByText(/Includes problems reported after a case was completed/)).toBeVisible();
});
