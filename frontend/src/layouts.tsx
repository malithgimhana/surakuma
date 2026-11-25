import { AssignedCountry, CountryScope, CountrySelector, useCountry, useCountries } from './geography';
import './shelter-workspace.css';
import { donorWorkspace, fundingWorkspace, isCitizenInbox, isVolunteerCoordinatorWorkspace, isVolunteerSelfWorkspace, notificationInboxRole, volunteerCoordinatorCountry, volunteerCoordinatorRole, volunteerCountry } from './countryScope';
import { coordinatorCountries, coordinatorPath, isCoordinatorWorkspace } from './countryScope';
import './coordinator-workspace.css';
import { caseManagerCountries, caseManagerProfileHref, caseScopeError, isCaseManagerWorkspace, isLogisticsWorkspace, isShelterWorkspace, logisticsCountries, shelterCountries, shelterRole, shelterPath, staffRoles, workspaceCountry, workspaceCountryCodes } from './countryScope';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from './api';
import { Link, matchPath, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Building2,
  Boxes,
  ChevronDown,
  ClipboardList,
  FolderOpen,
  HeartHandshake,
  House,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings,
  Activity,
  Inbox,
  Layers,
  ShieldCheck,
  Siren,
  Sun,
  Tent,
  Users,
  X,
} from 'lucide-react';
import { Brand, Button, Empty } from './components';
import { landing, useAuth } from './auth';
import { canViewAdminSection, getAdminSection } from './adminSections';
import { fundingSections } from './fundingNavigation';
import './admin-workspace.css';
import './case-manager.css';
import './funding-officer.css';
import './donor-workspace.css';

const fundingSectionIcons = {
  overview: Inbox, campaigns: FolderOpen, donations: HeartHandshake, allocations: Layers,
  expenses: ClipboardList, reports: Activity, activity: Bell, investigations: ShieldCheck,
};
function ThemeToggle({ defaultDark = false }: { defaultDark?: boolean }) {
  const { t } = useTranslation();
  const [dark, setDark] = useState(() => (document.documentElement.dataset.theme ?? (defaultDark ? 'dark' : 'light')) === 'dark');
  const changed = useRef(false);
  useLayoutEffect(() => {
    if (!defaultDark || document.documentElement.dataset.theme) return;
    document.documentElement.dataset.theme = 'dark';
    return () => {
      if (!changed.current) delete document.documentElement.dataset.theme;
    };
  }, [defaultDark]);
  function toggle() {
    changed.current = true;
    const next = dark ? 'light' : 'dark';
    setDark(!dark);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('surakuma.theme', next);
    } catch {
      // The selection still works for this page when storage is unavailable.
    }
  }
  const label = t(dark ? 'lightMode' : 'darkMode');
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {dark ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
    </button>
  );
}
function Language() {
  const { i18n, t } = useTranslation();
  const code = useCountry(), countries = useCountries();
  const languages = (Array.isArray(countries.data) ? countries.data.find(c => c.code === code)?.languages : undefined)?.split(',') || (code === 'LK' ? ['en','si','ta'] : ['en']);
  useEffect(() => { if (!languages.includes(i18n.language)) void i18n.changeLanguage('en'); }, [code, languages.join(','), i18n]);
  return (
    <label className="language">
      <span className="sr-only">{t('language')}</span>
      <select
        aria-label={t('language')}
        value={i18n.language}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
      >
        {languages.map(code => <option key={code} value={code}>{{en:'English',si:'සිංහල',ta:'தமிழ்',ne:'नेपाली',hi:'हिन्दी'}[code] || code}</option>)}
      </select>
      <ChevronDown size={14} />
    </label>
  );
}
export function PublicLayout() {
  const { t } = useTranslation(),
    { user } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <>
      <a href="#main" className="skip-link">
        {t('skipMain')}
      </a>
      <header className="public-header">
        <div className="container header-inner">
          <Brand />
          <nav
            aria-label="Main navigation"
            className={open ? 'public-nav open' : 'public-nav'}
            onClick={() => setOpen(false)}
          >
            <NavLink to="/" end>
              {t('home')}
            </NavLink>
            <NavLink to="/alerts">{t('alerts')}</NavLink>
            <NavLink to="/shelters">{t('shelters')}</NavLink>
            <NavLink to="/donation">{t('donation')}</NavLink>
            <NavLink to="/contact">{t('contact')}</NavLink>
            <Link className="mobile-workspace-link" to={user ? landing(user) : '/login'}>
              {user ? t('workspace') : t('login')}
            </Link>
          </nav>
          <div className="header-actions">
            <ThemeToggle />
            <CountrySelector /><Language />
            <Link className="button secondary compact" to={user ? landing(user) : '/login'}>
              {user ? t('workspace') : t('login')}
              <ArrowUpRight size={16} />
            </Link>
            <button
              className="mobile-menu"
              aria-label={t(open ? 'closeMenu' : 'menu')}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>
      <main id="main">
        <CountryOutlet />
      </main>
      <footer className="footer">
        <div className="container footer-top">
          <div>
            <Brand />
            <p>{t('footerTag')}</p>
          </div>
          <div className="footer-links">
            <Link to="/guidance">{t('guidance')}</Link>
            <Link to="/privacy">{t('privacy')}</Link>
            <Link to="/contact">{t('contact')}</Link>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>© {new Date().getFullYear()} සුරැකුම · Surakuma</span>
        </div>
      </footer>
    </>
  );
}
const staffNav = [
  ['/staff', 'staffOverview', LayoutDashboard],
  ['/staff/cases', 'staffCases', ClipboardList],
  ['/staff/resources', 'staffResources', Boxes],
  ['/staff/shelters', 'staffShelters', Tent],
  ['/staff/volunteers', 'staffVolunteers', Users],
  ['/staff/crises', 'staffCrises', Siren],
] as const;
const adminSectionNav = [
  ['overview', 'Overview', LayoutDashboard],
  ['cases', 'Unassigned cases', Inbox],
  ['users', 'Users & access', Users],
  ['organisations', 'Organisations', Building2],
  ['integrations', 'Integrations', Layers],
  ['activity', 'Activity', Activity],
  ['reports', 'Reports', Activity],
  ['alerts', 'Alerts', Bell],
] as const;
const adminNav = [
  ['/admin/crises', 'Crisis operations', Siren],
  ['/admin/resources', 'Resources', Boxes],
  ['/admin/shelters', 'Shelters', Tent],
  ['/admin/assistance-centres', 'Assistance centres', Building2],
  ['/admin/partner-commitments', 'Partner commitments', Building2],
  ['/admin/funding', 'Funding', HeartHandshake],
  ['/admin/supply-support', 'Supply support', Boxes],
] as const;

const mobileWorkspaceQuery = '(max-width: 850px)';

function useMobileWorkspace() {
  const [mobile, setMobile] = useState(() => window.matchMedia?.(mobileWorkspaceQuery).matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.(mobileWorkspaceQuery);
    const update = () => setMobile(query?.matches ?? false);
    query?.addEventListener('change', update);
    update();
    return () => query?.removeEventListener('change', update);
  }, []);
  return mobile;
}

export function AppLayout({
  mode = 'citizen',
}: {
  mode?: 'citizen' | 'staff' | 'volunteer' | 'admin' | 'partner' | 'funding' | 'donor';
}) {
  const { user, logout } = useAuth(),
    { t } = useTranslation();
  const location = useLocation();
  const home = user ? landing(user) : '/app';
  const caseManager = isCaseManagerWorkspace(user, location.pathname, location.search);
  const coordinator = isCoordinatorWorkspace(user, location.pathname, location.search);
  const logistics = isLogisticsWorkspace(user, location.pathname, location.search);
  const shelter = isShelterWorkspace(user, location.pathname, location.search);
  const volunteerCoordinator = isVolunteerCoordinatorWorkspace(user, location.pathname, location.search);
  const volunteerSelf = mode === 'volunteer' || isVolunteerSelfWorkspace(user, location.pathname, location.search);
  const volunteerRoleSearch = volunteerCoordinator ? '?role=' + volunteerCoordinatorRole : '';
  const workspaceHome = mode === 'donor' ? donorWorkspace : mode === 'funding' ? fundingWorkspace : volunteerSelf ? '/volunteer' : coordinator || caseManager || logistics || shelter || volunteerCoordinator ? '/staff' : home;
  const navigate = useNavigate();
  const hasPreviousPage = (window.history.state?.idx ?? 0) > 0;
  const atWorkspaceHome = location.pathname === workspaceHome &&
    (!location.search || (coordinator && location.search === '?role=Coordinator') || (shelter && location.search === shelterRole) || (volunteerCoordinator && location.search === volunteerRoleSearch));
  const effectiveMode = mode === 'citizen' && ['/app/notifications', '/app/profile'].includes(location.pathname) &&
    !isCitizenInbox(user, location.pathname, location.search)
    ? volunteerSelf ? 'volunteer' : workspaceHome === '/staff' ? 'staff' : home === '/admin' ? 'admin' : home === '/partner' ? 'partner' : 'citizen'
    : mode;
  const isAdmin = effectiveMode === 'admin';
  const isPartner = effectiveMode === 'partner';
  const isDonor = effectiveMode === 'donor';
  const isFunding = effectiveMode === 'funding';
  const selectedCountry = useCountry();
  const caseCountries = caseManager ? caseManagerCountries(user) : [];
  const caseScopeUnavailable = caseManager && caseCountries.length !== 1;
  const logisticsScope = logistics ? logisticsCountries(user) : [];
  const logisticsScopeUnavailable = logistics && logisticsScope.length !== 1;
  const citizenAccountPage = isCitizenInbox(user, location.pathname, location.search) ||
    (home === fundingWorkspace && user?.roles.includes('Citizen') && matchPath('/app/profile', location.pathname));
  const countryCodes = coordinator ? coordinatorCountries(user) : citizenAccountPage ? [] :
    workspaceCountryCodes(user, location.pathname);
  const shelterScope = shelter ? shelterCountries(user) : [];
  const shelterScopeUnavailable = shelter && shelterScope.length !== 1;
  const scopedCountry = volunteerSelf ? volunteerCountry(user) :
    volunteerCoordinator ? volunteerCoordinatorCountry(user, selectedCountry) :
    shelter ? shelterScope.length === 1 ? shelterScope[0] : undefined :
    logistics ? logisticsScope.length === 1 ? logisticsScope[0] : undefined :
    caseManager ? caseCountries.length === 1 ? caseCountries[0] : undefined :
    workspaceCountry(countryCodes, selectedCountry);
  const country = scopedCountry ?? selectedCountry;
  const inboxRole = notificationInboxRole(user, location.pathname, location.search);
  const unread = useQuery({
    queryKey: ['notifications', 'unread', user?.id, country, inboxRole],
    queryFn: () => get<{ count: number }>(`/notifications/unread-count?${new URLSearchParams({ inboxRole, countryCode: country })}`),
    enabled: !!user && (volunteerCoordinator ? !!scopedCountry : !caseScopeUnavailable && !logisticsScopeUnavailable && !shelterScopeUnavailable),
    refetchInterval: 15000,
  });
  const globalAdmin = !!user?.roles.includes('Administrator');
  const notificationCount = unread.data?.count ?? 0;
  const currentAdminSection = isAdmin && matchPath('/admin', location.pathname)
    ? getAdminSection(new URLSearchParams(location.search).get('section'), globalAdmin)
    : null;
  const workspaceClass = [
    'workspace',
    coordinator && 'coordinator-workspace',
    isAdmin && 'admin-workspace',
    isFunding && 'funding-officer-workspace',
    isDonor && 'donor-workspace',
    caseManager && 'case-manager-workspace',
    logistics && 'logistics-workspace',
    shelter && 'shelter-workspace',
    volunteerSelf && 'volunteer-self-workspace',
    volunteerCoordinator && 'volunteer-coordination-shell',
    currentAdminSection === 'overview' && 'admin-overview-shell',
    matchPath('/admin/crises', location.pathname) && 'crisis-operations-shell',
  ].filter(Boolean).join(' ');
  const [open, setOpen] = useState(false),
    [logoutError, setLogoutError] = useState(false);
  const mobile = useMobileWorkspace();
  const drawerOpen = mobile && open;
  const menuToggle = useRef<HTMLButtonElement>(null);
  const menuDismiss = useRef<HTMLButtonElement>(null);
  const mainContent = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!mobile) setOpen(false);
  }, [mobile]);
  useEffect(() => {
    if (!drawerOpen) return;
    menuDismiss.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [drawerOpen]);
  function dismissMenu() {
    setOpen(false);
    requestAnimationFrame(() => menuToggle.current?.focus());
  }
  function followWorkspaceLink() {
    if (coordinator) {
      requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        if (drawerOpen) mainContent.current?.focus({ preventScroll: true });
      });
    } else if (drawerOpen) requestAnimationFrame(() => mainContent.current?.focus());
    setOpen(false);
  }
  function handleDrawerKey(event: KeyboardEvent<HTMLElement>) {
    if (!drawerOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      dismissMenu();
    }
    if (event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'))
      .filter(control => control.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    const wrapTarget = event.shiftKey && document.activeElement === first ? last :
      !event.shiftKey && document.activeElement === last ? first : undefined;
    if (wrapTarget) {
      event.preventDefault();
      wrapTarget.focus();
    }
  }
  const citizenNav = [
    ['/app', t('dashboard'), House],
    ['/app/requests', t('myRequests'), ClipboardList],
    ['/app/notifications', t('notifications'), Bell],
    ['/app/shelters', t('shelters'), Tent],
    ['/app/assistance-centres', t('assistanceCentres'), Building2],
    ['/app/help', t('citizenHelp'), HeartHandshake],
    ['/app/alerts', t('alerts'), Siren],
    ...(user?.roles.includes('Volunteer') ? [['/volunteer', 'Volunteer assignments', Users] as const] : []),
  ] as const;
  const explicitRole = effectiveMode === 'staff' ? new URLSearchParams(location.search).get('role') : null;
  const staffRoleSearch = explicitRole && staffRoles.includes(explicitRole) && user?.roles.includes(explicitRole)
    ? '?role=' + encodeURIComponent(explicitRole) : '';
  const logisticsRole = logistics ? '?role=Logistics' : '';
  const roleSearch = coordinator ? '?role=Coordinator' : volunteerRoleSearch || (shelter ? shelterRole : logisticsRole || staffRoleSearch);
  const profileNav = [isFunding ? fundingWorkspace + '/profile' : volunteerSelf ? '/volunteer/profile' : caseManager && !volunteerCoordinator ? caseManagerProfileHref : '/app/profile' + roleSearch,
    volunteerCoordinator ? 'My Profile' : coordinator || volunteerSelf || caseManager || logistics || shelter ? 'My profile' : t('profile'), Settings] as const;
  const current = new URLSearchParams(location.search);
  const filters = new URLSearchParams();
  const campaign = current.get('campaign');
  const kind = current.get('kind');
  if (campaign) filters.set('campaign', campaign);
  if (kind === 'money' || kind === 'materials') filters.set('kind', kind);
  const campaignQuery = filters.size ? '?' + filters : '';
  const nav =
    isFunding ? fundingSections.map(([section, title]) => [
      section === 'overview' ? fundingWorkspace : fundingWorkspace + '/' + section + campaignQuery,
      section === 'overview' ? 'Overview' : title, fundingSectionIcons[section],
    ] as const) : volunteerCoordinator ? [
      ['/staff' + roleSearch, 'Overview', LayoutDashboard],
      ['/staff/volunteers' + roleSearch, 'Volunteer Coordination', Users],
    ] as const : coordinator ? staffNav.map(([path, label, icon]) => [
      path + roleSearch,
      ({ '/staff': 'Overview', '/staff/cases': 'Cases & AI Review', '/staff/resources': 'Resource availability',
        '/staff/shelters': 'Shelter capacity', '/staff/volunteers': 'Volunteer progress', '/staff/crises': 'Crises & public alerts' } as Record<string, string>)[path] ?? t(label),
      icon,
    ] as const) : shelter ? [
      [shelterPath(), 'Overview', LayoutDashboard],
      [shelterPath('/shelters'), 'Shelter management', Tent],
    ] as const : effectiveMode === 'staff'
      ? staffNav.filter(
          ([path]) =>
            (logistics && ['/staff', '/staff/cases', '/staff/resources'].includes(path)) || (!logistics && (path === '/staff' ||
            (path === '/staff/cases' && user?.roles.some((r) => ['CaseManager', 'Logistics', 'Coordinator'].includes(r))) ||
            (path.includes('resources') &&
              user?.roles.some((r) => ['Logistics', 'Coordinator'].includes(r))) ||
            (path.includes('shelters') &&
              user?.roles.some((r) => ['ShelterAdmin', 'Coordinator'].includes(r))) ||
            (path.includes('volunteers') &&
              user?.roles.some((r) => ['VolunteerCoordinator', 'Coordinator'].includes(r))) ||
            (path.includes('crises') && user?.roles.includes('Coordinator')))),
        ).map(([path, label, icon]) => [path === '/staff/shelters' && user?.roles.includes('ShelterAdmin') && !user.roles.includes('Coordinator')
          ? shelterPath('/shelters') : path + (coordinator ? '?role=Coordinator' : logisticsRole),
          logistics && path === '/staff/cases' ? 'Case Fulfillment' :
          caseManager && path === '/staff/cases' ? 'Cases & AI Review' :
          coordinator && path === '/staff/resources' ? 'Resource availability' :
          coordinator && path === '/staff/shelters' ? 'Shelter capacity' :
          coordinator && path === '/staff/volunteers' ? 'Volunteer progress' : t(label), icon] as const)
      : effectiveMode === 'admin'
        ? adminNav
        : effectiveMode === 'volunteer'
          ? ([['/volunteer', 'My assignments', Users],
            ...(user?.roles.includes('Citizen') ? [['/app/requests', t('myRequests'), ClipboardList] as const] : [])] as const)
          : effectiveMode === 'partner' ? ([
            ['/partner', 'Overview', LayoutDashboard],
            ['/partner/work', 'Assigned work', ClipboardList],
            ['/partner/contributions', 'Contributions & commitments', Boxes],
            ['/partner/supply-support', 'Supply support', ClipboardList],
            ['/partner/profile', 'Organisation profile', Building2],
            ['/partner/notifications', t('notifications'), Bell],
          ] as const) : isDonor ? ([
            [donorWorkspace, 'Overview', LayoutDashboard],
            [`${donorWorkspace}/campaigns`, 'Donation campaigns', HeartHandshake],
            [`${donorWorkspace}/donations`, 'Donations and pledges', Boxes],
            [`${donorWorkspace}/allocations`, 'Allocations', Layers],
            [`${donorWorkspace}/expenses`, 'Distributions and spending', ClipboardList],
            [`${donorWorkspace}/reports`, 'Transparency reports', Activity],
            [`${donorWorkspace}/notifications`, t('notifications'), Bell],
            [`${donorWorkspace}/profile`, 'Donor profile', Settings],
          ] as const) : citizenNav;

  return (
    <CountryScope.Provider value={scopedCountry}>
    <div className={workspaceClass}>
      <a href="#main" className="skip-link" inert={drawerOpen || undefined}>{t('skipMain')}</a>
      <aside id="workspace-sidebar" className={`sidebar ${drawerOpen ? 'open' : ''}`}
        inert={mobile && !drawerOpen || undefined} role={drawerOpen ? 'dialog' : undefined}
        aria-modal={drawerOpen || undefined} aria-label={drawerOpen ? t('workspaceNavigation') : undefined}
        onKeyDown={handleDrawerKey}>
        <Brand />
        {drawerOpen && (
          <button type="button" ref={menuDismiss} className={`workspace-sidebar-dismiss ${isAdmin ? 'admin-sidebar-dismiss' : volunteerSelf ? 'volunteer-sidebar-dismiss' : logistics ? 'logistics-sidebar-dismiss' : ''}`}
            aria-label={t('closeMenu')} onClick={dismissMenu}>
            <X size={20} aria-hidden="true" />
          </button>
        )}
        <div className="sidebar-caption">
          {effectiveMode === 'citizen'
            ? t('communityTag')
            : effectiveMode === 'staff'
              ? 'OPERATIONS WORKSPACE'
              : effectiveMode === 'admin'
                ? globalAdmin ? 'SYSTEM ADMINISTRATION' : 'COUNTRY ADMINISTRATION'
                : isFunding ? 'FUNDING WORKSPACE' : effectiveMode === 'partner' ? 'PARTNER WORKSPACE' : isDonor ? t('donorWorkspace') : 'VOLUNTEER WORKSPACE'}
        </div>
        <nav aria-label="Workspace navigation">
          {effectiveMode === 'admin' && adminSectionNav
            .filter(([section]) => canViewAdminSection(section, globalAdmin))
            .map(([section, label, Icon]) => (
              <Link
                key={section}
                to={section === 'overview' ? '/admin' : `/admin?section=${section}`}
                className={currentAdminSection === section ? 'active' : undefined}
                aria-current={currentAdminSection === section ? 'page' : undefined}
                onClick={followWorkspaceLink}
              >
                <Icon size={20} /><span>{label}</span>
              </Link>
            ))}
          {(isDonor ? nav : [...nav, profileNav]).map(([path, label, Icon]) => (
            <NavLink key={path} to={path} end={path !== '/volunteer/profile' && path !== '/app/requests' && path !== '/app/shelters' && path.split('?')[0] !== '/staff/cases' && path !== shelterPath('/shelters')} onClick={followWorkspaceLink}>
              <Icon size={20} /><span>{label}</span>
            </NavLink>
          ))}
          {!isDonor && !volunteerCoordinator && effectiveMode !== 'partner' && user?.roles.includes('Partner') && <NavLink to="/partner" end onClick={() => setOpen(false)}>
            <Building2 size={20} /><span>Partner workspace</span>
          </NavLink>}
          {!isFunding && !isDonor && !volunteerCoordinator && user?.roles.includes('FundingOfficer') && <NavLink to={fundingWorkspace} end onClick={() => setOpen(false)}>
            <HeartHandshake size={20} /><span>Funding management</span>
          </NavLink>}
          {!volunteerCoordinator && !coordinator && effectiveMode === 'staff' && user?.roles.some(r => ['Logistics', 'ShelterAdmin'].includes(r)) &&
            <NavLink to={'/staff/supply-support' + roleSearch} end onClick={followWorkspaceLink}>
              <Boxes size={20} /><span>Supply support</span>
            </NavLink>}
          {((effectiveMode === 'partner' && home !== '/partner') || (isFunding && home !== fundingWorkspace)) && <NavLink to={home} end onClick={() => setOpen(false)}>
            <LayoutDashboard size={20} /><span>Primary workspace</span>
          </NavLink>}
        </nav>
        <div className="sidebar-bottom">
          <div className="care-note">
            <HeartHandshake />
            <strong>{t('careTag')}</strong>
          </div>
          <button
            className="logout"
            onClick={() => void logout().catch(() => setLogoutError(true))}
          >
            <LogOut size={19} />
            {t('logout')}
          </button>
          {logoutError && <small role="alert">{t('serviceError')}</small>}
        </div>
      </aside>
      <div className="workspace-main" inert={drawerOpen || undefined}>
        <header className="workspace-top">
          <button className="mobile-menu" type="button" ref={menuToggle} aria-label={t('menu')} aria-expanded={drawerOpen}
            aria-controls="workspace-sidebar" aria-haspopup="dialog" onClick={() => setOpen(true)}>
            <Menu aria-hidden="true" />
          </button>
          <nav className="workspace-page-nav" aria-label="Page navigation">
            <button
              type="button"
              disabled={!hasPreviousPage && atWorkspaceHome}
              onClick={() => {
                if ((caseManager || logistics) && matchPath('/staff/cases/:id', location.pathname)) {
                  const queue = (location.state as { caseQueue?: string } | null)?.caseQueue;
                  navigate(queue?.startsWith('/staff/cases?') ? queue : '/staff/cases' + logisticsRole);
                }
                else if (hasPreviousPage) navigate(-1);
                else navigate(coordinator ? coordinatorPath() : volunteerCoordinator ? '/staff' + volunteerRoleSearch : shelter ? shelterPath() : workspaceHome, { replace: true });
              }}
            >
              <ArrowLeft size={17} aria-hidden="true" /> {(caseManager || logistics) && matchPath('/staff/cases/:id', location.pathname) ? 'Back to case queue' : t('back')}
            </button>
            <Link to="/">
              <House size={17} aria-hidden="true" /> {t('home')}
            </Link>
          </nav>
          <div className="header-actions">
            {!shelter && <ThemeToggle key={coordinator ? 'coordinator' : 'workspace'} defaultDark={coordinator} />}
            {volunteerSelf || caseManager || logistics || shelter || volunteerCoordinator ? <AssignedCountry code={scopedCountry} /> : <CountrySelector withFlag={isAdmin || isFunding} allowedCodes={countryCodes} />}<Language />
            <Link
              to={isAdmin ? '/admin/notifications' : volunteerSelf ? '/volunteer/notifications' : isDonor ? `${donorWorkspace}/notifications` :
                isFunding ? fundingWorkspace + '/notifications' : isPartner ? '/partner/notifications' :
                effectiveMode === 'staff' ? `/app/notifications?role=${inboxRole}` : '/app/notifications'}
              className="notification-button"
              aria-label={notificationCount ? `${t('notifications')}, ${notificationCount}` : t('notifications')}
            >
              <Bell size={21} />
              {!!notificationCount && <span className="notification-count" aria-hidden="true">{notificationCount}</span>}
            </Link>
            <span className="avatar">{user?.name[0]}</span>
            <div className="user-meta">
              <strong>{user?.name}</strong>
              <small>{isFunding ? 'Funding Officer' : isDonor ? 'Donor' : volunteerSelf ? 'Volunteer' : coordinator ? 'Crisis Coordinator' : volunteerCoordinator ? 'Volunteer Coordinator' : logistics ? 'Logistics staff' : caseManager ? 'Case Manager' : shelter ? 'Shelter Administrator' : user?.roles.join(' · ')}</small>
            </div>
          </div>
        </header>
        <main id="main" className="workspace-content" ref={mainContent} tabIndex={-1}>
          {coordinator && !scopedCountry && !['/app/profile', '/staff'].includes(location.pathname) ? <Empty title="Coordinator assignment needs attention"
            description="An administrator can assign an operating country and response scope." /> :
          volunteerCoordinator ? !scopedCountry && location.pathname !== '/app/profile' ? <Empty title="Volunteer coordination assignment needs attention"
            description="Ask an administrator to assign a country and organisation." /> : <CountryOutlet /> :
          shelterScopeUnavailable && location.pathname !== '/app/profile' ? <Empty title="Shelter assignment needs attention"
            description="Ask an administrator to confirm one operating country and an organisation assignment." /> :
          logisticsScopeUnavailable && location.pathname !== '/app/profile' ? <Empty title="Logistics assignment needs attention"
            description="Ask an administrator to confirm one operating country and an organisation assignment for Logistics." /> :
          caseScopeUnavailable && location.pathname !== '/app/profile' ? <div className="stack">
            <Empty title="Case Manager assignment needs attention" description={caseScopeError} />
            {staffRoles.filter(role => role !== 'CaseManager' && user?.roles.includes(role)).map(role =>
              <Link key={role} to={`/staff?role=${role}`}>Open {t('profileRole.' + role)} workspace</Link>)}
          </div> : <CountryOutlet />}
        </main>
      </div>
      {drawerOpen && (
        <div className="sidebar-scrim" aria-hidden="true" onClick={dismissMenu} />
      )}
    </div>
    </CountryScope.Provider>
  );
}

function CountryOutlet() {
  const code = useCountry();
  const { pathname } = useLocation();
  // The crisis dashboard keeps its in-memory alert drafts while changing country.
  return <Outlet key={matchPath('/admin/crises', pathname) || pathname === '/app/profile' ? pathname : code} />;
}
