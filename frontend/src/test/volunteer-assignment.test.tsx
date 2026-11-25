import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import '../i18n';
import { api, get } from '../api';
import { CountryScope } from '../geography';
import VolunteerAssignment from '../VolunteerAssignment';
import type { EligibleVolunteerCase, VolunteerWorkspaceData } from '../volunteerWorkspace';

vi.mock('../api', () => ({ get: vi.fn(), api: { post: vi.fn() }, errorMessage: (error: Error) => error.message }));
afterEach(cleanup);

it('matches and assigns a centre delivery using date-only inputs', async () => {
  const day = '2099-11-26';
  const startsAt = new Date(`${day}T00:00:00`).toISOString();
  const dueAt = new Date(`${day}T23:59:59.999`).toISOString();
  const work: EligibleVolunteerCase = {
    id: 'case', reference: 'SK-1018', organisationId: 'org', locationText: 'Gampaha',
    requiresCentreHandover: true, crisis: 'Flood', description: 'Drinking water',
    category: 'FoodWater', priority: 'High', outstandingQuantity: 10, unit: 'L',
  };
  const data: VolunteerWorkspaceData = {
    country: 'LK', organisations: [], tasks: [], cases: {}, activity: [],
    profiles: [{ id: 'profile', userId: 'user', organisationId: 'org', skills: 'Distribution',
      availability: 'Daily', verified: true, available: true, createdAt: '', updatedAt: '' }],
    names: { user: 'Assigned volunteer' },
    metrics: { verified: 1, available: 1, open: 0, deployments: 0, reports: 0, overdue: 0 },
    available: ['profile'], committed: [], overdue: [],
  };
  vi.mocked(get).mockImplementation(async path => {
    if (path.startsWith('/volunteer-tasks/cases?')) return [work];
    if (path === '/fulfillment/cases/case/dispatches') return {
      dispatches: [{ id: 'batch', reference: 'DSP-1020', centre: 'Gampaha Centre', availableForAssignment: true }],
    };
    if (path.startsWith('/volunteer-tasks/candidates?')) {
      const params = new URLSearchParams(path.split('?')[1]);
      expect(params.get('startsAt')).toBe(startsAt);
      expect(params.get('dueAt')).toBe(dueAt);
      return [{ id: 'profile', explanation: 'Eligible for the assignment', skills: 'Distribution', availability: 'Daily' }];
    }
    throw new Error(`Unexpected request ${path}`);
  });
  vi.mocked(api.post).mockResolvedValue({ data: { id: 'task' } });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><CountryScope.Provider value="LK">
      <VolunteerAssignment data={data} initialCase="case" initialDispatch="batch" preferredVolunteer={null} />
    </CountryScope.Provider></MemoryRouter>
  </QueryClientProvider>);

  const next = screen.getByRole('button', { name: 'Continue' });
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  const start = screen.getByLabelText('Start date');
  const due = screen.getByLabelText('Due date');
  expect(start).toHaveAttribute('type', 'date');
  expect(due).toHaveAttribute('type', 'date');
  fireEvent.change(start, { target: { value: day } });
  fireEvent.change(due, { target: { value: '2099-11-25' } });
  expect(next).toBeDisabled();
  fireEvent.change(due, { target: { value: day } });
  fireEvent.click(await screen.findByRole('radio', { name: /Assigned volunteer/ }));
  fireEvent.click(next);
  expect(screen.getAllByText('26 Nov 2099')).toHaveLength(2);

  fireEvent.click(screen.getByRole('button', { name: 'Confirm assignment' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/volunteer-tasks', expect.objectContaining({
    requestId: 'case', caseDispatchId: 'batch', volunteerId: 'profile', startsAt, dueAt,
  })));
});
