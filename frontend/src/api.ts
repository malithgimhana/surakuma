import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type { User } from './types';
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  withCredentials: true,
  timeout: 25000,
});
let accessToken: string | null = null;
let refreshFlight: Promise<{ accessToken: string; user: User } | null> | null = null;
export function setToken(value: string | null) {
  accessToken = value;
}
export async function refreshSession() {
  if (!refreshFlight)
    refreshFlight = api
      .post<{ accessToken: string; user: User }>('/auth/refresh')
      .then((r) => {
        setToken(r.data.accessToken);
        return r.data;
      })
      .catch(() => {
        setToken(null);
        return null;
      })
      .finally(() => {
        refreshFlight = null;
      });
  return refreshFlight;
}
api.interceptors.request.use((config) => {
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
