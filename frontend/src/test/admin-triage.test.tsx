import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '../i18n';
import { AdminPage } from '../StaffSupport';
import { api } from '../api';

afterEach(cleanup);

const authState = vi.hoisted(() => ({ id: 'admin', roles: ['Administrator'] }));
afterEach(() => { authState.id = 'admin'; authState.roles = ['Administrator']; });
vi.mock('../auth', () => ({ useOptionalAuth: () => ({ user: authState }), useAuth: () => ({ user: authState }) }));
vi.mock('../SystemReadiness', () => ({ SystemReadiness: () => null }));
vi.mock('../api', () => ({
  get: vi.fn((path: string) => Promise.resolve(path.startsWith('/admin/reports') ? { generatedAt: '2026-11-13T00:00:00Z', countries: [], stock: [] } : path === '/public/lookups' ? { crises: [{ id: 'flood', name: 'Flood response' }], organisations: [{ id: 'centre', name: 'Response centre' }] } :
    path.startsWith('/admin/users?') ? (() => {
      const params = new URLSearchParams(path.split('?')[1]);
      const users = [
        { id: 'user2', name: 'Other User', email: 'other@example.test', disabled: true, memberships: [] },
        ...Array.from({ length: 9 }, (_, i) => ({
          id: `filler-${i}`, name: `Filler ${i}`, email: `filler-${i}@example.test`, memberships: [],
        })),
        {
          id: 'user1', name: 'Test Person', email: 'person@example.test',
          firstRecordedAt: '2026-11-13T00:00:00Z',
          memberships: [
            { id: 'membership1', role: 'CountryAdministrator', organisationId: 'centre', countryCode: 'LK' },
            { id: 'membership2', role: 'Partner', organisationId: 'centre', countryCode: 'LK' },
            { id: 'membership3', role: 'Coordinator', organisationId: 'centre', countryCode: 'NP', crisisId: 'flood', suspended: true },
          ],
        },
      ];
      const search = params.get('search') ?? '';
      const role = params.get('role');
      const matches = users.filter(user =>
        `${user.name} ${user.email}`.toLowerCase().includes(search.toLowerCase())
        && (!role || user.memberships.some(m => m.role === role)));
      const pageSize = Number(params.get('pageSize') ?? 25);
      const pageNumber = Number(params.get('page') ?? 1);
      const start = (pageNumber - 1) * pageSize;
      return { items: matches.slice(start, start + pageSize), total: matches.length, pageNumber, pageSize };
    })() :
    path === '/requests/triage' ? [{ id: 'request', reference: 'SK-TEST', category: 'FoodWater', description: 'Synthetic request', locationText: 'Test location', organisationId: null, requestedForSomeoneElse: false }] : [])),
  api: { request: vi.fn().mockResolvedValue({ data: {} }) },
  errorMessage: () => 'Error',
}));

it('lets an administrator inspect and assign an unassigned request', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/admin?section=cases']}><AdminPage /></MemoryRouter>
  </QueryClientProvider>);
  fireEvent.click(await screen.findByText(/SK-TEST/));
  expect(screen.getByText('Synthetic request')).toBeVisible();
  const section = screen.getByRole('heading', { name: 'Unassigned requests' }).parentElement!;
  fireEvent.change(within(section).getByLabelText('Response centre'), { target: { value: 'centre' } });
  fireEvent.click(within(section).getByRole('button', { name: 'Assign centre' }));
  await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ url: '/requests/request/reassign', data: { organisationId: 'centre' } })));
});

it('resets the staff access form manually and after a successful grant, but keeps failed entries', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/admin?section=users']}><AdminPage /></MemoryRouter>
  </QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Create staff account' }));
  const section = screen.getByRole('heading', { name: 'Create staff account or grant role' }).parentElement!;
  const form = within(section);
  const name = form.getByLabelText('Full name');
  const email = form.getByLabelText('Email');
  const password = form.getByLabelText('Initial password (new accounts only)');
  await form.findByRole('option', { name: 'Response centre' });
  fireEvent.change(name, { target: { value: 'Test Person' } });
  fireEvent.change(email, { target: { value: 'person@example.test' } });
  fireEvent.change(password, { target: { value: 'Test-password-123' } });
  expect(password).toHaveAttribute('type', 'password');
  fireEvent.click(form.getByRole('button', { name: 'Show password' }));
  expect(password).toHaveAttribute('type', 'text');
  expect(password).toHaveValue('Test-password-123');
  fireEvent.click(form.getByRole('button', { name: 'Hide password' }));
  expect(password).toHaveAttribute('type', 'password');
  fireEvent.click(form.getByRole('button', { name: 'Show password' }));
  fireEvent.change(form.getByLabelText('Role'), { target: { value: 'CaseManager' } });
  fireEvent.click(form.getByRole('button', { name: 'Reset form' }));
  expect(name).toHaveValue('');
  expect(email).toHaveValue('');
  expect(password).toHaveValue('');
  expect(password).toHaveAttribute('type', 'password');
  expect(form.getByLabelText('Role')).toHaveValue('Coordinator');

  fireEvent.change(name, { target: { value: 'Test Person' } });
  fireEvent.change(email, { target: { value: 'person@example.test' } });
  fireEvent.change(password, { target: { value: 'Test-password-123' } });
  vi.mocked(api.request).mockRejectedValueOnce(new Error('Failed'));
  fireEvent.click(form.getByRole('button', { name: 'Grant staff access' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeVisible());
  expect(name).toHaveValue('Test Person');
  expect(password).toHaveValue('Test-password-123');

  fireEvent.click(form.getByRole('button', { name: 'Grant staff access' }));
  await waitFor(() => expect(name).toHaveValue(''));
  expect(email).toHaveValue('');
  expect(password).toHaveValue('');
});

it('shows ten users per page and searches and filters users from later pages', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/admin?section=users']}><AdminPage /></MemoryRouter>
  </QueryClientProvider>);
  expect(await screen.findByText('Other User')).toBeVisible();
  expect(within(screen.getByRole('row', { name: /Other User/ })).getByText('Disabled')).toBeVisible();
  expect(screen.getAllByRole('row')).toHaveLength(11);
  expect(screen.queryByText('Test Person')).not.toBeInTheDocument();
  const pages = screen.getByRole('group', { name: 'User pages' });
  expect(within(pages).getByText('Page 1 of 2')).toBeVisible();
  fireEvent.click(within(pages).getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Test Person')).toBeVisible();
  const account = within(screen.getByRole('row', { name: /Test Person/ }));
  expect(account.getByText('person@example.test')).toBeVisible();
  expect(account.getByText('Some roles suspended')).toBeVisible();
  expect(account.getByText('Response centre · LK · Country scope')).toBeVisible();
  expect(account.getByText('Response centre · NP · Crisis: Flood response')).toBeVisible();
  expect(account.getByText('First recorded')).toBeVisible();
  expect(screen.getByText('Page 2 of 2')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'person@example.test' } });
  expect(await screen.findByText(/Showing 1 of 1 matching users/)).toBeVisible();
  expect(screen.getByText('Test Person')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Search users'), { target: { value: '' } });
  expect(await screen.findByText('Page 1 of 2')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: 'CountryAdministrator' } });
  expect(await screen.findByText('Test Person')).toBeVisible();
  expect(screen.queryByText('Other User')).not.toBeInTheDocument();
});

it('does not show Revoke on the signed-in country administrator’s row', async () => {
  authState.id = 'user1';
  authState.roles = ['CountryAdministrator'];
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/admin?section=users']}><AdminPage /></MemoryRouter>
  </QueryClientProvider>);
  fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: 'CountryAdministrator' } });
  const row = await screen.findByRole('row', { name: /Test Person/ });
  fireEvent.click(within(row).getByRole('button', { name: 'Actions for Test Person' }));
  expect(screen.queryByRole('button', { name: /Revoke/ })).not.toBeInTheDocument();
});
