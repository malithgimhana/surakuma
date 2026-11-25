import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { AxiosError } from 'axios';
import type { AxiosAdapter } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api, refreshSession, setToken } from '../api';
import { AuthProvider, Protected } from '../auth';
import type { User } from '../types';

const originalAdapter = api.defaults.adapter;
const user = (id: string, roles: string[]): User => ({
  id, roles, name: 'Synthetic tester', email: 'tester@example.test', language: 'en',
  memberships: [], householdSize: 1, accessibilityNeeds: '',
});

afterEach(() => {
  cleanup();
  api.defaults.adapter = originalAdapter;
  setToken(null);
});

it.each([
  [['CaseManager'], 'Staff workspace'],
  [['Citizen'], 'Citizen request form'],
  [['CaseManager', 'Citizen'], 'Citizen request form'],
])('checks the Citizen role before mounting the request form for %j', async (roles, destination) => {
  const currentUser = user('account', roles as string[]);
  api.defaults.adapter = async config => ({
    data: { accessToken: 'token', user: currentUser }, status: 200, statusText: 'OK', headers: {}, config,
  });
  render(<QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={['/app/requests/new']}>
      <AuthProvider>
        <Routes>
          <Route path="/app/requests/new" element={<Protected roles={['Citizen']}>
            <p>Citizen request form</p>
          </Protected>} />
          <Route path="/staff" element={<p>Staff workspace</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  </QueryClientProvider>);
  expect(await screen.findByText(destination as string)).toBeVisible();
  if (destination === 'Staff workspace') expect(screen.queryByText('Citizen request form')).toBeNull();
});

it('does not replay a citizen submission under an account signed in from another tab', async () => {
  setToken('old-token', user('citizen', ['Citizen']));
  const expired = vi.fn();
  window.addEventListener('session-expired', expired);
  const adapter = vi.fn<AxiosAdapter>(async config => {
    if (config.url === '/auth/refresh') return {
      data: { accessToken: 'staff-token', user: user('staff', ['CaseManager']) },
      status: 200, statusText: 'OK', headers: {}, config,
    };
    throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, {
      data: {}, status: 401, statusText: 'Unauthorized', headers: {}, config,
    });
  });
  api.defaults.adapter = adapter;
  try {
    await expect(api.post('/requests', { description: 'Synthetic request' })).rejects.toBeInstanceOf(AxiosError);
    expect(adapter.mock.calls.map(([config]) => config.url)).toEqual(['/requests', '/auth/refresh']);
    expect(expired).toHaveBeenCalled();
  } finally {
    window.removeEventListener('session-expired', expired);
  }
});

it('still refreshes and retries when the same citizen session expires', async () => {
  const citizen = user('citizen', ['Citizen']);
  setToken('old-token', citizen);
  const adapter = vi.fn<AxiosAdapter>(async config => {
    if (config.url === '/auth/refresh') return {
      data: { accessToken: 'new-token', user: citizen }, status: 200, statusText: 'OK', headers: {}, config,
    };
    if (config.headers.Authorization === 'Bearer old-token') throw new AxiosError(
      'Unauthorized', 'ERR_BAD_REQUEST', config, undefined,
      { data: {}, status: 401, statusText: 'Unauthorized', headers: {}, config },
    );
    return { data: { id: 'request' }, status: 201, statusText: 'Created', headers: {}, config };
  });
  api.defaults.adapter = adapter;
  expect((await api.post('/requests', { submissionKey: 'same-key' })).data).toEqual({ id: 'request' });
  expect(adapter.mock.calls.map(([config]) => config.url)).toEqual(['/requests', '/auth/refresh', '/requests']);
  expect(adapter.mock.calls[2][0].headers.Authorization).toBe('Bearer new-token');
});

it('accepts the shared browser session when a tab first opens without an account', async () => {
  const citizen = user('citizen', ['Citizen']);
  api.defaults.adapter = async config => ({
    data: { accessToken: 'token', user: citizen }, status: 200, statusText: 'OK', headers: {}, config,
  });
  expect((await refreshSession())?.user.id).toBe('citizen');
});
