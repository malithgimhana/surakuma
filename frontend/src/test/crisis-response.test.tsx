import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '../i18n';
import { api, get } from '../api';
import { CountryScope } from '../geography';
import CrisisOperationsPage from '../CrisisOperationsPage';

vi.mock('../api', () => ({ get: vi.fn(), api: { request: vi.fn() }, errorMessage: String }));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(cleanup);

const policies = [
  { code: 'LK', name: 'Sri Lanka', languages: 'en,si,ta', requiredAlertLanguages: 'en,si,ta' },
  { code: 'IN', name: 'India', languages: 'en,hi,ta', requiredAlertLanguages: 'en,hi' },
  { code: 'NP', name: 'Nepal', languages: 'en,ne', requiredAlertLanguages: 'en,ne' },
];
const updatedAt = '2026-11-17T08:00:00Z';
function renderDashboard(country: string) {
  return (
    <MemoryRouter initialEntries={['/admin/crises']}>
      <CountryScope.Provider value={country}>
        <CrisisOperationsPage />
      </CountryScope.Provider>
    </MemoryRouter>
  );
}

it('moves ended responses into the bottom list and restores the active tile when reopened', async () => {
  const crises = [
    {
      id: 'flood',
      name: 'Gampaha flood',
      type: 'Flood',
      district: 'Gampaha',
      active: true,
      updatedAt,
    },
    {
      id: 'storm',
      name: 'Colombo storm',
      type: 'Storm',
      district: 'Colombo',
      active: false,
      updatedAt,
    },
  ];
  vi.mocked(get).mockImplementation(async (path) => {
    if (path === '/crises?countryCode=LK') return crises.map((crisis) => ({ ...crisis }));
    if (path === '/countries') return policies;
    if (path.startsWith('/public/lookups')) return { crises: [], organisations: [] };
    if (path.startsWith('/admin/crisis-operations/alerts'))
      return { items: [], total: 0, publishedCount: 0 };
    if (path.includes('/snapshot'))
      return { activeShelters: 0, shelteredPeople: 0, lastUpdated: updatedAt };
    return [];
  });
  vi.mocked(api.request).mockImplementation(async ({ data, url }) => {
    const update = data as { active: boolean };
    const crisis = crises.find(({ id }) => url?.includes(`/${id}/response-status?countryCode=LK`))!;
    crisis.active = update.active;
    return { data: { ...crisis } };
  });

  render(
    <QueryClientProvider client={new QueryClient()}>{renderDashboard('LK')}</QueryClientProvider>,
  );

  const end = await screen.findByRole('button', { name: 'End response' });
  expect(screen.queryByRole('heading', { name: 'Colombo storm' })).toBeNull();
  expect(screen.getAllByRole('heading', { level: 2 }).at(-1)).toHaveTextContent('Ended responses');
  expect(within(screen.getByRole('list')).getByText('Colombo storm')).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: 'Operational areas' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close dialog' }));
  fireEvent.click(end);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'End response' }));

  const reopen = await within(screen.getByRole('list')).findByRole('button', {
    name: 'Reopen response for Gampaha flood',
  });
  expect(screen.queryByRole('heading', { name: 'Gampaha flood' })).toBeNull();
  expect(screen.getByLabelText('Crisis')).toBeDisabled();

  fireEvent.click(reopen);
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Reopen response' }),
  );
  expect(await screen.findByRole('heading', { name: 'Gampaha flood' })).toBeVisible();
  expect(within(screen.getByRole('list')).queryByText('Gampaha flood')).toBeNull();
  expect(
    within(screen.getByLabelText('Crisis')).getByRole('option', { name: 'Gampaha flood' }),
  ).toBeVisible();
});

it('loads country-scoped responses and language policies while retaining each country’s unfinished alert', async () => {
  vi.mocked(get).mockImplementation(async (path) => {
    if (path === '/countries') return policies;
    const country = new URLSearchParams(path.split('?')[1]).get('countryCode');
    if (path.startsWith('/crises?'))
      return [{ id: country, name: `${country} response`, active: true, updatedAt }];
    if (path.startsWith('/public/lookups'))
      return { organisations: [{ id: country, name: `${country} centre` }] };
    if (path.startsWith('/admin/crisis-operations/alerts'))
      return { items: [], total: 0, publishedCount: 0 };
    if (path.includes('/snapshot'))
      return { activeShelters: 0, shelteredPeople: 0, lastUpdated: updatedAt };
    return [{ id: country, name: `${country} area`, updatedAt }];
  });
  const client = new QueryClient();
  const dashboard = (country: string) => (
    <QueryClientProvider client={client}>{renderDashboard(country)}</QueryClientProvider>
  );
  const { rerender } = render(dashboard('LK'));
  expect(await screen.findByRole('heading', { name: 'LK response' })).toBeVisible();
  fireEvent.change(screen.getByLabelText('English title'), {
    target: { value: 'Sri Lanka draft' },
  });

  rerender(dashboard('IN'));
  expect(screen.queryByRole('heading', { name: 'LK response' })).toBeNull();
  expect(await screen.findByRole('heading', { name: 'IN response' })).toBeVisible();
  expect(screen.getByLabelText('Hindi title')).toBeRequired();
  expect(screen.getByLabelText('English title')).toHaveValue('');
  expect(
    within(screen.getByLabelText('Primary response centre')).getByRole('option', {
      name: 'IN centre',
    }),
  ).toBeVisible();
  expect(
    await screen.findByRole('button', { name: 'Remove operational area IN area' }),
  ).toBeVisible();

  rerender(dashboard('NP'));
  expect(await screen.findByRole('heading', { name: 'NP response' })).toBeVisible();
  expect(screen.getByLabelText('Nepali title')).toBeRequired();
  expect(screen.queryByLabelText('Hindi title')).toBeNull();

  rerender(dashboard('LK'));
  expect(await screen.findByRole('heading', { name: 'LK response' })).toBeVisible();
  expect(screen.getByLabelText('English title')).toHaveValue('Sri Lanka draft');
  expect(screen.getByLabelText('සිංහල මාතෘකාව')).toBeRequired();
});

it('previews reviewed translations before publishing to the selected country', async () => {
  vi.mocked(api.request).mockReset().mockResolvedValue({ data: {} });
  vi.mocked(get).mockImplementation(async (path) => {
    if (path === '/countries') return policies;
    if (path === '/crises?countryCode=NP')
      return [
        {
          id: 'nepal-response',
          name: 'Nepal response',
          active: true,
          district: 'Kaski',
          updatedAt,
        },
      ];
    if (path.startsWith('/public/lookups')) return { organisations: [] };
    if (path.startsWith('/admin/crisis-operations/alerts'))
      return { items: [], total: 0, publishedCount: 0 };
    if (path.includes('/snapshot'))
      return { activeShelters: 0, shelteredPeople: 0, lastUpdated: updatedAt };
    return [];
  });
  render(
    <QueryClientProvider client={new QueryClient()}>{renderDashboard('NP')}</QueryClientProvider>,
  );
  expect(await screen.findByRole('heading', { name: 'Nepal response' })).toBeVisible();

  for (const [label, value] of Object.entries({
    'Affected area': 'Kaski',
    'Issuing authority': 'Test coordination unit',
    'English title': 'Test notice',
    'English instructions': 'Synthetic message',
    'Nepali title': '   ',
    'Nepali instructions': 'परीक्षण',
  }))
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.input(screen.getByLabelText('Expires at'), { target: { value: '2099-10-12T12:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Publish verified alert' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Provide a title and instructions in Nepali.',
  );
  expect(vi.mocked(api.request)).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('Nepali title'), { target: { value: 'सूचना' } });
  fireEvent.click(screen.getByRole('button', { name: 'Publish verified alert' }));
  const preview = within(screen.getByRole('dialog', { name: 'Preview public alert' }));
  expect(preview.getByRole('heading', { name: 'सूचना' })).toBeVisible();
  const publish = preview.getByRole('button', { name: 'Publish alert' });
  expect(publish).toBeDisabled();
  expect(vi.mocked(api.request)).not.toHaveBeenCalled();
  fireEvent.click(preview.getByRole('checkbox'));
  fireEvent.click(publish);
  await waitFor(() => expect(vi.mocked(api.request)).toHaveBeenCalledOnce());
  expect(vi.mocked(api.request)).toHaveBeenCalledWith(
    expect.objectContaining({
      url: '/alerts?countryCode=NP',
      data: expect.objectContaining({
        crisisId: 'nepal-response',
        published: true,
        translationsJson: '{"ne":{"title":"सूचना","message":"परीक्षण"}}',
      }),
    }),
  );
  expect(await screen.findByText('Public alert published.')).toBeVisible();
});

it('blocks composition while the selected country’s crisis request fails and lets the user retry', async () => {
  let failed = false;
  vi.mocked(get).mockImplementation(async (path) => {
    if (path === '/countries') return policies;
    if (path === '/crises?countryCode=NP') {
      if (!failed) {
        failed = true;
        throw new Error('Crisis service temporarily unavailable');
      }
      return [{ id: 'nepal-response', name: 'Recovered response', active: true, updatedAt }];
    }
    if (path.startsWith('/public/lookups')) return { organisations: [] };
    if (path.startsWith('/admin/crisis-operations/alerts'))
      return { items: [], total: 0, publishedCount: 0 };
    if (path.includes('/snapshot'))
      return { activeShelters: 0, shelteredPeople: 0, lastUpdated: updatedAt };
    return [];
  });

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {renderDashboard('NP')}
    </QueryClientProvider>,
  );
  expect(screen.getByRole('button', { name: 'Publish verified alert' })).toBeDisabled();
  const activePanel = within(
    screen.getByRole('heading', { name: 'Active crisis response' }).parentElement!,
  );
  expect(await activePanel.findByRole('alert')).toHaveTextContent(
    'Crisis service temporarily unavailable',
  );
  fireEvent.click(activePanel.getByRole('button', { name: 'Try again' }));
  expect(await activePanel.findByRole('heading', { name: 'Recovered response' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Publish verified alert' })).toBeEnabled();
});
