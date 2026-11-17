import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, get } from './api';
import type { Entity } from './types';

export const dashboardRefreshInterval = 30_000;

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
