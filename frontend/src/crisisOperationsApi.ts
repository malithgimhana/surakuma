import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, get } from './api';
import type { Entity } from './types';

export const dashboardRefreshInterval = 30_000;

export function refreshCaseAfterWrite(client: QueryClient, caseId: string, primary = 'staff-case') {
  // Queues refresh when reopened. Only the current case needs fresh data for the next action.
  void client.invalidateQueries({ refetchType: 'none' });
  void client.refetchQueries({ type: 'active', predicate: ({ queryKey }) =>
    queryKey[0] === 'notifications' || (queryKey.includes(caseId) && queryKey[0] !== primary) });
  return client.refetchQueries({ queryKey: [primary, caseId], type: 'active' });
}

export function countryPath(path: string, country: string, filters: Record<string, string> = {}) {
  return `${path}?${new URLSearchParams({ countryCode: country, ...filters })}`;
}

interface OperationalArea extends Entity {
  name: string;
}

export function useOperationalAreas(country: string, crisisId?: string) {
  return useQuery({
    queryKey: ['crisis-operations', country, crisisId, 'areas'],
    queryFn: () => get<OperationalArea[]>(countryPath(`/crises/${crisisId}/areas`, country)),
    enabled: !!crisisId,
    refetchInterval: dashboardRefreshInterval,
  });
}

export function useCrisisOperationsWrite(country: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      path,
      method = 'post',
      data,
    }: {
      path: string;
      method?: 'post' | 'put' | 'delete';
      data?: unknown;
    }) => (await api.request({ url: countryPath(path, country), method, data })).data,
    onSuccess: () => client.invalidateQueries(),
  });
}
