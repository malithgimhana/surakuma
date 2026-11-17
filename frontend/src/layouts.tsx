import { CountryScope, CountrySelector, useCountry, useCountries } from './geography';
import { countryAdminCode } from './countryScope';
import { useEffect, useState } from 'react';
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
  Siren,
  Sun,
  Tent,
  Users,
  X,
} from 'lucide-react';
import { Brand, Button } from './components';
import { landing, useAuth } from './auth';
import { canViewAdminSection, getAdminSection } from './adminSections';
function ThemeToggle() {
  const { t } = useTranslation();
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  function toggle() {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem('surakuma.theme', next ? 'dark' : 'light');
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
] as const;
export function AppLayout({
  mode = 'citizen',
}: {
  mode?: 'citizen' | 'staff' | 'volunteer' | 'admin';
}) {
  const { user, logout } = useAuth(),
    { t } = useTranslation();
  const location = useLocation();
  const home = user ? landing(user) : '/app';
  const navigate = useNavigate();
  const hasPreviousPage = (window.history.state?.idx ?? 0) > 0;
  const atWorkspaceHome = location.pathname === home && !location.search;
  const effectiveMode = mode === 'citizen' && ['/app/notifications', '/app/profile'].includes(location.pathname)
    ? home === '/staff' ? 'staff' : home === '/admin' ? 'admin' : home === '/volunteer' ? 'volunteer' : 'citizen'
    : mode;
  const fixedCountry = effectiveMode === 'admin' ? countryAdminCode(user) : undefined;
  const selectedCountry = useCountry();
  const country = fixedCountry ?? selectedCountry;
  const unread = useQuery({
    queryKey: ['notifications', 'unread', country],
    queryFn: () => get<{ count: number }>('/notifications/unread-count'),
    enabled: !!user,
    refetchInterval: 15000,
  });
  const globalAdmin = !!user?.roles.includes('Administrator');
  const administrativeAlerts = useQuery({ queryKey: ['admin-alerts-bell', country], enabled: effectiveMode === 'admin', queryFn: () => get<{ id: string; acknowledgedAt?: string; resolvedAt?: string }[]>(`/admin/alerts?countryCode=${country}`), refetchInterval: 60000 });
  const alertCount = Array.isArray(administrativeAlerts.data) ? administrativeAlerts.data.filter(a => !a.acknowledgedAt && !a.resolvedAt).length : 0;
  const currentAdminSection = effectiveMode === 'admin' && matchPath('/admin', location.pathname)
    ? getAdminSection(new URLSearchParams(location.search).get('section'), globalAdmin)
    : null;
  const [open, setOpen] = useState(false),
    [logoutError, setLogoutError] = useState(false);
  const citizenNav = [
    ['/app', t('dashboard'), House],
    ['/app/requests', t('myRequests'), ClipboardList],
    ['/app/notifications', t('notifications'), Bell],
    ['/shelters', t('shelters'), Tent],
    ['/alerts', t('alerts'), Siren],
  ] as const;
  const profileNav = ['/app/profile', t('profile'), Settings] as const;
  const nav =
    effectiveMode === 'staff'
      ? staffNav.filter(
          ([path]) =>
            path === '/staff' ||
            path === '/staff/cases' ||
            (path.includes('resources') &&
              user?.roles.some((r) => ['Logistics', 'Coordinator'].includes(r))) ||
            (path.includes('shelters') &&
              user?.roles.some((r) => ['ShelterAdmin', 'Coordinator'].includes(r))) ||
            (path.includes('volunteers') &&
              user?.roles.some((r) => ['VolunteerCoordinator', 'Coordinator'].includes(r))) ||
            (path.includes('crises') && user?.roles.includes('Coordinator')),
        ).map(([path, label, icon]) => [path, t(label), icon] as const)
      : effectiveMode === 'admin'
        ? adminNav
        : effectiveMode === 'volunteer'
          ? ([['/volunteer', 'My assignments', Users]] as const)
          : citizenNav;
  return (
    <CountryScope.Provider value={fixedCountry}>
    <div className="workspace">
      <a href="#main" className="skip-link">{t('skipMain')}</a>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <Brand />
        <div className="sidebar-caption">
          {effectiveMode === 'citizen'
            ? t('communityTag')
            : effectiveMode === 'staff'
              ? 'OPERATIONS WORKSPACE'
              : effectiveMode === 'admin'
                ? 'SYSTEM ADMINISTRATION'
                : 'VOLUNTEER WORKSPACE'}
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
                onClick={() => setOpen(false)}
              >
                <Icon size={20} /><span>{label}</span>
              </Link>
            ))}
          {[...nav, profileNav].map(([path, label, Icon]) => (
            <NavLink key={path} to={path} end onClick={() => setOpen(false)}>
              <Icon size={20} /><span>{label}</span>
            </NavLink>
          ))}
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
      <div className="workspace-main">
        <header className="workspace-top">
          <button className="mobile-menu" aria-label={t(open ? 'closeMenu' : 'menu')} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? <X /> : <Menu />}
          </button>
          <nav className="workspace-page-nav" aria-label="Page navigation">
            <button
              type="button"
              disabled={!hasPreviousPage && atWorkspaceHome}
              onClick={() => {
                if (hasPreviousPage) navigate(-1);
                else navigate(home, { replace: true });
              }}
            >
              <ArrowLeft size={17} aria-hidden="true" /> {t('back')}
            </button>
            <Link to="/">
              <House size={17} aria-hidden="true" /> {t('home')}
            </Link>
          </nav>
          <div className="header-actions">
            <ThemeToggle />
            <CountrySelector /><Language />
            <Link
              to="/app/notifications"
              className="notification-button"
              aria-label={t('notifications')}
            >
              <Bell size={21} />
              {!!((unread.data?.count || 0) + alertCount) && <span className="notification-count">{(unread.data?.count || 0) + alertCount}</span>}
            </Link>
            <span className="avatar">{user?.name[0]}</span>
            <div className="user-meta">
              <strong>{user?.name}</strong>
              <small>{user?.roles.join(' · ')}</small>
            </div>
          </div>
        </header>
        <main id="main" className="workspace-content">
          <CountryOutlet />
        </main>
      </div>
      {open && (
        <button className="sidebar-scrim" aria-label={t('closeMenu')} onClick={() => setOpen(false)} />
      )}
    </div>
    </CountryScope.Provider>
  );
}

function CountryOutlet() { const code = useCountry(); return <Outlet key={code} />; }
