import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import '../i18n';
import { get } from '../api';
import { AppLayout } from '../layouts';
import { ShelterManagement } from '../StaffPages';

vi.mock('../api', () => ({ get: vi.fn(), api: {}, errorMessage: () => 'Error' }));
vi.mock('../auth', () => {
  const auth = {
    user: { id: 'admin', name: 'Admin', roles: ['Administrator'], memberships: [] },
    logout: vi.fn(),
  };
  return { useAuth: () => auth, useOptionalAuth: () => auth, landing: () => '/admin' };
});
vi.mock('../MapView', () => ({ MapView: () => null }));

afterEach(() => {
  cleanup();
  localStorage.removeItem('surakuma.country');
});

it('combines placement and location filters, preserves national counts and resets filters when scope changes', async () => {
  localStorage.setItem('surakuma.country', 'LK');
  vi.mocked(get).mockImplementation(async (path) => {
    const base = {
      facilities: '',
      capacity: 10,
      available: 2,
      occupancy: 8,
      reserved: 0,
      open: true,
      updatedAt: '2026-11-17T10:00:00Z',
      address: 'Community centre',
    };
    if (path === '/countries')
      return [
        { code: 'LK', name: 'Sri Lanka' },
        { code: 'IN', name: 'India' },
        { code: 'NP', name: 'Nepal' },
      ] as never;
    if (path === '/countries/LK/divisions')
      return [{ id: 'colombo', name: 'Colombo', levelName: 'District', parentId: null }] as never;
    if (path.startsWith('/staff/shelters?')) {
      const country = new URLSearchParams(path.split('?')[1]).get('countryCode');
      const nationwide = country === 'LK';
      const name =
        country === 'LK' ? 'Central Hall' : country === 'IN' ? 'India Hall' : 'Nepal Hall';
      const entries = [
        {
          shelter: { ...base, name, id: country, administrativeDivisionId: 'colombo' },
          eligible: true,
          crises: [{ id: 'flood', name: 'Flood response' }],
          warnings: [{ kind: 'nearCapacity', severity: 'warning' }],
        },
      ];
      if (nationwide)
        entries.push({
          shelter: {
            ...base,
            name: 'Lakeside Hall',
            id: 'lakeside',
            administrativeDivisionId: 'colombo',
          },
          eligible: true,
          crises: [],
          warnings: [],
        });
      return {
        entries,
        statistics: {
          total: entries.length,
          available: entries.length * 2,
          occupied: entries.length * 8,
          households: 2,
          attention: 1,
        },
      } as never;
    }
    return [] as never;
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/admin/shelters']}>
        <Routes>
          <Route path="/admin" element={<AppLayout mode="admin" />}>
            <Route path="shelters" element={<ShelterManagement />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const stats = within(screen.getByRole('region', { name: 'Shelter statistics' }));
  expect(await screen.findByRole('heading', { name: 'Lakeside Hall' })).toBeVisible();
  fireEvent.change(screen.getByLabelText('Filter by district or region'), {
    target: { value: 'colombo' },
  });
  fireEvent.change(screen.getByLabelText('Filter by crisis'), { target: { value: 'flood' } });
  fireEvent.change(screen.getByLabelText('Search shelters'), { target: { value: 'central' } });
  expect(screen.getByRole('heading', { name: 'Central Hall' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Lakeside Hall' })).not.toBeInTheDocument();
  expect(stats.getByText('16')).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), { target: { value: 'IN' } });
  expect(await screen.findByRole('heading', { name: 'India Hall' })).toBeVisible();
  expect(screen.getByLabelText('Search shelters')).toHaveValue('');
  expect(screen.getByLabelText('Filter by district or region')).toHaveValue('');
  expect(screen.queryByRole('heading', { name: 'Central Hall' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Country' }), { target: { value: 'NP' } });
  expect(await screen.findByRole('heading', { name: 'Nepal Hall' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'India Hall' })).not.toBeInTheDocument();
});
