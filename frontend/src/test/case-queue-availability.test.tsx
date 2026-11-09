import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '../i18n';
import { CaseQueue } from '../StaffPages';

vi.mock('../auth', () => ({ useAuth: () => ({ user: { id: 'case', roles: ['CaseManager'] } }) }));
vi.mock('../MapView', () => ({ MapView: () => null }));
vi.mock('../api', () => ({
  get: vi.fn((path: string) => Promise.resolve(path === '/public/lookups' ? {
    crises: [], organisations: [{ id: 'one', name: 'Northern centre' }, { id: 'two', name: 'Southern centre' }],
  } : path === '/case-manager/availability' ? [
    { id: 'm1', organisationId: 'one', availableForAssignment: true },
    { id: 'm2', organisationId: 'two', availableForAssignment: false },
  ] : { items: [], total: 0, pageNumber: 1, pageSize: 20 })),
  api: { request: vi.fn() },
  errorMessage: () => 'Error',
}));

it('identifies which centre each availability switch controls', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><CaseQueue /></MemoryRouter>
  </QueryClientProvider>);
  expect(await screen.findByRole('checkbox', { name: /Available for automatic assignments · Northern centre/ })).toBeChecked();
  expect(await screen.findByRole('checkbox', { name: /Available for automatic assignments · Southern centre/ })).not.toBeChecked();
});
