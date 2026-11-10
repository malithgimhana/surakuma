import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '../i18n';
import { VolunteerPage } from '../StaffSupport';
import { get } from '../api';

vi.mock('../auth', () => ({ useAuth: () => ({ user: { id: 'coordinator', memberships: [] } }) }));
vi.mock('../api', () => ({
  get: vi.fn((path: string) => Promise.resolve(path.startsWith('/requests?')
    ? { items: path.includes('Gampaha') ? [{ id: 'case-1', reference: 'SK-TEST', locationText: 'Gampaha Flyover', status: 'Approved' }] : [], total: path.includes('Gampaha') ? 1 : 0, page: 1, pageSize: 20 }
    : path === '/volunteers' ? { profiles: [], tasks: [], names: {} } : { organisations: [], crises: [] })),
  api: { request: vi.fn() },
  errorMessage: () => 'Error',
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('keeps the form stable while searching and shows a selectable case by location', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><VolunteerPage /></MemoryRouter>
  </QueryClientProvider>);
  const search = await screen.findByLabelText('Search cases');
  const select = screen.getByLabelText('Case');
  await waitFor(() => expect(select).toBeEnabled());
  search.focus();
  fireEvent.change(search, { target: { value: 'Gampaha' } });
  expect(search).toHaveFocus();
  expect(screen.getByLabelText('Case')).toBe(select);
  expect(select).toBeDisabled();
  expect(screen.getByText('Searching cases…')).toBeVisible();
  await waitFor(() => expect(within(select).getByRole('option', { name: /SK-TEST.*Gampaha Flyover/ })).toBeInTheDocument());
  expect(get).toHaveBeenCalledWith('/requests?search=Gampaha&page=1');
  fireEvent.change(select, { target: { value: 'case-1' } });
  expect(select).toHaveValue('case-1');
  fireEvent.change(search, { target: { value: 'No match' } });
  expect(select).toHaveValue('');
  await screen.findByText('No selectable cases in these results. Try a more specific search.');
});
