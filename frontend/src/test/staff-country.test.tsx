import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AxiosAdapter } from 'axios';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api, get, setToken } from '../api';
import { useCountry } from '../geography';
import '../i18n';
import { AppLayout } from '../layouts';
import type { User } from '../types';

const auth = vi.hoisted(() => ({ user: null as User | null, logout: vi.fn() }));
vi.mock('../auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('../auth')>(),
  useAuth: () => auth,
}));

const originalAdapter = api.defaults.adapter;
const originalUrl = window.location.href;
const originalHistory = window.history.state;
const countries = [
  { code: 'LK', name: 'Sri Lanka' }, { code: 'NP', name: 'Nepal' }, { code: 'IN', name: 'India' },
];

function WorkspaceCountry() {
  return <p>Case country {useCountry()}</p>;
}

function openWorkspace(memberships: User['memberships'], path = '/staff/cases') {
  auth.user = {
    id: 'staff', name: 'Relief staff', email: 'staff@example.test', language: 'en',
    roles: [...new Set(memberships.map(membership => membership.role))], memberships,
    householdSize: 1, accessibilityNeeds: '',
  };
  window.history.replaceState(null, '', path);
  localStorage.setItem('surakuma.country', 'IN');
  setToken('staff-token', auth.user);
  const adapter = vi.fn<AxiosAdapter>(async config => ({
    data: config.url === '/countries' ? countries : [],
    status: 200, statusText: 'OK', headers: {}, config,
  }));
  api.defaults.adapter = adapter;
  render(<QueryClientProvider client={new QueryClient()}>
    <BrowserRouter>
      <Routes>
        <Route path="/staff" element={<AppLayout mode="staff" />}>
          <Route path="cases" element={<WorkspaceCountry />} />
          <Route path="volunteers" element={<WorkspaceCountry />} />
        </Route>
        <Route path="/app" element={<AppLayout />}>
          <Route path="notifications" element={<WorkspaceCountry />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>);
  return adapter;
}

afterEach(() => {
  cleanup();
  auth.user = null;
  api.defaults.adapter = originalAdapter;
  setToken(null);
  window.history.replaceState(originalHistory, '', originalUrl);
  localStorage.removeItem('surakuma.country');
});

it('scopes the Volunteer Coordinator tabs, links and mutations to the volunteer grant', async () => {
  const send = openWorkspace([
    { ...localGrant, role: 'VolunteerCoordinator' },
    { ...localGrant, id: 'india-coordinator', role: 'Coordinator', countryCode: 'IN' },
  ], '/staff/volunteers?role=VolunteerCoordinator&view=reports');
  const navigation = screen.getByRole('navigation', { name: 'Workspace navigation' });
  expect(within(navigation).getAllByRole('link').map(link => link.textContent)).toEqual([
    'Overview', 'Volunteer Coordination', 'My Profile',
  ]);
  expect(screen.getByText('Case country LK')).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'Country' })).toBeNull();
  await api.post('/volunteer-tasks?countryCode=IN&staffRole=Coordinator', {});
  expect(send).toHaveBeenCalledWith(expect.objectContaining({
    url: '/volunteer-tasks', params: { countryCode: 'LK', staffRole: 'VolunteerCoordinator' },
  }));
  fireEvent.click(screen.getByRole('link', { name: 'Notifications' }));
  expect(screen.getByText('Case country LK')).toBeVisible();
  expect(window.location.search).toBe('?role=VolunteerCoordinator');
});

const localGrant = { id: 'local-case', organisationId: 'centre', role: 'CaseManager', countryCode: 'LK' };

it('pins a Sri Lanka case manager to Sri Lanka even when the browser saved a different country', async () => {
  const send = openWorkspace([
    localGrant,
    { ...localGrant, id: 'local-crisis-case', crisisId: 'flood' },
    { ...localGrant, id: 'nepal-partner', role: 'Partner', countryCode: 'NP' },
  ]);
  expect(screen.getByText('Sri Lanka')).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'Country' })).toBeNull();
  expect(screen.getByText('Case country LK')).toBeVisible();
  await get('/requests?assignedToMe=true');
  expect(send).toHaveBeenCalledWith(expect.objectContaining({
    url: '/requests?assignedToMe=true', params: { countryCode: 'LK' },
  }));

  fireEvent.click(screen.getByRole('link', { name: 'Notifications' }));
  expect(screen.getByText('Case country LK')).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'Country' })).toBeNull();
  expect(localStorage.getItem('surakuma.country')).toBe('IN');
});

it('blocks a Case Manager workspace with conflicting country grants and offers no selector', () => {
  openWorkspace([localGrant, { ...localGrant, id: 'nepal-case', countryCode: 'NP' }]);
  expect(screen.getByRole('heading', { name: 'Case Manager assignment needs attention' })).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'Country' })).toBeNull();
  expect(screen.queryByText('Case country LK')).toBeNull();
  expect(screen.queryByText('Case country NP')).toBeNull();
});

it('retains the country selector for other staff with multiple country assignments', async () => {
  const coordinator = { ...localGrant, role: 'Coordinator' };
  const send = openWorkspace([coordinator, { ...coordinator, id: 'nepal-coordinator', countryCode: 'NP' }]);
  const selector = screen.getByRole('combobox', { name: 'Country' });
  expect(within(selector).getAllByRole('option').map(option => option.textContent)).toEqual(['Sri Lanka', 'Nepal']);
  expect(selector).toHaveValue('LK');
  fireEvent.change(selector, { target: { value: 'NP' } });
  expect(screen.getByText('Case country NP')).toBeVisible();
  await get('/requests');
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ url: '/requests', params: { countryCode: 'NP', staffRole: 'Coordinator' } }));
});

it('pins Logistics reads and writes to the assigned country and rejects conflicting grant context', async () => {
  const logistics = { ...localGrant, role: 'Logistics' };
  const send = openWorkspace([logistics, { ...logistics, role: 'Partner', id: 'partner', countryCode: 'NP' }]);
  expect(screen.getByText('Sri Lanka')).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'Country' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Case Fulfillment' })).toHaveAttribute('href', '/staff/cases?role=Logistics');
  await api.post('/allocations?countryCode=IN', {});
  expect(send).toHaveBeenCalledWith(expect.objectContaining({
    url: '/allocations', params: { countryCode: 'LK', staffRole: 'Logistics' },
  }));
  cleanup();
  openWorkspace([logistics, { ...logistics, id: 'nepal-logistics', countryCode: 'NP' }]);
  expect(screen.getByRole('heading', { name: 'Logistics assignment needs attention' })).toBeVisible();
  expect(screen.queryByRole('combobox', { name: 'Country' })).toBeNull();
});
