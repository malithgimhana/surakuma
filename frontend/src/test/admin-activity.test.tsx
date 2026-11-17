import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '../i18n';
import { AdminPage } from '../StaffSupport';
import { get } from '../api';

vi.mock('../api', () => ({ get: vi.fn(), api: { request: vi.fn() }, errorMessage: () => 'Error' }));
vi.mock('../SystemReadiness', () => ({ SystemReadiness: () => null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.removeItem('surakuma.country');
});

function open() {
  vi.mocked(get).mockImplementation(async (path) => {
    const query = new URLSearchParams(path.split('?')[1]);
    const pageNumber = Number(query.get('page') ?? 1);
    const country = query.get('countryCode');
    if (path === '/countries')
      return [
        { code: 'LK', name: 'Sri Lanka' },
        { code: 'IN', name: 'India' },
        { code: 'NP', name: 'Nepal' },
      ];
    if (path.startsWith('/admin/audit?')) {
      const event = {
        id: 'audit',
        action: pageNumber === 1 ? 'Login' : 'CaseManagerAssigned',
        actorId: 'actor-123',
        actorName: 'System Administrator',
        entityType: 'Case',
        entityId: 'test-case',
        detail: 'Synthetic audit',
        createdAt: '2026-11-10T10:00:00Z',
        countryCode: country || 'NP',
      };
      return {
        items: [event],
        total: 11,
        pageNumber,
        pageSize: 10,
        summary: { eventsToday: 1, highRiskToday: 0 },
      };
    }
    if (path.startsWith('/admin/deliveries?')) {
      const failed = query.get('state') === 'Failed';
      return {
        items: [
          {
            id: 'delivery',
            state: failed ? 'Failed' : 'Sent',
            createdAt: '2026-11-10T10:00:00Z',
            attempts: 1,
            eventMessage: failed ? 'Synthetic failed email' : 'Your case was approved',
            recipientName: 'Test Person',
            caseReference: 'SK-TEST',
            provider: 'Brevo',
            inAppStored: true,
          },
        ],
        total: 1,
        pageNumber,
        pageSize: 10,
        summary: { failed: 1, recovered: 0, retrying: 0, causes: [] },
      };
    }
    return [];
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/admin?section=activity']}>
        <AdminPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('keeps the two histories distinct and pages the selected view', async () => {
  open();
  const login = await screen.findByText('Successful sign-in', { selector: 'strong' });
  const entry = within(login.closest('article')!);
  expect(entry.getByText('System Administrator')).toBeVisible();
  expect(entry.getByRole('time')).toHaveAttribute('datetime', '2026-11-10T10:00:00Z');
  expect(await screen.findByText('Accepted', { selector: '.badge' })).toBeVisible();
  expect(screen.getByText('Brevo · Email · Test Person')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'View all events' }));
  expect(screen.queryByRole('heading', { name: 'Notification delivery' })).not.toBeInTheDocument();
  const pages = () => within(screen.getByRole('group', { name: 'Audit event pages' }));
  expect(pages().getByRole('button', { name: 'Previous' })).toBeDisabled();
  fireEvent.click(pages().getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Case manager assigned', { selector: 'strong' })).toBeVisible();
  expect(pages().getByText('Page 2 of 2')).toBeVisible();
  expect(pages().getByRole('button', { name: 'Next' })).toBeDisabled();
});

it('filters deliveries before paging and keeps All countries explicit in API requests', async () => {
  open();
  expect(await screen.findByText('Accepted', { selector: '.badge' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'View all deliveries' }));
  expect(screen.queryByLabelText('Event type')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Filter by country'), { target: { value: '' } });
  fireEvent.change(screen.getAllByLabelText('Delivery state')[0], { target: { value: 'Failed' } });
  expect(
    await screen.findByText('Synthetic failed email', { selector: '.admin-tab-excerpt' }),
  ).toBeVisible();
  expect(screen.queryByText('Accepted', { selector: '.badge' })).not.toBeInTheDocument();
  const sent = vi
    .mocked(get)
    .mock.calls.map(([path]) => path)
    .find((path) => path.startsWith('/admin/deliveries?') && path.includes('state=Failed'))!;
  const query = new URLSearchParams(sent.split('?')[1]);
  expect(query.has('countryCode')).toBe(true);
  expect(query.get('countryCode')).toBe('');
});
