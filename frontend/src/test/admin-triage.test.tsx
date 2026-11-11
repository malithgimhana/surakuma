import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '../i18n';
import { AdminPage } from '../StaffSupport';
import { api } from '../api';

afterEach(cleanup);

vi.mock('../auth', () => ({ useOptionalAuth: () => ({user:{roles:['Administrator']}}), useAuth: () => ({ user: { id: 'admin', roles: ['Administrator'] } }) }));
vi.mock('../SystemReadiness', () => ({ SystemReadiness: () => null }));
vi.mock('../api', () => ({
  get: vi.fn((path: string) => Promise.resolve(path === '/public/lookups' ? { crises: [], organisations: [{ id: 'centre', name: 'Response centre' }] } :
    path === '/admin/users' ? [{ id: 'user1', name: 'Test Person', email: 'person@example.test', memberships: [{ id: 'membership1', role: 'CaseManager', organisationId: 'centre' }] }, { id: 'user2', name: 'Other User', email: 'other@example.test', memberships: [] }] :
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

it('filters users by name and role in the access workspace', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/admin?section=users']}><AdminPage /></MemoryRouter>
  </QueryClientProvider>);
  expect(await screen.findByText('Test Person')).toBeVisible();
  expect(screen.getByText('Other User')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'other' } });
  expect(screen.queryByText('Test Person')).not.toBeInTheDocument();
  expect(screen.getByText('Other User')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Search users'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: 'CaseManager' } });
  expect(screen.getByText('Test Person')).toBeVisible();
  expect(screen.queryByText('Other User')).not.toBeInTheDocument();
});
