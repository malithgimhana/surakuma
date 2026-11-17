import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import '../i18n';
import { api, get } from '../api';
import { AppLayout } from '../layouts';
import { AdminPage } from '../StaffSupport';

vi.mock('../api', () => ({ get: vi.fn(), api: { get: vi.fn() }, errorMessage: () => 'Error' }));
vi.mock('../auth', () => {
  const auth = { user: { id: 'admin', name: 'Admin', roles: ['Administrator'], memberships: [] }, logout: vi.fn() };
  return { useAuth: () => auth, useOptionalAuth: () => auth, landing: () => '/admin' };
});

afterEach(() => { cleanup(); localStorage.removeItem('surakuma.country'); });

const countries = [{ code: 'LK', name: 'Sri Lanka' }, { code: 'NP', name: 'Nepal' }];
const reportFilters = {
  isSystemAdministrator: true, countries,
  crises: [{ id: 'flood', name: 'Flood response', countryCode: 'LK' }, { id: 'nepal', name: 'Nepal response', countryCode: 'NP' }],
};
const emptyCounts = { activeCrises: 0, submitted: 0, open: 0, unassigned: 0, overdue: 0, resolved: 0 };

it('keeps the current admin tab while replacing its data, then preserves the country across tabs', async () => {
  localStorage.setItem('surakuma.country', 'LK');
  vi.mocked(get).mockImplementation(async (path) => {
    const url = new URL(path, 'http://surakuma.test');
    const country = url.searchParams.get('countryCode');
    const name = country === 'LK' ? 'Sri Lanka' : country === 'NP' ? 'Nepal' : 'Unscoped';
    switch (url.pathname) {
      case '/admin/users': return { items: [{ id: name, name: name + ' staff', memberships: [] }], total: 1, pageNumber: 1, pageSize: 10 } as never;
      case '/admin/reports/filters': return reportFilters as never;
      case '/admin/reports': return {
        generatedAt: '2026-11-15T00:00:00Z', totals: emptyCounts,
        countries: (url.searchParams.get('scope') === 'all' ? countries : countries.filter(row => row.code === country))
          .map(row => ({ countryCode: row.code, country: row.name, ...emptyCounts })), stock: [],
      } as never;
      case '/public/lookups': return { organisations: [], crises: [] } as never;
      default: return [] as never;
    }
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/admin?section=users']}>
      <Routes><Route path="/admin" element={<AppLayout mode="admin" />}><Route index element={<AdminPage />} /></Route></Routes>
    </MemoryRouter>
  </QueryClientProvider>);
  const nav = within(screen.getByRole('navigation', { name: 'Workspace navigation' }));
  expect(await screen.findByText('Sri Lanka staff')).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), { target: { value: 'NP' } });
  expect(nav.getByRole('link', { name: 'Users & access' })).toHaveAttribute('aria-current', 'page');
  expect(await screen.findByText('Nepal staff')).toBeVisible();
  expect(screen.queryByText('Sri Lanka staff')).not.toBeInTheDocument();
  fireEvent.click(nav.getByRole('link', { name: 'Reports' }));
  expect(await screen.findByRole('rowheader', { name: 'Nepal' })).toBeVisible();
  expect(screen.queryByRole('rowheader', { name: 'Sri Lanka' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Report scope' }), { target: { value: 'all' } });
  expect(await screen.findByRole('rowheader', { name: 'Sri Lanka' })).toBeVisible();
  expect(screen.getByRole('rowheader', { name: 'Nepal' })).toBeVisible();
  expect(screen.getByRole('rowheader', { name: 'Total' })).toBeVisible();
});

it('shows crisis-filtered cards on Overview and keeps report details in Reports', async () => {
  localStorage.setItem('surakuma.country', 'LK');
  vi.mocked(get).mockClear().mockImplementation(async (path) => {
    if (path.startsWith('/admin/reports?')) {
      const filtered = path.includes('crisisId=flood');
      const totals = { activeCrises: filtered ? 0 : 1, submitted: 11, open: filtered ? 2 : 5,
        unassigned: filtered ? 0 : 1, overdue: 1, resolved: 4 };
      return {
        generatedAt: '2026-11-15T14:01:08Z',
        definition: 'Raw API calculation: [from,to) and UnderReview.',
        totals,
        countries: [{ countryCode: 'LK', country: 'Sri Lanka', ...totals, averageFirstReviewHours: 0.1 }],
        stock: [{ countryCode: 'LK', category: 'FoodWater', name: 'Relief packs', unit: 'packs', stock: 6, reserved: 2, available: 4 }],
        previousPeriod: { submitted: 10, percentChange: 10 },
      } as never;
    }
    if (path.startsWith('/admin/reports/filters')) return reportFilters as never;
    if (path === '/crises?countryCode=LK') return [{ id: 'flood', name: 'Flood response' }] as never;
    if (path === '/public/lookups') return { organisations: [], crises: [] } as never;
    return [] as never;
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/admin']}>
      <Routes><Route path="/admin" element={<AppLayout mode="admin" />}><Route index element={<AdminPage />} /></Route></Routes>
    </MemoryRouter>
  </QueryClientProvider>);

  const figures = within(await screen.findByRole('list', { name: 'Response figures' }));
  expect(figures.getAllByRole('listitem')).toHaveLength(5);
  const crises = figures.getByRole('link', { name: /active crises.*needs attention/i });
  const unassigned = figures.getByRole('link', { name: /unassigned cases.*needs attention/i });
  expect(crises).toHaveAttribute('href', '/admin/crises');
  expect(unassigned).toHaveAttribute('href', '/admin?section=cases');
  expect(crises).toHaveClass('needs-attention');
  expect(unassigned).toHaveClass('needs-attention');
  expect(screen.queryByRole('heading', { name: 'Unassigned requests' })).not.toBeInTheDocument();
  expect(get).not.toHaveBeenCalledWith('/requests/triage');
  expect(figures.getByText('Open cases').closest('li')).toHaveTextContent('5');
  expect(screen.queryByText(/Current snapshot for|Snapshot generated/)).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Resolved' })).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'First review (hours)' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'How counts work' })).not.toBeInTheDocument();
  expect(screen.queryByRole('table', { name: 'Current stock' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Raw API calculation|FoodWater/)).not.toBeInTheDocument();
  expect(screen.queryByText('How the report counts cases')).not.toBeInTheDocument();

  await screen.findByRole('option', { name: 'Flood response' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Crisis' }), { target: { value: 'flood' } });
  const filteredFigures = within(await screen.findByRole('list', { name: 'Response figures' }));
  expect(filteredFigures.getByText('Open cases').closest('li')).toHaveTextContent('2');
  expect(filteredFigures.getByRole('link', { name: /active crises/i })).not.toHaveClass('needs-attention');
  const filteredUnassigned = filteredFigures.getByRole('link', { name: /unassigned cases/i });
  expect(filteredUnassigned).not.toHaveClass('needs-attention');

  fireEvent.click(filteredUnassigned);
  expect(await screen.findByRole('heading', { name: 'Unassigned requests' })).toBeVisible();
  expect(await screen.findByText('No requests are waiting for assignment.')).toBeVisible();
  expect(get).toHaveBeenCalledWith('/requests/triage');

  const nav = within(screen.getByRole('navigation', { name: 'Workspace navigation' }));
  fireEvent.click(nav.getByRole('link', { name: 'Reports' }));
  expect(await screen.findByRole('heading', { name: 'Operational reports' })).toBeVisible();
  expect(await screen.findByRole('columnheader', { name: 'Resolved' })).toBeVisible();
  expect(screen.queryByRole('columnheader', { name: 'First review (hours)' })).not.toBeInTheDocument();
  expect(screen.queryByRole('cell', { name: '0.1' })).not.toBeInTheDocument();
  expect(screen.getByText(/Snapshot generated/)).toBeVisible();
  expect(screen.getByText('+10% vs previous period')).toBeVisible();
  const stock = within(await screen.findByRole('table', { name: 'Current stock snapshot' }));
  expect(stock.getByRole('rowheader', { name: /Relief packs.*food.*water/i })).toBeVisible();
  for (const value of ['packs', '6', '2', '4']) expect(stock.getByRole('cell', { name: value })).toBeVisible();
  const definitions = await screen.findByText('How this report counts cases');
  expect(definitions.closest('details')).toHaveAttribute('open');
  expect(screen.getByText('Cases still open more than 24 hours after submission.')).toBeVisible();
  expect(screen.queryByText('First review', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText(/Raw API calculation/)).not.toBeInTheDocument();
});

it('uses the displayed scope, crisis, inclusive UTC dates and report version for both exports', async () => {
  vi.mocked(get).mockImplementation(async path => {
    if (path.startsWith('/admin/reports/filters')) return reportFilters as never;
    if (path.startsWith('/admin/reports?')) return {
      generatedAt: '2026-11-15T14:01:08Z', version: 'snapshot', totals: emptyCounts, countries: [], stock: [],
      previousPeriod: { submitted: 0, percentChange: null },
    } as never;
    return [] as never;
  });
  const ObjectUrl = class extends URL {
    static createObjectURL() { return 'blob:report'; }
    static revokeObjectURL() {}
  };
  vi.stubGlobal('URL', ObjectUrl);
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.mocked(api.get).mockResolvedValue({ data: new Blob(['report']) });
  try {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin?section=reports']}>
        <Routes><Route path="/admin" element={<AdminPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Report country' }), { target: { value: 'NP' } });
    expect(screen.queryByRole('option', { name: 'Flood response' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Crisis' }), { target: { value: 'nepal' } });
    fireEvent.change(screen.getByLabelText('From (UTC)'), { target: { value: '2026-11-15' } });
    fireEvent.change(screen.getByLabelText('Through (UTC)'), { target: { value: '2026-11-15' } });
    const pdf = screen.getByRole('button', { name: 'Export PDF' });
    await waitFor(() => expect(pdf).toBeEnabled());
    fireEvent.click(pdf);
    const csv = screen.getByRole('button', { name: 'Download CSV' });
    await waitFor(() => expect(csv).toBeEnabled());
    fireEvent.click(csv);
    await waitFor(() => expect(click).toHaveBeenCalledTimes(2));
    for (const [path] of vi.mocked(api.get).mock.calls) {
      const url = new URL(path, 'https://surakuma.test');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        scope: 'country', countryCode: 'NP', crisisId: 'nepal',
        from: '2026-11-15T00:00:00Z', to: '2026-11-16T00:00:00.000Z', version: 'snapshot',
      });
    }
    expect(vi.mocked(api.get).mock.calls.map(([path]) => path.split('?')[0]))
      .toEqual(['/admin/reports/export/pdf', '/admin/reports/export']);
    expect(screen.queryByText(/vs previous period/)).not.toBeInTheDocument();
  } finally {
    click.mockRestore();
    vi.unstubAllGlobals();
  }
});
