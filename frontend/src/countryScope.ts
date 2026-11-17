import type { User } from './types';

export function countryAdminCode(user: User | null | undefined) {
  if (!user?.roles.includes('CountryAdministrator') || user.roles.includes('Administrator')) return;
  return (user.memberships ?? [])
    .flatMap(membership =>
      membership.role === 'CountryAdministrator' && !membership.crisisId && membership.countryCode
        ? [membership.countryCode]
        : [],
    )
    .sort()[0];
}

export function isAdminWorkspacePath(path: string) {
  return path === '/admin' || path.startsWith('/admin/') || path === '/app/notifications' || path === '/app/profile';
}
