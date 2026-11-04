import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshSession, setToken } from './api';
import type { User } from './types';
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
    setToken(data.accessToken);
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
export function landing(user: User) {
  return user.roles.includes('Administrator')
    ? '/admin'
    : user.roles.includes('Volunteer')
      ? '/volunteer'
      : user.roles.some((r) => r !== 'Citizen')
        ? '/staff'
        : '/app';
}
export function Protected({ children, roles }: { children: ReactNode; roles?: string[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="loading" role="status">
        Loading your session…
      </div>
    );
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (roles && !user.roles.some((r) => roles.includes(r)))
    return <Navigate to={landing(user)} replace />;
  return children;
}

export function loginDestination(user: User, requested?: string) {
  if (!requested || !requested.startsWith('/') || requested.startsWith('//')) return landing(user);
  const home = landing(user);
  if (requested === '/app/profile' || requested === '/app/notifications') return requested;
  return requested === home || requested.startsWith(home + '/') ? requested : home;
}
