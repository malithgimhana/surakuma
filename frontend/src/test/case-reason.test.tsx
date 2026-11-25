import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../i18n';
import { CaseDetails } from '../StaffPages';
import { api, get } from '../api';
import type { RequestDetail } from '../types';
const staff = vi.hoisted(() => ({ roles: ['CaseManager'] }));
vi.mock('../auth', () => ({ useAuth: () => ({ user: staff }) }));
vi.mock('../MapView', () => ({ MapView: () => null }));
vi.mock('../api', () => ({
  get: vi.fn((path: string) => Promise.resolve(path === '/public/lookups' ? { crises: [], organisations: [] } : path.endsWith('/recommendations') ? { recommendations: [], decisions: [], duplicates: [] } : { request: { id: 'case', status: 'Submitted', category: 'FoodWater', priority: 'High', quantity: 2, deliveredQuantity: 0, householdSize: 1, description: 'Test request', organisationId: 'org' }, history: [], allocations: [], placements: [], attachments: [] })),
  api: { request: vi.fn().mockResolvedValue({ data: {} }) },
  errorMessage: () => 'Error',
}));
const defaultGet = vi.mocked(get).getMockImplementation()!;
afterEach(() => { cleanup(); staff.roles = ['CaseManager']; vi.clearAllMocks(); vi.mocked(get).mockImplementation(defaultGet); });
it('clears a saved case note so the next action cannot resend it', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/staff/cases/case']}><Routes><Route path="/staff/cases/:id" element={<CaseDetails />} /></Routes></MemoryRouter></QueryClientProvider>);
  const note = await screen.findByLabelText('Reason / case note');
  fireEvent.change(note, { target: { value: 'It has children also' } });
  fireEvent.click(screen.getByRole('button', { name: 'Begin review' }));
  await waitFor(() => expect(note).toHaveValue(''));
  expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'UnderReview', reason: 'It has children also' } }));
});

it('guides a verified case to its separate approval action before fulfillment', async () => {
  let status: RequestDetail['request']['status'] = 'Verified';
  vi.mocked(get).mockImplementation(async path => {
    if (path === '/fulfillment/cases/case') return {
      canEditNeeds: true, canAuthorize: false, requiresCoordinatorAuthorization: true, items: [],
    };
    if (path !== '/requests/case') return defaultGet(path);
    const data = await defaultGet(path) as RequestDetail;
    return { ...data, request: { ...data.request, status, requiresCoordinatorAuthorization: true } };
  });
  vi.mocked(api.request).mockImplementationOnce(async () => {
    status = 'Approved';
    return { data: {} };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/staff/cases/case?role=CaseManager']}>
    <Routes><Route path="/staff/cases/:id" element={<CaseDetails />} /></Routes>
  </MemoryRouter></QueryClientProvider>);

  expect(await screen.findByRole('link', { name: 'Go to case approval' })).toHaveAttribute('href', '#case-actions');
  expect(await screen.findByText('Awaiting case approval from the Case Manager.')).toBeVisible();
  expect(screen.queryByText('Awaiting Coordinator authorization.')).toBeNull();
  const actions = screen.getByRole('region', { name: 'Case actions' });
  fireEvent.click(within(actions).getByRole('button', { name: 'Approve case' }));

  await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
    url: '/requests/case/status', method: 'patch', data: expect.objectContaining({ status: 'Approved' }),
  })));
  expect(await screen.findByText('Awaiting Coordinator authorization.')).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Go to case approval' })).toBeNull();
});

it('lets the coordinator authorize and view deliveries while hiding logistics actions', async () => {
  staff.roles = ['Coordinator'];
  const items = [{ id: 'water', name: 'Drinking water', unit: 'l', requiredQuantity: 4, approvedQuantity: 4, deliveredQuantity: 2 }];
  vi.mocked(get).mockImplementation(async path => {
    if (path === '/fulfillment/cases/case') return {
      canEditNeeds: false, canAuthorize: true, requiresCoordinatorAuthorization: true, items,
    };
    if (path === '/requests/case/resources' || path === '/requests/case/case-managers' || path.startsWith('/partner/cases/case/shares')) return [];
    if (path !== '/requests/case') return defaultGet(path);
    const data = await defaultGet(path) as RequestDetail;
    return { ...data, request: { ...data.request, status: 'Approved', requiresCoordinatorAuthorization: true },
      items, allocations: [{ id: 'shipment', status: 'Dispatched', quantity: 2, unit: 'l' }] };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/staff/cases/case?role=Coordinator']}>
    <Routes><Route path="/staff/cases/:id" element={<CaseDetails />} /></Routes>
  </MemoryRouter></QueryClientProvider>);

  expect(await screen.findByRole('heading', { name: 'Delivery progress' })).toBeVisible();
  expect(screen.getByText('2 of 4 L delivered')).toBeVisible();
  expect(await screen.findByRole('button', { name: 'Authorize fulfillment' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Confirm delivery' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve reservation' })).not.toBeInTheDocument();
});

it('opens item review after beginning review and keeps the draft when minimized', async () => {
  HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
  HTMLDialogElement.prototype.close ??= function () { this.open = false; };
  let status = 'Submitted';
  let items = [
    { id: 'water', category: 'FoodWater', unit: 'litres', name: 'Drinking water', requiredQuantity: 3, approvedQuantity: 3, deliveredQuantity: 0 },
  ];
  vi.mocked(get).mockImplementation(async path => {
    if (path === '/public/resource-units') return [
      { code: 'litres', label: 'Litres', allowsFractions: true, stockCategories: ['FoodWater'] },
    ];
    if (path === '/fulfillment/cases/case') return {
      canEditNeeds: status === 'UnderReview', canAuthorize: false, requiresCoordinatorAuthorization: true, items,
    };
    if (path !== '/requests/case') return defaultGet(path);
    const data = await defaultGet(path) as RequestDetail;
    return { ...data, request: { ...data.request, status }, items };
  });
  vi.mocked(api.request).mockImplementationOnce(async () => {
    status = 'UnderReview';
    return { data: {} };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/staff/cases/case']}>
    <Routes><Route path="/staff/cases/:id" element={<CaseDetails />} /></Routes>
  </MemoryRouter></QueryClientProvider>);

  const begin = await screen.findByRole('button', { name: 'Begin review' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(begin);
  const dialog = await screen.findByRole('dialog', { name: 'Review requested items' });
  await waitFor(() => expect(within(dialog).getByLabelText('Unit')).toHaveValue('litres'));
  fireEvent.change(within(dialog).getByLabelText('Approved quantity'), { target: { value: '2' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Minimize item review' }));

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Approved quantity')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Verify request' })).toBeEnabled();
  const restore = screen.getByRole('button', { name: 'Restore item review' });
  expect(restore).toHaveFocus();
  fireEvent.click(restore);

  const restored = screen.getByRole('dialog', { name: 'Review requested items' });
  expect(within(restored).getByLabelText('Approved quantity')).toHaveValue(2);
  vi.mocked(api.request).mockImplementationOnce(async () => {
    items = items.map(item => ({ ...item, approvedQuantity: 2 }));
    return { data: {} };
  });
  fireEvent.click(within(restored).getByRole('button', { name: 'Save reviewed items' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
    method: 'put',
    url: '/fulfillment/cases/case/items',
    data: { items: [expect.objectContaining({ id: 'water', approvedQuantity: 2 })] },
  }));
  const reopen = await screen.findByRole('button', { name: 'Review items' });
  await waitFor(() => expect(reopen).toBeEnabled());
  fireEvent.click(reopen);
  expect(within(await screen.findByRole('dialog')).getByLabelText('Approved quantity')).toHaveValue(2);
});

it('starts each AI modification at the recommendation and requires a human explanation', async () => {
  vi.mocked(get).mockImplementation((path) => path.endsWith('/recommendations')
    ? Promise.resolve({ recommendations: [{ id: 'low', priority: 'Low', category: 'FoodWater', explanation: 'Lower priority', confidence: null,
      confidenceKind: 'Unavailable', reviewState: 'Pending' }], decisions: [], duplicates: [] })
    : defaultGet(path));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/staff/cases/case']}>
    <Routes><Route path="/staff/cases/:id" element={<CaseDetails />} /></Routes>
  </MemoryRouter></QueryClientProvider>);
  const priority = await screen.findByLabelText('Final priority for modification');
  expect(priority).toHaveValue('Low');
  expect(screen.getByText('Current priority')).toHaveTextContent('High');
  expect(screen.getByText('AI recommendation')).toHaveTextContent('Low');
  const modify = screen.getByRole('button', { name: 'Modify' });
  expect(modify).toBeDisabled();
  fireEvent.change(priority, { target: { value: 'Normal' } });
  expect(modify).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Decision / override reason'), { target: { value: 'Verified household circumstances.' } });
  fireEvent.click(modify);
  await waitFor(() => expect(api.request).toHaveBeenCalledWith(expect.objectContaining({
    url: '/requests/case/decisions',
    data: { recommendationId: 'low', action: 'Modify', finalPriority: 'Normal', finalCategory: 'FoodWater', reason: 'Verified household circumstances.' },
  })));
});

it('shows only the newest recommendation and resets the decision form when it is replaced', async () => {
  const initial = { id: 'initial', priority: 'Low', category: 'FoodWater', explanation: 'First recommendation', confidence: null,
    confidenceKind: 'Unavailable', reviewState: 'Pending', fallback: false };
  let recommendations = [initial, { ...initial, id: 'legacy', explanation: 'Older saved recommendation' }];
  vi.mocked(get).mockImplementation(path => path.endsWith('/recommendations')
    ? Promise.resolve({ recommendations, decisions: [], duplicates: [] })
    : defaultGet(path));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/staff/cases/case']}>
    <Routes><Route path="/staff/cases/:id" element={<CaseDetails />} /></Routes>
  </MemoryRouter></QueryClientProvider>);

  await screen.findByText('First recommendation');
  expect(screen.queryByText('Older saved recommendation')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Decision / override reason'), { target: { value: 'Draft for first recommendation' } });
  let finishGeneration!: () => void;
  vi.mocked(api.request).mockImplementationOnce(() => new Promise(resolve => {
    finishGeneration = () => resolve({ data: {} });
  }));
  recommendations = [{ ...initial, id: 'replacement', priority: 'High', explanation: 'Replacement recommendation', fallback: true }];
  fireEvent.click(screen.getByRole('button', { name: 'Generate recommendation' }));

  expect(await screen.findByRole('button', { name: 'Generating recommendation…' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Checking case details');
  finishGeneration();
  await screen.findByText('Replacement recommendation');
  expect(await screen.findByText('Recommendation refreshed using local rules.')).toHaveAttribute('role', 'status');
  expect(screen.queryByText('First recommendation')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Decision / override reason')).toHaveValue('');
  expect(screen.getByLabelText('Final priority for modification')).toHaveValue('High');
});

it('shows a generation error beside the action and lets the case manager retry', async () => {
  vi.mocked(api.request).mockRejectedValueOnce(new Error('Generation failed'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/staff/cases/case']}>
    <Routes><Route path="/staff/cases/:id" element={<CaseDetails />} /></Routes>
  </MemoryRouter></QueryClientProvider>);

  fireEvent.click(await screen.findByRole('button', { name: 'Generate recommendation' }));
  expect(await screen.findByText('Could not generate a recommendation. Error')).toHaveAttribute('role', 'alert');
  expect(screen.getByRole('button', { name: 'Generate recommendation' })).toBeEnabled();
});

it('shows the citizen wording and the unavailable state without manual generation for a structured request', async () => {
  vi.mocked(get).mockImplementation(path => path === '/requests/case' ? Promise.resolve({
    request: { id: 'case', status: 'Submitted', category: 'FoodWater', priority: 'High', quantity: 1,
      deliveredQuantity: 0, householdSize: 1, description: 'Our formula will run out today.',
      intake: { need: 'BabyFormula', timing: 'WithinDay' }, intakeScore: 9.5, priorityScore: 9.5,
      assessmentState: 'Failed' }, history: [], allocations: [], placements: [], attachments: [],
  }) : defaultGet(path));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/staff/cases/case']}>
    <Routes><Route path="/staff/cases/:id" element={<CaseDetails />} /></Routes>
  </MemoryRouter></QueryClientProvider>);

  const panel = await screen.findByRole('heading', { name: 'Triage recommendation' });
  expect(panel.closest('.citizen-triage-card')).toHaveTextContent('Our formula will run out today.');
  expect(screen.getByText('AI assessment unavailable')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Generate recommendation' })).toBeNull();
});
