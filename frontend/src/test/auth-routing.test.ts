import { describe, expect, it } from 'vitest';
import { loginDestination } from '../auth';
import type { User } from '../types';
const user = (roles: string[]): User => ({
  id: 'test',
  name: 'Synthetic tester',
  email: 'test@example.test',
  language: 'en',
  roles,
  memberships: [],
  householdSize: 1,
  accessibilityNeeds: '',
});
describe('Role-aware login destinations', () => {
  it('does not send staff to a previous citizen account workspace', () => {
    expect(loginDestination(user(['CaseManager']), '/app/requests/old-case')).toBe('/staff');
  });
  it('preserves an authorised citizen request journey', () => {
    expect(loginDestination(user(['Citizen']), '/app/requests/new')).toBe('/app/requests/new');
  });
  it('rejects foreign URLs and routes outside the authenticated role', () => {
    expect(loginDestination(user(['Citizen']), '//example.test')).toBe('/app');
    expect(loginDestination(user(['Citizen']), '/admin')).toBe('/app');
  });
  it('keeps donor-only accounts in their dedicated workspace', () => {
    expect(loginDestination(user(['Donor']), '/app/profile')).toBe('/donor');
    expect(loginDestination(user(['Donor']), '/donor/donations?campaign=sample')).toBe('/donor/donations?campaign=sample');
    expect(loginDestination(user(['Citizen']), '/donor/donations')).toBe('/app');
    expect(loginDestination(user(['Citizen', 'Donor']), undefined, '/donor')).toBe('/donor');
  });
});
