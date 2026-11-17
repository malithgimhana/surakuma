import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '../i18n';
import { api, get } from '../api';
import { CrisesPage } from '../StaffSupport';

vi.mock('../api', () => ({ get: vi.fn(), api: { request: vi.fn() } }));
afterEach(cleanup);

it('moves ended responses into the bottom list and restores the active tile when reopened', async () => {
  const crises = [
    { id: 'flood', name: 'Gampaha flood', type: 'Flood', district: 'Gampaha', active: true },
    { id: 'storm', name: 'Colombo storm', type: 'Storm', district: 'Colombo', active: false },
  ];
  vi.mocked(get).mockImplementation(async (path) => {
    if (path === '/crises') return crises.map((crisis) => ({ ...crisis }));
    if (path === '/public/lookups') return { crises: [], organisations: [] };
    return [];
  });
  vi.mocked(api.request).mockImplementation(async ({ data }) => {
    const update = data as { id: string; active: boolean };
    const crisis = crises.find(({ id }) => id === update.id)!;
    crisis.active = update.active;
    return { data: { ...crisis } };
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/admin/crises']}>
        <CrisesPage compactEndedResponses />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  const end = await screen.findByRole('button', { name: 'End response' });
  expect(screen.queryByRole('heading', { name: 'Colombo storm' })).toBeNull();
  expect(screen.getAllByRole('heading', { level: 2 }).at(-1)).toHaveTextContent('Ended responses');
  expect(within(screen.getByRole('list')).getByText('Colombo storm')).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: 'Operational areas' }));
  expect(screen.getByRole('heading', { name: 'Operational areas' })).toBeVisible();
  fireEvent.click(end);

  const reopen = await within(screen.getByRole('list')).findByRole('button', {
    name: 'Reopen response for Gampaha flood',
  });
  expect(screen.queryByRole('heading', { name: 'Gampaha flood' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Operational areas' })).toBeNull();
  expect(within(screen.getByLabelText('Crisis')).queryByRole('option')).toBeNull();

  fireEvent.click(reopen);
  expect(await screen.findByRole('heading', { name: 'Gampaha flood' })).toBeVisible();
  expect(within(screen.getByRole('list')).queryByText('Gampaha flood')).toBeNull();
  expect(
    within(screen.getByLabelText('Crisis')).getByRole('option', { name: 'Gampaha flood' }),
  ).toBeVisible();
});
