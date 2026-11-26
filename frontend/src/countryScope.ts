import type { User } from './types';

const adminRoles = ['Administrator', 'CountryAdministrator'];
export const staffRoles = ['Coordinator', 'CaseManager', 'Logistics', 'ShelterAdmin', 'VolunteerCoordinator'];
export const donorWorkspace = '/donor';
export const fundingWorkspace = '/funding/manage';
const workspaceRoles = new Map([
  ['admin', ['CountryAdministrator']],
  ['staff', [...staffRoles, 'CountryAdministrator']],
  ['partner', ['Partner']],
  ['volunteer', ['Volunteer']],
]);

export function landing(user: User) {
  if (user.roles.some(role => adminRoles.includes(role))) return '/admin';
  if (user.roles.includes('Volunteer')) return '/volunteer';
  if (user.roles.some(role => staffRoles.includes(role))) return '/staff';
  if (user.roles.includes('Partner')) return '/partner';
  if (user.roles.includes('FundingOfficer')) return fundingWorkspace;
  if (user.roles.includes('Donor') && !user.roles.includes('Citizen')) return donorWorkspace;
  return user.roles.includes('Citizen') ? '/app' : '/';
}

export function isCitizenInbox(user: User | null | undefined, pathname: string, search = '') {
  const role = new URLSearchParams(search).get('role');
  return pathname === '/app/notifications' && !!user?.roles.includes('Citizen') && (!role || role === 'Citizen');
}

export function notificationInboxRole(user: User | null | undefined, pathname: string, search = '') {
  const path = pathname.toLowerCase().replace(/\/+$/, '');
  if (!user || isCitizenInbox(user, path, search)) return 'Citizen';
  if (isVolunteerSelfWorkspace(user, path, search)) return 'Volunteer';
  if (isVolunteerCoordinatorWorkspace(user, path, search)) return volunteerCoordinatorRole;
  if (isCaseManagerWorkspace(user, path, search)) return 'CaseManager';
  if (isCoordinatorWorkspace(user, path, search)) return 'Coordinator';
  if (isLogisticsWorkspace(user, path, search)) return 'Logistics';
  if (isShelterWorkspace(user, path, search)) return 'ShelterAdmin';
  const workspace = path === '/app/notifications' || path === '/app/profile' ? landing(user) : path;
  if (workspace.startsWith('/admin')) return user.roles.includes('Administrator') ? 'Administrator' : 'CountryAdministrator';
  if (workspace.startsWith(fundingWorkspace)) return 'FundingOfficer';
  if (workspace.startsWith('/partner')) return 'Partner';
  if (workspace.startsWith(donorWorkspace)) return 'Donor';
  if (workspace.startsWith('/staff')) return staffRoles.find(role => user.roles.includes(role)) ?? 'CountryAdministrator';
  return 'Citizen';
}

export function isVolunteerSelfWorkspace(user: User | null | undefined, pathname: string, search = '') {
  if (!user?.roles.includes('Volunteer') || isCitizenInbox(user, pathname, search)) return false;
  const path = pathname.toLowerCase().replace(/\/+$/, '');
  if (path === '/volunteer' || path.startsWith('/volunteer/')) return true;
  const role = new URLSearchParams(search).get('role');
  return ['/app/profile', '/app/notifications'].includes(path) && landing(user) === '/volunteer' &&
    !(role && staffRoles.includes(role) && user.roles.includes(role));
}

export function volunteerCountry(user: User | null | undefined) {
  const countries = [...new Set(user?.memberships.flatMap(m =>
    m.role === 'Volunteer' && m.countryCode && m.organisationId ? [m.countryCode] : []) ?? [])];
  return countries.length === 1 ? countries[0] : undefined;
}

export function isCaseManagerWorkspace(user: User | null | undefined, pathname: string, search = '') {
  if (!user?.roles.includes('CaseManager') || isCitizenInbox(user, pathname, search)) return false;
  const path = pathname.toLowerCase().replace(/\/+$/, '');
  const role = new URLSearchParams(search).get('role');
  const hasOtherStaffRole = !!role && role !== 'CaseManager' && staffRoles.includes(role) && user.roles.includes(role);
  if (path === '/app/profile' || path === '/app/notifications')
    return role === 'CaseManager' || (!hasOtherStaffRole && landing(user) === '/staff');
  if (path !== '/staff' && path !== '/staff/cases' && !path.startsWith('/staff/cases/')) return false;
  return !hasOtherStaffRole;
}

export function isCoordinatorWorkspace(user: User | null | undefined, pathname: string, search = '') {
  if (!user?.roles?.includes('Coordinator') || isCitizenInbox(user, pathname, search)) return false;
  const path = pathname.toLowerCase().replace(/\/+$/, '');
  const role = new URLSearchParams(search).get('role');
  if (['/app/profile', '/app/notifications'].includes(path))
    return role === 'Coordinator' || (!role && landing(user) === '/staff' && !user.roles.includes('CaseManager'));
  if (!/^\/staff(?:$|\/(?:cases|resources|shelters|volunteers|crises)(?:$|\/))/.test(path)) return false;
  if (role && staffRoles.includes(role) && user.roles.includes(role)) return role === 'Coordinator';
  return !isCaseManagerWorkspace(user, pathname, search);
}

export const coordinatorPath = (path = '', params: Record<string, string> = {}) =>
  `/staff${path}?${new URLSearchParams({ ...params, role: 'Coordinator' })}`;

export function coordinatorCountries(user: User | null | undefined) {
  return [...new Set(user?.memberships.flatMap(m => m.role === 'Coordinator' && m.countryCode ? [m.countryCode] : []) ?? [])].sort();
}

export const shelterRole = '?role=ShelterAdmin';
export const shelterPath = (path = '', params: Record<string, string> = {}) =>
  `/staff${path}?${new URLSearchParams({ role: 'ShelterAdmin', ...params })}`;

export function isShelterWorkspace(user: User | null | undefined, pathname: string, search = '') {
  if (!user?.roles.includes('ShelterAdmin') || isCitizenInbox(user, pathname, search)) return false;
  const path = pathname.toLowerCase().replace(/\/+$/, '');
  if (!['/staff', '/staff/shelters', '/staff/shelters/new', '/staff/supply-support', '/app/profile', '/app/notifications'].includes(path))
    return false;
  const role = new URLSearchParams(search).get('role');
  if (role && staffRoles.includes(role) && user.roles.includes(role)) return role === 'ShelterAdmin';
  return landing(user) === '/staff' && !staffRoles.some(other => other !== 'ShelterAdmin' && user.roles.includes(other));
}

export function shelterCountries(user: User | null | undefined) {
  return [...new Set(user?.memberships.flatMap(m =>
    m.role === 'ShelterAdmin' && m.countryCode && m.organisationId && !m.crisisId ? [m.countryCode] : []) ?? [])];
}

export const caseManagerProfileHref = '/app/profile?role=CaseManager';

export const volunteerCoordinatorRole = 'VolunteerCoordinator';
export function isVolunteerCoordinatorWorkspace(user: User | null | undefined, pathname: string, search = '') {
  if (!user?.roles.includes(volunteerCoordinatorRole) || isCitizenInbox(user, pathname, search)) return false;
  const path = pathname.toLowerCase().replace(/\/+$/, '');
  if (!['/staff', '/staff/volunteers', '/app/profile', '/app/notifications'].includes(path)) return false;
  const role = new URLSearchParams(search).get('role');
  if (role && staffRoles.includes(role) && user.roles.includes(role)) return role === volunteerCoordinatorRole;
  if (path === '/staff/volunteers') return !user.roles.includes('Coordinator');
  return landing(user) === '/staff' && staffRoles.filter(r => user.roles.includes(r)).length === 1;
}

export function volunteerCoordinatorCountry(user: User | null | undefined, savedCountry: string) {
  const countries = [...new Set(user?.memberships.flatMap(m => m.role === volunteerCoordinatorRole &&
    m.organisationId && m.countryCode ? [m.countryCode] : []) ?? [])].sort();
  return workspaceCountry(countries, savedCountry);
}

export function isLogisticsWorkspace(user: User | null | undefined, pathname: string, search = '') {
  if (!user?.roles.includes('Logistics') || isCitizenInbox(user, pathname, search)) return false;
  const path = pathname.toLowerCase().replace(/\/+$/, '');
  const role = new URLSearchParams(search).get('role');
  if (!/^\/staff(?:$|\/(?:resources|supply-support|cases)(?:$|\/))/.test(path) &&
    !['/app/profile', '/app/notifications'].includes(path)) return false;
  if (role && staffRoles.includes(role) && user.roles.includes(role)) return role === 'Logistics';
  return landing(user) === '/staff' && !user.roles.some(r => r === 'CaseManager' || r === 'Coordinator');
}

export function logisticsCountries(user: User | null | undefined) {
  return [...new Set(user?.memberships?.flatMap(m =>
    m.role === 'Logistics' && m.countryCode && m.organisationId ? [m.countryCode] : []) ?? [])];
}

export function caseManagerCountries(user: User | null | undefined) {
  return [...new Set(user?.memberships?.flatMap(m =>
    m.role === 'CaseManager' && m.countryCode ? [m.countryCode] : []) ?? [])].sort();
}

export const caseScopeError = 'Case Managers need one assigned country. Contact an administrator to correct your assignments.';

export function workspaceCountryCodes(user: User | null | undefined, pathname: string) {
  if (!user || user.roles.includes('Administrator')) return [];
  const path = pathname.toLowerCase().replace(/\/+$/, '');
  const workspace = path === '/app/notifications' || path === '/app/profile' ? landing(user) : path;
  const [, section, page] = workspace.split('/');
  const roles = section === 'funding' && page === 'manage' ? ['FundingOfficer'] : workspaceRoles.get(section);
  if (!roles) return [];

  const codes = [...new Set((user.memberships ?? []).flatMap(({ role, countryCode, crisisId }) =>
    countryCode && roles.includes(role) && (role !== 'CountryAdministrator' || !crisisId) ? [countryCode] : [],
  ))].sort();
  return section === 'admin' ? codes.slice(0, 1) : codes;
}

export function workspaceCountry(codes: string[], savedCountry: string) {
  return codes.includes(savedCountry) ? savedCountry : codes[0];
}
