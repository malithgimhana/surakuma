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
});
