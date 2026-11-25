import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshSession, setToken } from './api';
import { donorWorkspace, landing } from './countryScope';
import type { User } from './types';
export { landing } from './countryScope';
interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (path: string, input: unknown) => Promise<User>;
  logout: () => Promise<void>;
  updateUser: (user: User) => void;
}
const Context = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true);
  const client = useQueryClient();
  useEffect(() => {
    let active = true;
    refreshSession().then((s) => {
      if (active) {
        setUser(s?.user ?? null);
        setLoading(false);
      }
    });
    const expired = () => {
      setUser(null);
      client.clear();
    };
    window.addEventListener('session-expired', expired);
    return () => {
      active = false;
      window.removeEventListener('session-expired', expired);
    };
  }, [client]);
  async function signIn(path: string, input: unknown) {
    const { data } = await api.post<{ accessToken: string; user: User }>(path, input);
    setToken(data.accessToken, data.user);
    client.clear();
    setUser(data.user);
    return data.user;
  }
  async function logout() {
    await api.post('/auth/logout');
    setToken(null);
    sessionStorage.clear();
    client.clear();
    // A fresh document discards pending requests and router state from the previous account.
    // Keep the old identity until unload so a protected-route effect cannot race this redirect.
    window.location.replace('/');
  }
  return (
    <Context.Provider value={{ user, loading, signIn, logout, updateUser: setUser }}>
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  const context = useContext(Context);
  if (!context) throw new Error('AuthProvider required');
  return context;
}
export function useOptionalAuth() { return useContext(Context); }
export function Protected({ children, roles, login = '/login' }: { children: ReactNode; roles?: string[]; login?: string }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="loading" role="status">
        Loading your session…
      </div>
    );
  if (!user) return <Navigate to={login} state={{ from: location.pathname + location.search }} replace />;
  if (roles && !user.roles.some((r) => roles.includes(r)))
    return <Navigate to={landing(user)} replace />;
  return children;
}

export function loginDestination(user: User, requested?: string, home = landing(user)) {
  if (!requested || !requested.startsWith('/') || requested.startsWith('//')) return home;
  const path = requested.split(/[?#]/, 1)[0];
  if (path.includes('\\')) return home;
  const donorPath = path === donorWorkspace || path.startsWith(donorWorkspace + '/');
  if (home === donorWorkspace) return donorPath ? requested : home;
  if (path === '/app/profile' || path === '/app/notifications') return requested;
  if ((path === '/app' || path.startsWith('/app/')) && user.roles.includes('Citizen')) return requested;
  if ((path === '/volunteer' || path.startsWith('/volunteer/')) && user.roles.includes('Volunteer')) return requested;
  if (path === '/staff/volunteers' && user.roles.includes('VolunteerCoordinator')) return requested;
  if (donorPath && user.roles.includes('Donor')) return requested;
  if ((path === '/funding/manage' || path.startsWith('/funding/manage/')) && user.roles.includes('FundingOfficer')) return requested;
  if ((path === '/partner' || path.startsWith('/partner/')) && user.roles.includes('Partner')) return requested;
  return path === home || path.startsWith(home + '/') ? requested : home;
}
