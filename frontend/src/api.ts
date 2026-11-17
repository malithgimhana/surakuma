import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type { User } from './types';
import { countryAdminCode, isAdminWorkspacePath } from './countryScope';
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  withCredentials: true,
  timeout: 25000,
});
let accessToken: string | null = null;
let adminCountry: string | undefined;
let refreshFlight: Promise<{ accessToken: string; user: User } | null> | null = null;
export function setToken(value: string | null, user?: User) {
  accessToken = value;
  adminCountry = value ? countryAdminCode(user) : undefined;
}
export async function refreshSession() {
  if (!refreshFlight) {
    const send = () => api.post<{ accessToken: string; user: User }>('/auth/refresh');
    // Tabs share the refresh cookie, so wait for the previous tab to finish rotating it.
    const response = navigator.locks ? navigator.locks.request('surakuma-auth-refresh', send) : send();
    refreshFlight = Promise.resolve(response)
      .then((r) => {
        setToken(r.data.accessToken, r.data.user);
        return r.data;
      })
      .catch(() => {
        setToken(null);
        return null;
      })
      .finally(() => {
        refreshFlight = null;
      });
  }
  return refreshFlight;
}
api.interceptors.request.use((config) => {
  let countryCode = 'LK';
  try { countryCode = localStorage.getItem('surakuma.country') || 'LK'; } catch { /* storage unavailable */ }
  if (adminCountry && isAdminWorkspacePath(window.location.pathname)) countryCode = adminCountry;
  if (config.method === 'get' && !new URLSearchParams(config.url?.split('?')[1]).has('countryCode'))
    config.params = { countryCode, ...config.params };
  if (config.data && typeof config.data === 'object' && !(config.data instanceof FormData)) {
    if (['/crises', '/resources', '/shelters', '/volunteers', '/admin/users', '/admin/organisations'].includes(config.url || '')) config.data = { countryCode, ...config.data };
    if (config.data.administrativeDivisionId === '') config.data.administrativeDivisionId = null;
  }
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});
api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const config = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    if (
      error.response?.status === 401 &&
      config &&
      !config._retry &&
      !config.url?.includes('/auth/')
    ) {
      config._retry = true;
      const session = await refreshSession();
      if (session) return api(config);
      window.dispatchEvent(new Event('session-expired'));
    }
    return Promise.reject(error);
  },
);
export async function get<T>(path: string): Promise<T> {
  return (await api.get<T>(path)).data;
}
export function errorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const d = error.response?.data as
      { detail?: string; title?: string; errors?: Record<string, string[]> } | undefined;
    if (d?.errors) return Object.values(d.errors).flat().join(' ');
    return (
      d?.detail ||
      d?.title ||
      (error.response?.status === 429
        ? 'Too many attempts. Please wait a minute.'
        : 'Cannot reach the service. Check the API and database, then try again.')
    );
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
