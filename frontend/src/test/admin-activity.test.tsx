import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '../i18n';
import { AdminPage } from '../StaffSupport';
import { get } from '../api';

vi.mock('../SystemReadiness', () => ({ SystemReadiness: () => null }));
vi.mock('../api', () => ({
  get: vi.fn((path: string) => Promise.resolve(path === '/admin/audit?page=1&pageSize=10&includeTotal=true'
    ? { items: Array.from({ length: 10 }, (_, i) => ({ id: `audit-${i}`, action: `Event ${i}`, actorId: 'actor-123', detail: '', createdAt: '2026-11-10T10:00:00Z' })), total: 11, pageNumber: 1, pageSize: 10 }
    : path === '/admin/audit?page=2&pageSize=10&includeTotal=true' ? { items: [{ id: 'next', action: 'Older event', actorId: 'actor-456', detail: '', createdAt: '2026-11-09T10:00:00Z' }], total: 11, pageNumber: 2, pageSize: 10 }
    : path === '/admin/deliveries?page=1&pageSize=10&includeTotal=true' ? { items: Array.from({ length: 10 }, (_, i) => ({ id: `delivery-${i}`, state: 'Sent', attempts: 1, createdAt: '2026-11-10T10:00:00Z', eventMessage: i === 0 ? 'Your case was approved' : `Delivery ${i}`, recipientName: 'Test Person', caseReference: 'SK-TEST', provider: 'Brevo', lastError: null })), total: 11, pageNumber: 1, pageSize: 10 }
    : path === '/admin/deliveries?page=2&pageSize=10&includeTotal=true' ? { items: [{ id: 'older-delivery', state: 'Captured', attempts: 1, createdAt: '2026-11-09T10:00:00Z', eventMessage: 'Older notification', recipientName: 'Other Person', caseReference: 'SK-OLDER', provider: 'Capture', lastError: null }], total: 11, pageNumber: 2, pageSize: 10 }
    : path === '/public/lookups' ? { crises: [], organisations: [] } : [])),
  api: { request: vi.fn() }, errorMessage: () => 'Error',
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('pages through audit events and explains the notification event', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/admin?section=activity']}><AdminPage /></MemoryRouter>
  </QueryClientProvider>);
  expect(await screen.findByText('Event 0')).toBeVisible();
  expect(screen.getByText('Your case was approved')).toBeVisible();
  expect(screen.getAllByText(/Test Person.*SK-TEST.*Brevo/)).toHaveLength(10);
  expect(screen.getAllByText(/delivered language may differ/)).toHaveLength(10);
  const auditPages = () => within(screen.getByRole('group', { name: 'Audit event pages' }));
  const deliveryPages = () => within(screen.getByRole('group', { name: 'Notification delivery pages' }));
  expect(auditPages().getByRole('button', { name: 'Previous' })).toBeDisabled();
  expect(deliveryPages().getByRole('button', { name: 'Previous' })).toBeDisabled();
  fireEvent.click(deliveryPages().getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Older notification')).toBeVisible();
  expect(deliveryPages().getByText('Page 2 of 2')).toBeVisible();
  expect(auditPages().getByText('Page 1 of 2')).toBeVisible();
  expect(deliveryPages().getByRole('button', { name: 'Next' })).toBeDisabled();
  fireEvent.click(auditPages().getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Older event')).toBeVisible();
  expect(auditPages().getByText('Page 2 of 2')).toBeVisible();
  expect(auditPages().getByRole('button', { name: 'Next' })).toBeDisabled();
  fireEvent.click(auditPages().getByRole('button', { name: 'Previous' }));
  await waitFor(() => expect(screen.getByText('Event 0')).toBeVisible());
  expect(get).toHaveBeenCalledWith('/admin/audit?page=2&pageSize=10&includeTotal=true');
  fireEvent.click(deliveryPages().getByRole('button', { name: 'Previous' }));
  expect(await screen.findByText('Your case was approved')).toBeVisible();
  expect(get).toHaveBeenCalledWith('/admin/deliveries?page=2&pageSize=10&includeTotal=true');
});

it('handles an exact full page and an empty history without offering another page', async () => {
  vi.mocked(get).mockImplementation((path: string) => Promise.resolve(path.startsWith('/admin/audit?')
    ? { items: Array.from({ length: 10 }, (_, i) => ({ id: `audit-${i}`, action: `Exact ${i}`, actorId: 'actor-123', detail: '', createdAt: '2026-11-10T10:00:00Z' })), total: 10, pageNumber: 1, pageSize: 10 }
    : path.startsWith('/admin/deliveries?') ? { items: [], total: 0, pageNumber: 1, pageSize: 10 }
    : path === '/public/lookups' ? { crises: [], organisations: [] } : []));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/admin?section=activity']}><AdminPage /></MemoryRouter>
  </QueryClientProvider>);
  expect(await screen.findByText('Exact 0')).toBeVisible();
  expect(await screen.findByText('No delivery events on this page.')).toBeVisible();
  for (const name of ['Audit event pages', 'Notification delivery pages']) {
    const pages = within(screen.getByRole('group', { name }));
    expect(pages.getByText('Page 1 of 1')).toBeVisible();
    expect(pages.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(pages.getByRole('button', { name: 'Next' })).toBeDisabled();
  }
});
