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
  useAuth: () => ({ user: { name: 'User', roles: state.roles }, logout: vi.fn() }),
  landing: () => state.roles.some((role) => role !== 'Citizen') ? '/staff' : '/app',
}));
beforeEach(() => {
  state.get.mockReset();
  state.post.mockReset();
  state.get.mockImplementation((path: string) => Promise.resolve(path === '/notifications/unread-count' ? { count: 3 } : []));
});
afterEach(cleanup);
function show() {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><AppLayout mode={state.roles.some((role) => role !== 'Citizen') ? 'staff' : 'citizen'} /></MemoryRouter></QueryClientProvider>);
}
it('shows the citizen inbox and notification bell with an unread count', async () => {
  state.roles = ['Citizen'];
  show();
  expect(screen.getAllByRole('link', { name: 'Notifications' })).toHaveLength(2);
  expect(state.get).toHaveBeenCalledWith('/notifications/unread-count');
  expect(await screen.findByText('3')).toBeInTheDocument();
});
it('shows an unread count for internal accounts including mixed roles', async () => {
  state.roles = ['Citizen', 'Logistics'];
  show();
  expect(screen.getByRole('link', { name: 'Notifications' })).toHaveAttribute('href', '/app/notifications');
  expect(await screen.findByText('3')).toBeInTheDocument();
});
it('opens citizen notifications in the citizen request view', async () => {
  state.roles = ['Citizen'];
  state.get.mockImplementation(async (path: string) => path === '/notifications' ? [{
    id: 'notification-one', requestId: 'request-one', isInternal: false,
    message: 'Your request was approved.', createdAt: '2026-11-12T04:00:00Z', read: true,
  }] : []);
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><NotificationsPage /></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Show read notifications' }));
  expect(await screen.findByRole('link', { name: 'View request' })).toHaveAttribute('href', '/app/requests/request-one');
});

it('clears the notification cards and badge while keeping read history available', async () => {
  state.roles = ['Citizen'];
  let unread = 3;
  state.get.mockImplementation(async (path: string) => {
    if (path === '/notifications/unread-count') return { count: unread };
    if (path === '/notifications?unreadOnly=true' && unread === 0) return [];
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
  const showRead = screen.getByRole('checkbox', { name: 'Show read notifications' });
  fireEvent.click(showRead);
  expect(await screen.findByText('Update one')).toBeInTheDocument();
  const button = screen.getByRole('button', { name: 'Mark all as read' });
  fireEvent.click(button);
  expect(await screen.findByText('No unread notifications')).toBeInTheDocument();
  await waitFor(() => {
    expect(state.post).toHaveBeenCalledOnce();
    expect(state.post).toHaveBeenCalledWith('/notifications/read-all', undefined, {
      params: { countryCode: 'LK' },
    });
    expect(showRead).not.toBeChecked();
    expect(screen.queryByText('Update one')).not.toBeInTheDocument();
    expect(screen.queryByText('Update two')).not.toBeInTheDocument();
    expect(screen.queryByText('3', { selector: '.notification-count' })).toBeNull();
    expect(button).toBeDisabled();
  });
  fireEvent.click(showRead);
  expect(await screen.findByText('Update one')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark as read' })).not.toBeInTheDocument();
});
