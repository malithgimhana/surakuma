import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '../i18n';
import { api, get } from '../api';
import MyVolunteerAssignments from '../MyVolunteerAssignments';
import type { VolunteerTask } from '../types';

vi.mock('../auth', () => ({ useAuth: () => ({ user: { id: 'own-volunteer' } }) }));
vi.mock('../api', () => ({ get: vi.fn(), api: { post: vi.fn() }, errorMessage: () => 'Unavailable' }));
HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
HTMLDialogElement.prototype.close ??= function () { this.open = false; };

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function assignment(
  title: string,
  status: VolunteerTask['status'],
  dueDay: number,
  assignedDay: number,
) {
  return {
    task: {
      id: title,
      status,
      title,
      dueAt: `2090-02-0${dueDay}T10:00:00Z`,
      createdAt: `2090-01-0${assignedDay}T10:00:00Z`,
      instructions: 'Follow the coordinator’s instructions.',
    },
    crisis: 'Flood response',
    locationText: 'Distribution centre',
    category: 'FoodWater',
  };
}

function openDashboard() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MyVolunteerAssignments />
    </QueryClientProvider>,
  );
}

it('keeps reports separate from active work and sorts backend assignments by deadline, recency, or workflow status', async () => {
  vi.mocked(get).mockResolvedValue({
    hasProfile: true,
    verified: true,
    history: [],
    assignments: [
      assignment('Inspect shelter', 'Completed', 3, 1),
      assignment('Check first aid kits', 'InProgress', 4, 2),
      assignment('Pack supplies', 'AwaitingVerification', 1, 4),
      assignment('Confirm routes', 'Assigned', 2, 3),
    ],
  });
  openDashboard();
  const filters = await screen.findByRole('group', { name: 'Filter assignments' });
  expect(get).toHaveBeenCalledWith('/volunteer-tasks/mine');
  const headings = () =>
    within(screen.getByRole('list'))
      .getAllByRole('heading')
      .map((heading) => heading.textContent);
  expect(headings()).toEqual([
    'Pack supplies',
    'Confirm routes',
    'Inspect shelter',
    'Check first aid kits',
  ]);
  const sort = screen.getByRole('combobox', { name: 'Sort assignments' });
  fireEvent.change(sort, { target: { value: 'latest' } });
  expect(headings()).toEqual([
    'Check first aid kits',
    'Inspect shelter',
    'Confirm routes',
    'Pack supplies',
  ]);
  fireEvent.change(sort, { target: { value: 'recent' } });
  expect(headings()).toEqual([
    'Pack supplies',
    'Confirm routes',
    'Check first aid kits',
    'Inspect shelter',
  ]);
  fireEvent.change(sort, { target: { value: 'status' } });
  expect(headings()).toEqual([
    'Confirm routes',
    'Check first aid kits',
    'Pack supplies',
    'Inspect shelter',
  ]);
  fireEvent.click(within(filters).getByRole('button', { name: 'In progress (1)' }));
  expect(headings()).toEqual(['Check first aid kits']);
  fireEvent.click(within(filters).getByRole('button', { name: 'Awaiting verification (1)' }));
  expect(headings()).toEqual(['Pack supplies']);
  fireEvent.click(within(filters).getByRole('button', { name: 'Completed (1)' }));
  expect(headings()).toEqual(['Inspect shelter']);
  fireEvent.click(within(filters).getByRole('button', { name: 'All (4)' }));
  expect(headings()).toHaveLength(4);
});

it('explains an empty profile and handles access denied without showing stale assignments', async () => {
  vi.mocked(get).mockResolvedValueOnce({
    hasProfile: false,
    assignments: [],
    history: [],
    verified: false,
  });
  openDashboard();
  expect(
    await screen.findByText('Your coordinator can help set up your volunteer profile.'),
  ).toBeVisible();
  cleanup();
  vi.mocked(get).mockRejectedValueOnce({ isAxiosError: true, response: { status: 403 } });
  openDashboard();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'You do not have access to volunteer assignments.',
  );
  expect(screen.queryByText('Total assignments')).not.toBeInTheDocument();
});

function mockDelivery(status: VolunteerTask['status'], reportedQuantity?: number) {
  const delivery = assignment('Deliver aid', status, 2, 1);
  vi.mocked(get).mockImplementation(async (path) => {
    if (path === '/volunteer-tasks/mine') return {
      assignments: [{ ...delivery, task: { ...delivery.task, id: 'task', caseDispatchId: 'dispatch' } }],
      history: [], verified: true, hasProfile: true,
    };
    if (path === '/fulfillment/volunteer-tasks/task/dispatch') return {
      centre: 'Gampaha Centre', centreLocation: 'Gampaha', reference: 'DSP-1020',
      items: [{ id: 'water', name: 'Drinking water', unit: 'l', atCentre: 10,
        givenToCitizen: null, reportedQuantity }],
    };
    throw new Error(`Unexpected request ${path}`);
  });
}

it('shows actual submitted quantities while review is pending, including zero', async () => {
  mockDelivery('AwaitingVerification', 0);
  openDashboard();
  fireEvent.click(await screen.findByRole('button', { name: 'View submitted report for Deliver aid' }));
  expect(await screen.findByRole('heading', { name: 'Reported handover' })).toBeVisible();
  expect(screen.getByText('Drinking water · 0 L')).toBeVisible();
  expect(screen.queryByText('Collect aid from Gampaha Centre')).not.toBeInTheDocument();
});

it('submits a partial handover using quantities and one explanation', async () => {
  mockDelivery('InProgress');
  vi.mocked(api.post).mockResolvedValue({ data: { id: 'task' } });
  openDashboard();
  fireEvent.click(await screen.findByRole('button', { name: 'Record handover for Deliver aid' }));
  fireEvent.change(await screen.findByLabelText('Drinking water (L)'), { target: { value: '7' } });
  fireEvent.change(screen.getByLabelText('Delivery issues or missing items'), {
    target: { value: 'Returned the remaining water to the centre.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Submit handover report' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/volunteer-tasks/task', expect.objectContaining({
    action: 'Complete', handoverQuantities: [{ allocationId: 'water', quantity: 7 }],
    issues: 'Returned the remaining water to the centre.',
  })));
});
