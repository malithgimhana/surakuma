import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
import '../i18n';
import { AppLayout, PublicLayout } from '../layouts';

vi.mock('../api', () => ({get: () => Promise.resolve([])}));

vi.mock('../auth', () => ({
  useAuth: () => ({ user: { name: 'Shelter staff', roles: ['ShelterAdmin'], memberships: [] }, logout: vi.fn() }),
  landing: () => '/staff',
}));

afterEach(cleanup);

it('provides the workspace link inside the public mobile menu', () => {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><Routes><Route element={<PublicLayout />}><Route index element={<p>Home</p>} /></Route></Routes></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
  expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getAllByRole('link', { name: 'Workspace' }).some((link) => link.getAttribute('href') === '/staff')).toBe(true);
});

it('keeps staff navigation on the shared notifications page', () => {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/app/notifications']}><Routes><Route path="/app" element={<AppLayout />}><Route path="notifications" element={<p>Notifications content</p>} /></Route></Routes></MemoryRouter></QueryClientProvider>);
  expect(screen.getByRole('link', { name: 'Shelter management' })).toHaveAttribute('href', '/staff/shelters');
  expect(screen.queryByRole('link', { name: 'My requests' })).not.toBeInTheDocument();
});

it('uses Back for workspace history and Home for the public homepage', async () => {
  const originalUrl = window.location.href;
  const originalState = window.history.state;
  window.history.replaceState(null, '', '/staff/shelters');
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<p>Public homepage</p>} />
          <Route path="/staff" element={<AppLayout mode="staff" />}>
            <Route index element={<p>Staff overview</p>} />
            <Route path="shelters" element={<p>Shelter list</p>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>,
  );
  try {
    const navigation = () => within(screen.getByRole('navigation', { name: 'Page navigation' }));
    expect(screen.getByText('Shelter list')).toBeVisible();
    fireEvent.click(navigation().getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Staff overview')).toBeVisible();
    expect(navigation().getByRole('button', { name: 'Back' })).toBeDisabled();
    fireEvent.click(screen.getByRole('link', { name: 'Shelter management' }));
    expect(await screen.findByText('Shelter list')).toBeVisible();
    fireEvent.click(navigation().getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Staff overview')).toBeVisible();
    fireEvent.click(navigation().getByRole('link', { name: 'Home' }));
    expect(await screen.findByText('Public homepage')).toBeVisible();
  } finally {
    view.unmount();
    window.history.replaceState(originalState, '', originalUrl);
  }
});
