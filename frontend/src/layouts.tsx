import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpRight,
  Bell,
  Boxes,
  ChevronDown,
  ClipboardList,
  HeartHandshake,
  House,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Siren,
  Tent,
  Users,
  X,
} from 'lucide-react';
import { Brand, Button } from './components';
import { landing, useAuth } from './auth';
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
        {t('next')}
      </a>
      <div className="demo-bar">
        <ShieldCheck size={13} />
        {t('demo')}
      </div>
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
          </nav>
          <div className="header-actions">
            <Language />
            <Link className="button secondary compact" to={user ? landing(user) : '/login'}>
              {user ? t('workspace') : t('login')}
              <ArrowUpRight size={16} />
            </Link>
            <button
              className="mobile-menu"
              aria-label={t('menu')}
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
          <span>{t('notEmergency')}</span>
        </div>
      </footer>
    </>
  );
}
const staffNav = [
  ['/staff', 'Overview', LayoutDashboard],
  ['/staff/cases', 'Cases & AI review', ClipboardList],
  ['/staff/resources', 'Resources & logistics', Boxes],
  ['/staff/shelters', 'Shelter management', Tent],
  ['/staff/volunteers', 'Volunteer coordination', Users],
  ['/staff/crises', 'Crises & public alerts', Siren],
] as const;
export function AppLayout({
  mode = 'citizen',
}: {
  mode?: 'citizen' | 'staff' | 'volunteer' | 'admin';
}) {
  const { user, logout } = useAuth(),
    { t } = useTranslation();
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
    mode === 'staff'
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
        )
      : mode === 'admin'
        ? ([['/admin', 'Administration', ShieldCheck]] as const)
        : mode === 'volunteer'
          ? ([
              ['/volunteer', 'My assignments', Users],
              ['/app/profile', t('profile'), Settings],
            ] as const)
          : citizenNav;
  return (
    <div className="workspace">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <Brand />
        <div className="sidebar-caption">
          {mode === 'citizen'
            ? t('communityTag')
            : mode === 'staff'
              ? 'OPERATIONS WORKSPACE'
              : mode === 'admin'
                ? 'SYSTEM ADMINISTRATION'
                : 'VOLUNTEER WORKSPACE'}
        </div>
        <nav aria-label="Workspace navigation">
          {nav.map(([path, label, Icon]) => (
            <NavLink key={path} to={path} end onClick={() => setOpen(false)}>
              <Icon size={20} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="care-note">
            <HeartHandshake />
            <strong>{t('careTag')}</strong>
            <small>{t('demoShort')}</small>
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
          <button className="mobile-menu" aria-label={t('menu')} onClick={() => setOpen(!open)}>
            <Menu />
          </button>
          <Link to="/" className="back-public">
            ← {t('home')}
          </Link>
          <div className="header-actions">
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
        <div className="workspace-demo">{t('demo')}</div>
        <main id="main" className="workspace-content">
          <Outlet />
        </main>
      </div>
      {open && (
        <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setOpen(false)} />
      )}
    </div>
  );
}
