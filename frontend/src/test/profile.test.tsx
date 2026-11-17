import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../i18n';
import { api, get } from '../api';
import { useAuth } from '../auth';
import ProfilePage from '../ProfilePage';

vi.mock('../api', () => ({
  get: vi.fn(),
  api: { put: vi.fn() },
  errorMessage: () => 'Could not save',
}));
vi.mock('../auth', () => ({ useAuth: vi.fn() }));

const account = {
  id: 'profile-user',
  name: 'Test user',
  email: 'test@example.test',
  language: 'en',
  householdSize: 3,
  accessibilityNeeds: '',
  memberships: [],
};
const assignment = {
  id: 'own-assignment',
  country: 'Nepal',
  organisation: 'Response Centre',
  crisis: null,
  availableForAssignment: true,
  partnerStatus: 'Verified',
};

function openProfile(roles: string[], volunteer: object | null = null) {
  const user = { ...account, roles };
  vi.mocked(useAuth).mockReturnValue({
    user,
    updateUser: vi.fn(),
    loading: false,
    signIn: vi.fn(),
    logout: vi.fn(),
  });
  vi.mocked(get).mockResolvedValue({
    assignments: roles
      .filter((role) => role !== 'Citizen')
      .map((role) => ({ ...assignment, role })),
    volunteer,
    workPhone: null,
  });
  vi.mocked(api.put).mockResolvedValue({ data: user });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProfilePage />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it.each([
  ['Citizen', 'Household details'],
  ['Volunteer', 'Volunteering'],
  ['Coordinator', 'Staff assignments'],
  ['Partner', 'Partner organisations'],
  ['CountryAdministrator', 'Country administration'],
  ['Administrator', 'System administration'],
])('shows the right section for %s', async (role, section) => {
  openProfile([role]);
  expect(await screen.findByRole('heading', { name: section })).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Email address' })).toHaveAttribute('readonly');
  const household = screen.queryByRole('spinbutton', { name: 'People in your household' });
  if (role === 'Citizen') expect(household).toHaveValue(3);
  else expect(household).not.toBeInTheDocument();
  if (role === 'Partner') expect(screen.getByText('Verified')).toBeVisible();
  if (role === 'CountryAdministrator') expect(screen.getByText('Nepal')).toBeVisible();
  if (role === 'Administrator')
    expect(screen.getByText('Access across all countries')).toBeVisible();
});

it('saves both household and case availability for a mixed role account', async () => {
  openProfile(['Citizen', 'CaseManager']);
  const available = await screen.findByRole('checkbox', { name: /Available for new cases/ });
  fireEvent.click(available);
  fireEvent.change(screen.getByRole('spinbutton', { name: 'People in your household' }), {
    target: { value: '4' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith(
      '/auth/profile',
      expect.objectContaining({
        householdSize: 4,
        caseManagerAvailability: { 'own-assignment': false },
      }),
    ),
  );
});

it('saves volunteer availability without sending skills, verification or citizen fields', async () => {
  openProfile(['Volunteer'], {
    skills: 'First aid',
    verified: true,
    schedule: 'Weekdays',
    available: true,
  });
  expect(await screen.findByRole('textbox', { name: 'Recorded skills' })).toHaveAttribute(
    'readonly',
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Availability schedule' }), {
    target: { value: 'Weekends' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/auth/profile', {
      name: 'Test user',
      language: 'en',
      workPhone: '',
      volunteerAvailability: { schedule: 'Weekends', available: true },
      householdSize: undefined,
      accessibilityNeeds: undefined,
      caseManagerAvailability: undefined,
    }),
  );
});
