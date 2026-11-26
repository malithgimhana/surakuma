import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, get } from './api';
import { useCountry } from './geography';
import { volunteerCoordinatorRole } from './countryScope';
import type { Category, Priority, Volunteer, VolunteerData, VolunteerTask } from './types';

export type VolunteerCase = {
  id: string;
  reference: string;
  locationText: string;
  crisis: string;
  category: Category;
};

export type EligibleVolunteerCase = VolunteerCase & {
  organisationId: string;
  description: string;
  priority: Priority;
  outstandingQuantity: number;
  requiresCentreHandover?: boolean;
  administrativeDivisionId?: string | null;
  unit?: string;
};

export type VolunteerMetric =
  'verified' | 'available' | 'open' | 'deployments' | 'reports' | 'overdue';
export type VolunteerWorkspaceData = VolunteerData & {
  country: string;
  organisations: { id: string; name: string; canManage: boolean }[];
  cases: Record<string, VolunteerCase>;
  activity: { id: string; action: string; entityId: string; createdAt: string }[];
  metrics: Record<VolunteerMetric, number>;
  available: string[];
  committed: string[];
  overdue: string[];
};

export const coordinationPath = (view?: string, params?: Record<string, string>) =>
  '/staff/volunteers?' +
  new URLSearchParams({
    role: volunteerCoordinatorRole,
    ...(view && { view }),
    ...params,
  });

export const volunteerName = (data: VolunteerWorkspaceData, profile?: Volunteer) =>
  profile ? data.names[profile.userId] || profile.userId : 'Volunteer unavailable';

export const taskReference = (id: string) => id.slice(0, 8).toUpperCase();
export const volunteerTaskLabels: Record<VolunteerTask['status'], string> = {
  Assigned: 'Assigned · Awaiting acceptance',
  Accepted: 'Accepted · Ready to start',
  InProgress: 'In progress',
  AwaitingVerification: 'Awaiting coordinator review',
  Completed: 'Completed',
  Declined: 'Declined',
  Returned: 'Needs correction',
};

export function currentVolunteerTask(tasks: VolunteerTask[]) {
  return tasks.filter(task => task.status !== 'Declined').sort((a, b) =>
    Number(a.status === 'Completed') - Number(b.status === 'Completed') ||
    Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
}
export const volunteerEventLabels: Record<string, string> = {
  Assign: 'Task assigned',
  Accept: 'Assignment accepted',
  Decline: 'Assignment declined',
  Start: 'Deployment started',
  Progress: 'Progress updated',
  Complete: 'Report submitted',
  Return: 'Returned for correction',
  Verify: 'Report verified',
  VolunteerSaved: 'Volunteer profile saved',
  VolunteerVerified: 'Volunteer verified',
  VolunteerVerificationRemoved: 'Volunteer verification removed',
  VolunteerAssigned: 'Task assigned',
};
export const splitSkills = (text: string) =>
  text
    .split(',')
    .map((skill) => skill.trim())
    .filter(Boolean);
export const operationalVolunteerSkills = [
  'Distribution',
  'First Aid',
  'Logistics',
  'Search and Rescue',
  'Shelter Support',
] as const;

export function rosterSkills(profiles: Volunteer[], defaults: readonly string[] = []) {
  const skills = [...profiles.flatMap((profile) => splitSkills(profile.skills)), ...defaults];
  return [...new Map(skills.map((skill) => [skill.toLowerCase(), skill] as const)).values()].sort(
    (a, b) => a.localeCompare(b),
  );
}

export function useVolunteerWorkspace() {
  const country = useCountry();
  return useQuery({
    queryKey: ['volunteers', volunteerCoordinatorRole, country],
    queryFn: () => get<VolunteerWorkspaceData>('/volunteers'),
    refetchInterval: 30000,
  });
}

export function useVolunteerWrite<T, V>(path: string | ((input: V) => string)) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: V) =>
      (await api.post<T>(typeof path === 'string' ? path : path(input), input)).data,
    onSuccess: async () => {
      await Promise.all(
        [
          'volunteers',
          'volunteer-candidates',
          'volunteer-cases',
          'volunteer-registered-users',
          'notifications',
          'staff-overview',
          'my-profile',
          'volunteer-dispatch',
          'case-dispatches',
        ].map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
    },
  });
}

export function useVolunteerSearch(search: string) {
  const [value, setValue] = useState(search.trim());
  useEffect(() => {
    const timer = window.setTimeout(() => setValue(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  return { value, pending: search.trim() !== value };
}
