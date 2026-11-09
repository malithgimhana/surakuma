import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '../i18n';
import { AdminPage } from '../StaffSupport';
import { api } from '../api';

vi.mock('../auth', () => ({ useAuth: () => ({ user: { id: 'admin', roles: ['Administrator'] } }) }));
vi.mock('../SystemReadiness', () => ({ SystemReadiness: () => null }));
vi.mock('../api', () => ({
  get: vi.fn((path: string) => Promise.resolve(path === '/public/lookups' ? { crises: [], organisations: [{ id: 'centre', name: 'Response centre' }] } :
    path === '/requests/triage' ? [{ id: 'request', reference: 'SK-TEST', category: 'FoodWater', description: 'Synthetic request', locationText: 'Test location', organisationId: null, requestedForSomeoneElse: false }] : [])),
  api: { request: vi.fn().mockResolvedValue({ data: {} }) },
  errorMessage: () => 'Error',
}));

it('lets an administrator inspect and assign an unassigned request', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><AdminPage /></MemoryRouter>
  </QueryClientProvider>);
  fireEvent.click(await screen.findByText(/SK-TEST/));
  expect(screen.getByText('Synthetic request')).toBeVisible();
  const section = screen.getByRole('heading', { name: 'Unassigned requests' }).parentElement!;
  fireEvent.change(within(section).getByLabelText('Response centre'), { target: { value: 'centre' } });
  fireEvent.click(within(section).getByRole('button', { name: 'Assign centre' }));
  await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ url: '/requests/request/reassign', data: { organisationId: 'centre' } })));
});
