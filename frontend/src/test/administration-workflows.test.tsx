import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '../i18n';
import { DeliveryRecovery, PartnerVerification, StaffLifecycle, SystemAdministratorRequests } from '../AdministrationWorkflows';
import { RecoveryPage } from '../RecoveryPage';
import { api, get } from '../api';

vi.mock('../auth', () => ({ useOptionalAuth: () => ({ user: { id: 'admin', roles: ['Administrator'] } }) }));
vi.mock('../api', () => ({ get: vi.fn(), api: { post: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue({}) }, errorMessage: () => 'Request failed' }));
afterEach(() => { cleanup(); vi.clearAllMocks(); window.history.replaceState(null, '', '/'); });
function show(node: React.ReactNode) {
  render(<StrictMode><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider></StrictMode>);
}
it('offers whole-account reactivation for a disabled account without staff roles', async () => {
  show(<StaffLifecycle user={{ id: 'citizen', disabled: true, memberships: [] }} global />);
  fireEvent.click(screen.getByRole('button', { name: 'Account actions' }));
  expect(screen.queryByRole('button', { name: 'Suspend staff access' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reactivate staff access' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send password reset email' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reactivate account' }));
  const reactivate = screen.getByRole('button', { name: 'Apply change' });
  expect(reactivate).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Restore account access' } });
  fireEvent.click(reactivate);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/users/citizen/account-status', {
    active: true, reason: 'Restore account access',
  }));
});
it.each([
  { suspended: false, label: 'Suspend staff access', unavailable: 'Reactivate staff access' },
  { suspended: true, label: 'Reactivate staff access', unavailable: 'Suspend staff access' },
])('offers $label for staff with the matching access status', async ({ suspended, label, unavailable }) => {
  show(<StaffLifecycle user={{ id: 'staff', memberships: [{ id: 'grant', role: 'Coordinator', suspended }] }} global={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Account actions' }));
  expect(screen.queryByRole('button', { name: unavailable })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Disable whole account' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: label }));
  const staffAction = screen.getByRole('button', { name: 'Apply change' });
  expect(staffAction).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Update staff access' } });
  fireEvent.click(staffAction);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith(
    expect.stringMatching(/^\/admin\/users\/staff\/staff-status\?countryCode=/),
    { active: suspended, reason: 'Update staff access' },
  ));
});
it('requires a reason and typed confirmation before sending a permanent deletion request', async () => {
  show(<StaffLifecycle user={{ id: 'citizen', email: 'citizen@example.test', memberships: [] }} global />);
  fireEvent.click(screen.getByRole('button', { name: 'Account actions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
  const confirm = screen.getByRole('button', { name: 'Permanently delete account' });
  const confirmation = screen.getByLabelText('Type DELETE to confirm');
  fireEvent.change(confirmation, { target: { value: 'DELETE' } });
  expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel deletion' }));
  expect(api.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
  const reopenedConfirm = screen.getByRole('button', { name: 'Permanently delete account' });
  expect(reopenedConfirm).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Duplicate test account' } });
  fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } });
  fireEvent.click(reopenedConfirm);
  await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/admin/users/citizen', {
    data: { confirmation: 'DELETE', reason: 'Duplicate test account' },
  }));
});
it('groups revoke in the account panel and confirms the exact role grant before changing it', async () => {
  show(<StaffLifecycle
    user={{ id: 'staff', name: 'Test User', memberships: [{ id: 'grant', role: 'CountryAdministrator', organisationId: 'centre' }] }}
    organisations={[{ id: 'centre', name: 'Response centre' }]}
    global
  />);
  const trigger = screen.getByRole('button', { name: 'Actions for Test User' });
  expect(screen.queryByRole('button', { name: 'Revoke Country Administrator' })).not.toBeInTheDocument();
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const revoke = screen.getByRole('button', { name: 'Revoke Country Administrator' });
  fireEvent.keyDown(revoke, { key: 'Escape' });
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Revoke Country Administrator' }));
  expect(screen.getByText(/Test User.*Response centre/)).toBeVisible();
  expect(api.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
  await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/admin/memberships/grant', { data: undefined }));
});
it('requires provider confirmation before retrying an uncertain email', async () => {
  vi.mocked(get).mockResolvedValue({
    items: [{
      id: 'event', state: 'Review', attempts: 1, message: 'Case update',
      history: [{ id: 'attempt', number: 1, state: 'Review', error: 'Provider timed out', createdAt: '2026-11-15T20:00:00Z' }],
    }],
    total: 1,
  });
  show(<DeliveryRecovery />);
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  const retry = await screen.findByRole('button', { name: 'Retry delivery' });
  fireEvent.click(screen.getByText('Attempt history'));
  expect(screen.getByText(/Provider timed out/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('Reason and provider check'), { target: { value: 'Provider confirmed no send' } });
  expect(retry).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(retry);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/delivery-management/event', expect.objectContaining({ confirmedNotDelivered: true, action: 'Retry' })));
});
it('shows deliveries on Search and hides them when the dates are cleared', async () => {
  vi.mocked(get).mockImplementation(async (path) => {
    const params = new URL(path, 'https://surakuma.test').searchParams;
    const withDates = params.has('from') || params.has('to');
    return {
      items: [{ id: 'event', state: params.get('state'), attempts: 1, message: withDates ? 'Delivery in range' : 'Case update', createdAt: '2026-11-15T20:00:00Z', history: [] }],
      total: withDates ? 1 : 21,
    };
  });
  show(<DeliveryRecovery />);

  const search = screen.getByRole('button', { name: 'Search' });
  const clear = screen.getByRole('button', { name: 'Clear dates' });
  expect(get).not.toHaveBeenCalled();
  expect(clear).toBeDisabled();
  expect(screen.queryByText('Case update')).not.toBeInTheDocument();
  fireEvent.click(search);
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Page 2')).toBeVisible();
  expect(await screen.findByText('Case update')).toBeVisible();
  const start = screen.getByLabelText('Start date');
  const end = screen.getByLabelText('End date');
  const requestsBeforeSearch = vi.mocked(get).mock.calls.length;
  fireEvent.change(screen.getByLabelText('Delivery state'), { target: { value: 'Review' } });
  fireEvent.change(start, { target: { value: '2026-11-16' } });
  fireEvent.change(end, { target: { value: '2026-11-16' } });
  expect(get).toHaveBeenCalledTimes(requestsBeforeSearch);
  expect(screen.getByText('Page 2')).toBeVisible();
  fireEvent.click(search);

  await waitFor(() => {
    const request = new URL(vi.mocked(get).mock.lastCall![0], 'https://surakuma.test');
    expect(request.searchParams.get('page')).toBe('1');
    expect(request.searchParams.get('state')).toBe('Review');
    expect(request.searchParams.get('from')).toBe('2026-11-15T18:30:00.000Z');
    expect(request.searchParams.get('to')).toBe('2026-11-16T18:30:00.000Z');
  });
  expect(await screen.findByText('Delivery in range')).toBeVisible();
  expect(screen.queryByText('Attempt history')).not.toBeInTheDocument();
  expect(screen.getByText('1 result')).toBeVisible();
  expect(screen.getByText('16 Nov 2026, 01:30')).toBeVisible();
  expect(screen.queryByRole('navigation', { name: 'Delivery pages' })).not.toBeInTheDocument();
  expect(screen.queryByText('No deliveries match the selected filters.')).not.toBeInTheDocument();

  const requests = vi.mocked(get).mock.calls.length;
  fireEvent.change(end, { target: { value: '2026-11-15' } });
  expect(screen.getByText('Choose an end date on or after the start date.')).toBeVisible();
  expect(search).toBeDisabled();
  expect(get).toHaveBeenCalledTimes(requests);

  fireEvent.click(clear);
  expect(start).toHaveValue('');
  expect(end).toHaveValue('');
  expect(clear).toBeDisabled();
  expect(screen.queryByText('Delivery in range')).not.toBeInTheDocument();
  expect(screen.queryByText('1 result')).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Delivery pages' })).not.toBeInTheDocument();
  expect(get).toHaveBeenCalledTimes(requests);

  fireEvent.click(search);
  expect(await screen.findByText('Case update')).toBeVisible();
  expect(await screen.findByText('Page 1')).toBeVisible();
  fireEvent.click(clear);
  expect(screen.queryByText('Case update')).not.toBeInTheDocument();
});
it('shows zero results next to Search for an empty response', async () => {
  vi.mocked(get).mockResolvedValue({ items: [], total: 0 });
  show(<DeliveryRecovery />);
  expect(screen.queryByText('0 results')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText('0 results')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Clear dates' }));
  expect(screen.queryByText('0 results')).not.toBeInTheDocument();
});
it('does not offer self-approval and explains the second-admin requirement', async () => {
  vi.mocked(get).mockResolvedValue({ activeGlobalAdministrators: 1, items: [{ id: 'p', targetName: 'Another account', state: 'Pending', requesterUserId: 'admin', reason: 'Global administrator access requested', createdAt: '2026-11-13T00:00:00Z', expiresAt: '2026-11-20T00:00:00Z' }] });
  show(<SystemAdministratorRequests />);
  expect(await screen.findByText(/second active System Administrator/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
});
it('allows country administrators to submit evidence without verification controls', () => {
  show(<PartnerVerification id="partner" global={false} verification={{ verificationState: 'Pending', evidence: '', decisionReason: '' }} />);
  expect(screen.getByRole('button', { name: 'Save evidence' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Verify partner' })).toBeNull();
});
it('retains reset credentials through StrictMode while removing them from the address bar', async () => {
  window.history.replaceState(null, '', '/reset-password#email=person%40example.test&token=single-use');
  show(<RecoveryPage reset />); expect(window.location.hash).toBe('');
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPassword!123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/reset-password', { email: 'person@example.test', password: 'NewPassword!123', token: 'single-use' }));
});
