import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../i18n';
import { AppLayout } from '../layouts';
import { NotificationsPage } from '../CitizenPages';

const state = vi.hoisted(() => ({ roles: ['Citizen'], get: vi.fn(), post: vi.fn() }));
vi.mock('../api', () => ({ get: state.get, api: { post: state.post } }));
vi.mock('../auth', () => ({
  useAuth: () => ({ user: { name: 'User', roles: state.roles,
    memberships: state.roles.map(role => ({ role, countryCode: 'LK', organisationId: 'org' })) }, logout: vi.fn() }),
  landing: () => state.roles.some((role) => role !== 'Citizen') ? '/staff' : '/app',
}));
beforeEach(() => {
  state.get.mockReset();
  state.post.mockReset();
  state.get.mockImplementation((path: string) => Promise.resolve(path.startsWith('/notifications/unread-count') ? { count: 3 } : []));
});
afterEach(cleanup);
function show() {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/app']}><AppLayout /></MemoryRouter></QueryClientProvider>);
}
it('shows the citizen inbox and notification bell with an unread count', async () => {
  state.roles = ['Citizen'];
  show();
  expect(screen.getAllByRole('link', { name: 'Notifications' })).toHaveLength(2);
  expect(state.get).toHaveBeenCalledWith('/notifications/unread-count?inboxRole=Citizen&countryCode=LK');
  expect(await screen.findByText('3')).toBeInTheDocument();
});
it('shows the citizen unread count when staff also hold the citizen role', async () => {
  state.roles = ['Citizen', 'Logistics'];
  show();
  expect(await screen.findByRole('link', { name: 'Notifications, 3' })).toHaveAttribute('href', '/app/notifications');
  expect(state.get).toHaveBeenCalledWith('/notifications/unread-count?inboxRole=Citizen&countryCode=LK');
});
it('opens citizen notifications in the citizen request view', async () => {
  state.roles = ['Citizen'];
  state.get.mockImplementation(async (path: string) => path === '/notifications?inboxRole=Citizen&countryCode=LK' ? [{
    id: 'notification-one', requestId: 'request-one', isInternal: false,
    message: 'Your request was approved.', createdAt: '2026-11-12T04:00:00Z', read: true,
  }] : []);
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><NotificationsPage /></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'All notifications' }));
  expect(await screen.findByRole('link', { name: 'View request' })).toHaveAttribute('href', '/app/requests/request-one');
});

it.each([
  { role: 'Administrator', mode: 'admin', path: '/admin', inbox: '/admin/notifications' },
  { role: 'CountryAdministrator', mode: 'admin', path: '/admin', inbox: '/admin/notifications' },
  { role: 'Coordinator', mode: 'staff', path: '/staff', inbox: '/app/notifications?role=Coordinator' },
  { role: 'CaseManager', mode: 'staff', path: '/staff', inbox: '/app/notifications?role=CaseManager' },
  { role: 'Logistics', mode: 'staff', path: '/staff', inbox: '/app/notifications?role=Logistics' },
  { role: 'ShelterAdmin', mode: 'staff', path: '/staff', inbox: '/app/notifications?role=ShelterAdmin' },
  { role: 'VolunteerCoordinator', mode: 'staff', path: '/staff', inbox: '/app/notifications?role=VolunteerCoordinator' },
  { role: 'Volunteer', mode: 'volunteer', path: '/volunteer', inbox: '/volunteer/notifications' },
  { role: 'Partner', mode: 'partner', path: '/partner', inbox: '/partner/notifications' },
  { role: 'FundingOfficer', mode: 'funding', path: '/funding/manage', inbox: '/funding/manage/notifications' },
  { role: 'Donor', mode: 'donor', path: '/donor', inbox: '/donor/notifications' },
] as const)('shows the unread bell and inbox link for $role', async ({ role, mode, path, inbox }) => {
  state.roles = [role];
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[path]}><AppLayout mode={mode} /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByRole('link', { name: 'Notifications, 3' })).toHaveAttribute('href', inbox);
  expect(state.get).toHaveBeenCalledWith(`/notifications/unread-count?inboxRole=${role}&countryCode=LK`);
});

it('links a system administrator notification to the organisation verification', async () => {
  state.roles = ['Administrator'];
  state.get.mockImplementation(async (path: string) => path === '/notifications?inboxRole=Administrator&countryCode=LK&unreadOnly=true' ? [{
    id: 'review-one', scopeRole: 'Administrator', scopeOrganisationId: 'partner-one', isInternal: true,
    message: 'Verification evidence was submitted.', createdAt: '2026-11-22T04:00:00Z', read: false,
  }] : []);
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/admin/notifications']}><NotificationsPage /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByRole('link', { name: 'View partner registration' }))
    .toHaveAttribute('href', '/admin?section=organisations&organisation=partner-one');
});

it('clears the notification cards and badge while keeping read history available', async () => {
  state.roles = ['Citizen'];
  let unread = 3;
  state.get.mockImplementation(async (path: string) => {
    if (path === '/notifications/unread-count?inboxRole=Citizen&countryCode=LK') return { count: unread };
    if (path.includes('unreadOnly=true') && unread === 0) return [];
    if (path.startsWith('/notifications')) return ['one', 'two'].map(id => ({
      id, requestId: id, message: `Update ${id}`, createdAt: '2026-11-12T04:00:00Z',
      read: unread === 0,
    }));
    return [];
  });
  state.post.mockImplementation(async () => { unread = 0; });
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/app/notifications']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/app/notifications" element={<NotificationsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('3', { selector: '.notification-count' })).toBeInTheDocument();
  expect(await screen.findAllByRole('button', { name: 'Mark as read' })).toHaveLength(2);
  const showRead = screen.getByRole('button', { name: 'All notifications' });
  fireEvent.click(showRead);
  expect(await screen.findByText('Update one')).toBeInTheDocument();
  const button = screen.getByRole('button', { name: 'Mark all as read' });
  fireEvent.click(button);
  expect(await screen.findByText('No unread notifications')).toBeInTheDocument();
  await waitFor(() => {
    expect(state.post).toHaveBeenCalledOnce();
    expect(state.post).toHaveBeenCalledWith('/notifications/read-all', undefined, {
      params: { countryCode: 'LK', inboxRole: 'Citizen' },
    });
    expect(showRead).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Update one')).not.toBeInTheDocument();
    expect(screen.queryByText('Update two')).not.toBeInTheDocument();
    expect(screen.queryByText('3', { selector: '.notification-count' })).toBeNull();
    expect(button).toBeDisabled();
  });
  fireEvent.click(showRead);
  expect(await screen.findByText('Update one')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark as read' })).not.toBeInTheDocument();
});
