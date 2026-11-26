import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type { User } from './types';
import { coordinatorCountries, isCoordinatorWorkspace } from './countryScope';
import { isVolunteerCoordinatorWorkspace, isVolunteerSelfWorkspace, volunteerCoordinatorCountry, volunteerCoordinatorRole, volunteerCountry } from './countryScope';
import { caseManagerCountries, isCaseManagerWorkspace, isLogisticsWorkspace, isShelterWorkspace, logisticsCountries, shelterCountries, workspaceCountry, workspaceCountryCodes } from './countryScope';
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  withCredentials: true,
  timeout: 25000,
});
let accessToken: string | null = null;
let sessionUser: User | undefined;
let refreshFlight: Promise<{ accessToken: string; user: User } | null> | null = null;
export function setToken(value: string | null, user?: User) {
  accessToken = value;
  sessionUser = value ? user : undefined;
}
export async function refreshSession() {
  if (!refreshFlight) {
    const previousUserId = sessionUser?.id;
    const send = () => api.post<{ accessToken: string; user: User }>('/auth/refresh');
    // Tabs share the refresh cookie, so wait for the previous tab to finish rotating it.
    const response = navigator.locks ? navigator.locks.request('surakuma-auth-refresh', send) : send();
    refreshFlight = Promise.resolve(response)
      .then((r) => {
        // The shared cookie may now belong to an account signed in from another tab.
        // Never replay the previous account's request with that account's token.
        if (previousUserId && previousUserId !== r.data.user.id) {
          setToken(null);
          window.dispatchEvent(new Event('session-expired'));
          return null;
        }
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
  const requestPath = (config.url ?? '').split('?')[0];
  if (config.method === 'post') {
    // Allow the backend's AI attempts and fallback to finish before Axios gives up.
    if (/^\/requests\/[^/]+\/recommendations\/generate$/.test(requestPath))
      config.timeout = Math.max(config.timeout ?? 0, 140000);
    if (/^\/requests\/[^/]+\/communications$/.test(requestPath) ||
        /^\/crises\/[^/]+\/decision-support\/(briefings|forecasts)$/.test(requestPath) ||
        requestPath === '/volunteer-tasks/skill-suggestion')
      config.timeout = Math.max(config.timeout ?? 0, 75000);
    // Translation drafts generate the title and message in two sequential AI calls.
    if (requestPath === '/alerts/translation-draft')
      config.timeout = Math.max(config.timeout ?? 0, 140000);
  }
  let countryCode = 'LK';
  try { countryCode = localStorage.getItem('surakuma.country') || 'LK'; } catch { /* storage unavailable */ }
  if (isCoordinatorWorkspace(sessionUser, window.location.pathname, window.location.search)) {
    const [path, query] = (config.url ?? '').split('?');
    const params = new URLSearchParams(query);
    params.delete('countryCode');
    params.delete('staffRole');
    config.url = params.size ? `${path}?${params}` : path;
    const scope = workspaceCountry(coordinatorCountries(sessionUser), countryCode);
    config.params = { ...config.params, countryCode: scope, staffRole: 'Coordinator' };
    if (path === '/crises' && config.method === 'post' && scope)
      config.data = { ...config.data, countryCode: scope };
    if (config.data?.administrativeDivisionId === '') config.data.administrativeDivisionId = null;
    if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
    return config;
  }
  if (isVolunteerCoordinatorWorkspace(sessionUser, window.location.pathname, window.location.search)) {
    const [path, query] = (config.url ?? '').split('?');
    const params = new URLSearchParams(query);
    params.delete('countryCode');
    params.delete('staffRole');
    config.url = params.size ? `${path}?${params}` : path;
    const scope = volunteerCoordinatorCountry(sessionUser, countryCode);
    config.params = { ...config.params, countryCode: scope, staffRole: volunteerCoordinatorRole };
    if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
    return config;
  }
  const shelter = isShelterWorkspace(sessionUser, window.location.pathname, window.location.search);
  if (shelter || isLogisticsWorkspace(sessionUser, window.location.pathname, window.location.search)) {
    const countries = shelter ? shelterCountries(sessionUser) : logisticsCountries(sessionUser);
    const [path, query] = (config.url ?? '').split('?');
    const params = new URLSearchParams(query);
    params.delete('countryCode');
    params.delete('staffRole');
    config.url = params.size ? `${path}?${params}` : path;
    config.params = { ...config.params, countryCode: countries.length === 1 ? countries[0] : undefined, staffRole: shelter ? 'ShelterAdmin' : 'Logistics' };
    if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
    return config;
  }
  const manager = isCaseManagerWorkspace(sessionUser, window.location.pathname, window.location.search);
  const managerCountries = manager ? caseManagerCountries(sessionUser) : [];
  if (manager) {
    const [path, query] = (config.url ?? '').split('?');
    const params = new URLSearchParams(query);
    params.delete('countryCode');
    const caseDetail = /^\/requests\/[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}(?:\/|$)/i.test(path);
    if (caseDetail) params.delete('staffRole');
    const next = params.toString();
    config.url = next ? `${path}?${next}` : path;
    // Explicitly pin the country even when a caller supplied axios params.
    const { countryCode: _countryCode, ...parameters } = config.params ?? {};
    config.params = {
      ...parameters,
      ...(managerCountries.length === 1 ? { countryCode: managerCountries[0] } : {}),
      ...(caseDetail ? { staffRole: 'CaseManager' } : {}),
    };
    if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
    return config;
  }
  if (isVolunteerSelfWorkspace(sessionUser, window.location.pathname, window.location.search)) {
    // The assignment feed resolves the current volunteer profile server-side.
    // Never apply a saved public country to volunteer workspace requests.
    if (requestPath === '/notifications' || requestPath.startsWith('/notifications/')) {
      const [, query] = (config.url ?? '').split('?');
      const params = new URLSearchParams(query);
      params.delete('countryCode');
      params.delete('staffRole');
      config.url = params.size ? `${requestPath}?${params}` : requestPath;
      config.params = { ...config.params, countryCode: volunteerCountry(sessionUser), staffRole: undefined };
    }
    if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
    return config;
  }
  countryCode = workspaceCountry(workspaceCountryCodes(sessionUser, window.location.pathname), countryCode) ?? countryCode;
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
