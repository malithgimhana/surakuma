import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
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
  return (
    <label className="language">
      <span className="sr-only">{t('language')}</span>
      <select
        aria-label={t('language')}
        value={i18n.language}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
      >
        <option value="en">English</option>
        <option value="si">සිංහල</option>
        <option value="ta">தமிழ்</option>
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
            <Language />
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
        <Outlet />
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
export function AppLayout({
  mode = 'citizen',
}: {
  mode?: 'citizen' | 'staff' | 'volunteer' | 'admin';
}) {
  const { user, logout } = useAuth(),
    { t } = useTranslation();
  const location = useLocation();
  const home = user ? landing(user) : '/app';
  const effectiveMode = mode === 'citizen' && ['/app/notifications', '/app/profile'].includes(location.pathname)
    ? home === '/staff' ? 'staff' : home === '/admin' ? 'admin' : home === '/volunteer' ? 'volunteer' : 'citizen'
    : mode;
  const [open, setOpen] = useState(false),
    [logoutError, setLogoutError] = useState(false);
  const citizenNav = [
    ['/app', t('dashboard'), House],
    ['/app/requests', t('myRequests'), ClipboardList],
    ['/app/notifications', t('notifications'), Bell],
    ['/shelters', t('shelters'), Tent],
    ['/alerts', t('alerts'), Siren],
    ['/app/profile', t('profile'), Settings],
  ] as const;
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
        ? ([['/admin', 'Overview', LayoutDashboard], ['/admin?section=cases', 'Unassigned cases', Inbox], ['/admin?section=users', 'Users & access', Users], ['/admin?section=organisations', 'Organisations', Building2], ['/admin?section=integrations', 'Integrations', Layers], ['/admin?section=activity', 'Activity', Activity]] as const)
        : effectiveMode === 'volunteer'
          ? ([
              ['/volunteer', 'My assignments', Users],
              ['/app/profile', t('profile'), Settings],
            ] as const)
          : citizenNav;
  return (
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
          {nav.map(([path, label, Icon]) => effectiveMode === 'admin' ? (
            <Link key={path} to={path} className={location.pathname === '/admin' && (location.search || '') === (path.includes('?') ? '?' + path.split('?')[1] : '') ? 'active' : undefined} aria-current={location.pathname === '/admin' && (location.search || '') === (path.includes('?') ? '?' + path.split('?')[1] : '') ? 'page' : undefined} onClick={() => setOpen(false)}>
              <Icon size={20} /><span>{label}</span>
            </Link>
          ) : (
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
          <Link to="/" className="back-public">
            ← {t('home')}
          </Link>
          <div className="header-actions">
            <ThemeToggle />
            <Language />
            <Link
              to="/app/notifications"
              className="notification-button"
              aria-label={t('notifications')}
            >
              <Bell size={21} />
            </Link>
            <span className="avatar">{user?.name[0]}</span>
            <div className="user-meta">
              <strong>{user?.name}</strong>
              <small>{user?.roles.join(' · ')}</small>
            </div>
          </div>
        </header>
        <main id="main" className="workspace-content">
          <Outlet />
        </main>
      </div>
      {open && (
        <button className="sidebar-scrim" aria-label={t('closeMenu')} onClick={() => setOpen(false)} />
      )}
    </div>
  );
}
