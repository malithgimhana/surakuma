import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import '../i18n';
import { api, get } from '../api';
import { CountryScope } from '../geography';
import TaskVolunteerRegistration from '../TaskVolunteerRegistration';
import type { VolunteerWorkspaceData } from '../volunteerWorkspace';

vi.mock('../api', () => ({ get: vi.fn(), api: { post: vi.fn() }, errorMessage: (error: Error) => error.message }));
afterEach(cleanup);

it.each([false, true])('registers for a dispatch without a schedule (existing account: %s)', async useExistingAccount => {
  const work = { id: 'case', reference: 'SK-1018', organisationId: 'org', locationText: 'Gampaha',
    requiresCentreHandover: true, administrativeDivisionId: 'district' };
  const data: VolunteerWorkspaceData = {
    country: 'LK', organisations: [{ id: 'org', name: 'Relief Center', canManage: true }],
    profiles: [], tasks: [], names: {}, cases: {}, activity: [],
    metrics: { verified: 0, available: 0, open: 0, deployments: 0, reports: 0, overdue: 0 },
    available: [], committed: [], overdue: [],
  };
  vi.mocked(get).mockImplementation(async path => {
    if (path.startsWith('/volunteer-tasks/cases?')) return [work];
    if (path === '/fulfillment/cases/case/dispatches') return {
      dispatches: [{ id: 'batch', reference: 'DSP-1020', centre: 'Gampaha Centre', availableForAssignment: true }],
    };
    if (path === '/countries/LK/divisions') return [{ id: 'district', name: 'Gampaha', levelName: 'District', parentId: null }];
    if (path === '/countries') return [{ code: 'LK', name: 'Sri Lanka' }];
    throw new Error(`Unexpected request ${path}`);
  });
  vi.mocked(api.post).mockResolvedValue({ data: { id: 'profile' } });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><CountryScope.Provider value="LK">
      <TaskVolunteerRegistration data={data} initialCase="case" initialDispatch="batch" />
    </CountryScope.Provider></MemoryRouter>
  </QueryClientProvider>);
  expect(await screen.findByRole('option', { name: 'DSP-1020 · Gampaha Centre' })).toBeVisible();
  expect(await screen.findByText('Task area · Gampaha')).toBeVisible();
  expect(screen.queryByLabelText('Administrative region')).not.toBeInTheDocument();
  if (useExistingAccount) {
    fireEvent.click(screen.getByLabelText('Use existing citizen account'));
    expect(screen.queryByLabelText('Initial password')).toBeNull();
  } else {
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Task Volunteer' } });
    fireEvent.change(screen.getByLabelText('Initial password'), { target: { value: 'RegistrationTest123!' } });
  }
  expect(screen.queryByLabelText('Availability schedule')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'citizen@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: useExistingAccount ? 'Save task volunteer profile' : 'Create account and profile' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/volunteers/task-registration', {
    requestId: 'case', caseDispatchId: 'batch', email: 'citizen@example.test', useExistingAccount,
    ...(!useExistingAccount && { name: 'Task Volunteer', password: 'RegistrationTest123!' }),
    profile: { skills: 'Distribution', available: true, serviceRegionId: 'district' },
  }));
});
