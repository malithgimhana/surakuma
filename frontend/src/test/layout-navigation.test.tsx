import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '../i18n';
import { AppLayout, PublicLayout } from '../layouts';

vi.mock('../api', () => ({get: () => Promise.resolve([])}));

vi.mock('../auth', () => ({
  useAuth: () => ({ user: { name: 'Shelter staff', roles: ['ShelterAdmin'], memberships: [] }, logout: vi.fn() }),
  landing: () => '/staff',
}));

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
