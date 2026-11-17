import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight, Building2, ChevronRight, CircleAlert, CircleCheck, Clock3, FolderOpen, Globe2,
  History, Layers3, Mail, MapPin, Package, Plug, RefreshCw, Server, Tent, TriangleAlert, UserRound, Users, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { get } from './api';
import { formatDate } from './components';
import { CountryFlag, selectCountry, useCountry } from './geography';
import { serviceIcons, stateTones } from './SystemReadiness';
import type { SystemStatus } from './SystemReadiness';
import type { Crisis } from './types';
import './admin-overview.css';

const CrisisMap = lazy(() => import('./AdminCrisisMap'));
const countryOrder = ['LK', 'IN', 'NP'];
const integrationOrder = ['email', 'ai', 'mapping'];
const formatNumber = (value: number) => value.toLocaleString();

interface ReportRow {
  countryCode: string;
  country: string;
  activeCrises: number;
  open: number;
  unassigned: number;
  overdue: number;
  resolved: number;
}

interface PendingWork { count: number; oldestAt: string | null }
interface Readiness {
  stock: { belowThreshold: number; outOfStock: number };
  shelters: { openShelters: number; capacity: number; occupancy: number; reserved: number; available: number };
  partnerVerification: PendingWork;
  systemAccess: PendingWork | null;
}

interface Alert {
  id: string;
  conditionKey: string;
  countryCode: string | null;
  message: string;
  link: string;
  createdAt: string;
  resolvedAt?: string;
}

interface AuditEntry { id: string; action: string; createdAt: string }
interface PriorityAction {
  id: string;
  title: string;
  description: string;
  scope: string;
  date?: string | null;
  category: string;
  tone: string;
  priority: number;
  Icon: LucideIcon;
  to: string;
}

const metrics = [
  { key: 'activeCrises', label: 'Active crises', Icon: TriangleAlert, tone: 'red', to: '/admin/crises', hint: 'View crisis operations' },
  { key: 'open', label: 'Open cases', Icon: FolderOpen, tone: 'blue', to: '/admin/cases?view=open', hint: 'View case queue' },
  { key: 'unassigned', label: 'Unassigned cases', Icon: Users, tone: 'red', to: '/admin?section=cases', hint: 'Review assignments' },
  { key: 'overdue', label: 'Overdue cases', Icon: Clock3, tone: 'amber', to: '/admin/cases?view=overdue', hint: 'Open over 24 hours' },
  { key: 'resolved', label: 'Resolved cases', Icon: CircleCheck, tone: 'green', hint: 'Fulfilled or closed' },
] as const;

function Panel({ title, id, Icon, action, children }: {
  title: string; id: string; Icon: LucideIcon; action?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="overview-panel" aria-labelledby={id}>
      <div className="overview-panel-header">
        <h2 id={id}><Icon size={18} aria-hidden="true" />{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function PanelLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="overview-panel-link" to={to}>{children}<ArrowRight size={13} aria-hidden="true" /></Link>;
}

function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className="overview-badge" data-tone={tone}>{children}</span>;
}

function CrisesPanel({ country, countryName, crises, error }: {
  country: string; countryName: string; crises?: Crisis[]; error: boolean;
}) {
  return (
    <Panel title={`Crisis distribution · ${countryName}`} id="crisis-distribution" Icon={MapPin}>
      <div className={countryOrder.includes(country) ? 'overview-distribution' : undefined}>
        {countryOrder.includes(country) && <div className="overview-map-frame">
          <Suspense fallback={<p className="overview-empty">Loading map…</p>}>
            <CrisisMap country={country} crises={crises ?? []} />
          </Suspense>
          <a className="overview-map-credit" href="https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries-2/"
            target="_blank" rel="noreferrer">Natural Earth</a>
        </div>}
        {!crises?.length ? <p className="overview-empty">{error ? 'Crisis records unavailable.' : crises ? 'No crises to show.' : 'Loading crises…'}</p> : (
          <ul className="overview-crisis-list">
            {crises.map(crisis => (
              <li key={crisis.id}>
                <Link to={`/admin/crises?crisisId=${crisis.id}`}>
                  <MapPin size={15} data-active={crisis.active} aria-hidden="true" />
                  <span><strong>{crisis.name}</strong><small>{crisis.active ? 'Active' : 'Ended'}{crisis.district && ` · ${crisis.district}`}</small></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function queueActions(alerts: Alert[], readiness: Readiness | undefined, country: string): PriorityAction[] {
  const actions: PriorityAction[] = alerts.filter(alert => !alert.resolvedAt).map(alert => {
    const kind = alert.conditionKey?.split(':')[0];
    const core = { id: alert.id, description: alert.message, scope: alert.countryCode ?? 'Global', date: alert.createdAt, to: alert.link };
    switch (kind) {
      case 'manager':
        return { ...core, title: 'Case manager needed', category: 'Urgent', tone: 'red', priority: 0, Icon: UserRound,
          to: alert.link.replace('/staff/cases/', '/admin/cases/') };
      case 'service':
        return { ...core, title: alert.link.endsWith('integrations') ? 'Provider failures' : 'Administrator access alert',
          category: 'Investigate', tone: 'red', priority: 1, Icon: Server };
      case 'unassigned':
        return { ...core, title: 'Case unassigned over one hour', category: 'Urgent', tone: 'red', priority: 2, Icon: TriangleAlert };
      case 'delivery':
        return { ...core, title: 'Citizen email needs review', category: 'Investigate', tone: 'amber', priority: 3, Icon: Mail };
      default:
        return { ...core, title: 'Operational alert', category: 'Review', tone: 'amber', priority: 4, Icon: CircleAlert };
    }
  });
  const partners = readiness?.partnerVerification;
  if (partners?.count) actions.push({
    id: 'partners', title: `${formatNumber(partners.count)} pending partner verification${partners.count === 1 ? '' : 's'}`,
    description: 'Open country verification records.',
    scope: country, date: partners.oldestAt, category: 'Approval', tone: 'blue', priority: 5, Icon: Building2, to: '/admin?section=organisations',
  });
  const approvals = readiness?.systemAccess;
  if (approvals?.count) actions.push({
    id: 'approvals', title: `${formatNumber(approvals.count)} pending System Administrator access request${approvals.count === 1 ? '' : 's'}`,
    description: 'Review requests for platform-wide access.', scope: 'Global', date: approvals.oldestAt,
    category: 'Approval', tone: 'blue', priority: 4, Icon: Users, to: '/admin?section=users#system-administrator-requests',
  });
  if (readiness && (readiness.stock.belowThreshold || readiness.stock.outOfStock)) actions.push({
    id: 'stock', title: 'Inventory needs review',
    description: `${formatNumber(readiness.stock.belowThreshold)} below threshold · ${formatNumber(readiness.stock.outOfStock)} out of stock`,
    scope: country, category: 'Review', tone: 'amber', priority: 6, Icon: Package, to: '/admin/resources',
  });
  return actions.sort((a, b) => a.priority - b.priority || (a.date ?? '').localeCompare(b.date ?? ''));
}

function ResourcesPanel({ readiness, error }: { readiness?: Readiness; error: boolean }) {
  const shelters = readiness?.shelters;
  const stock = readiness?.stock;
  const percentage = shelters?.capacity ? Math.round(shelters.available * 100 / shelters.capacity) : 0;
  return (
    <Panel title="Resources & shelter readiness" id="supply-readiness" Icon={Package}
      action={<PanelLink to="/admin/resources">Logistics</PanelLink>}>
      <div className="overview-readiness">
        <Link to="/admin/resources" className="overview-readiness-card" data-tone={stock?.belowThreshold || stock?.outOfStock ? 'red' : 'blue'}>
          <Package size={23} aria-hidden="true" />
          <span><span>Below stock threshold</span><strong>{stock ? formatNumber(stock.belowThreshold) : '—'}</strong>
            {stock && <Badge tone={stock.outOfStock ? 'red' : 'neutral'}>{formatNumber(stock.outOfStock)} out of stock</Badge>}
          </span>
        </Link>
        <Link to="/admin/shelters" className="overview-readiness-card" data-tone="blue">
          <Tent size={23} aria-hidden="true" />
          <span>
            <span>Available shelter places</span>
            <strong>{shelters ? formatNumber(shelters.available) : '—'}{shelters && <small> / {formatNumber(shelters.capacity)}</small>}</strong>
            {shelters?.capacity ? <span className="overview-progress">
              <progress aria-label="Available share of open shelter capacity" max={shelters.capacity} value={Math.max(0, shelters.available)} />
              <small>{percentage}%</small>
            </span> : null}
            {shelters && <small>{shelters.openShelters ? `${formatNumber(shelters.occupancy)} occupied · ${formatNumber(shelters.reserved)} reserved` : 'No open shelters'}</small>}
          </span>
        </Link>
      </div>
      {error && <p className="overview-empty">Could not load resource and shelter figures.</p>}
    </Panel>
  );
}

function IntegrationsPanel({ status, error }: { status?: SystemStatus; error: boolean }) {
  const queue = status?.notificationQueue;
  const issues = queue?.filter(item => item.state === 'Failed' || item.state === 'Review') ?? [];
  const pending = queue?.filter(item => ['Pending', 'Processing', 'Retry'].includes(item.state))
    .reduce((count, item) => count + item.count, 0) ?? 0;
  return (
    <Panel title="Platform & integrations" id="platform-integrations" Icon={Layers3}
      action={<PanelLink to="/admin?section=integrations">View details</PanelLink>}>
      {status ? <ul className="overview-services">
        {[...status.integrations].sort((a, b) => integrationOrder.indexOf(a.id) - integrationOrder.indexOf(b.id)).map(service => {
          const Icon = serviceIcons[service.id as keyof typeof serviceIcons] ?? Plug;
          return <li key={service.id}><Icon size={16} aria-hidden="true" />
            <span>{service.id === 'email' ? 'Email' : service.id === 'ai' ? 'AI service' : 'Mapping'}<small> · {service.mode}</small></span>
            <Badge tone={stateTones[service.state] ?? 'neutral'}>{service.state === 'Capture' ? 'Capture mode' : service.state}</Badge>
          </li>;
        })}
        <li><Server size={16} aria-hidden="true" /><span>Notification queue
          {issues.length > 0 && <small> · {issues.map(item => `${formatNumber(item.count)} ${item.state === 'Failed' ? 'failed' : 'need review'}`).join(' · ')}</small>}
        </span><Badge tone={issues.length ? 'amber' : 'neutral'}>
          {issues.length ? 'Needs review' : pending ? `${formatNumber(pending)} pending` : queue?.length ? 'No failures' : 'No events'}
        </Badge></li>
      </ul> : <p className="overview-empty">{error ? 'Integration status unavailable.' : 'Loading integration status…'}</p>}
    </Panel>
  );
}

export function AdministrationOverview({ globalAdmin, auditActionLabel }: {
  globalAdmin: boolean; auditActionLabel: (action: string) => string;
}) {
  const country = useCountry();
  const client = useQueryClient();
  const [crisisId, setCrisisId] = useState('');
  const [lastUpdated, setLastUpdated] = useState<number>();
  const [searchParams] = useSearchParams();
  const showAll = searchParams.get('priority') === 'all';
  const connection = useQuery({
    queryKey: ['admin-overview', 'connection'],
    queryFn: () => get<{ status: string }>('/ready'),
  });
  const comparison = useQuery({
    queryKey: ['admin-overview', 'comparison', country],
    queryFn: () => get<{ countries: ReportRow[] }>('/admin/reports?scope=all&countryCode='),
  });
  const filtered = useQuery({
    queryKey: ['admin-overview', 'report', country, crisisId],
    queryFn: () => get<{ countries: ReportRow[] }>(`/admin/reports?${new URLSearchParams({ scope: 'country', countryCode: country, crisisId })}`),
    enabled: !!crisisId,
  });
  const crises = useQuery({
    queryKey: ['admin-overview', 'crises', country],
    queryFn: () => get<Crisis[]>(`/crises?countryCode=${country}`),
  });
  const readiness = useQuery({
    queryKey: ['admin-overview', 'readiness', country],
    queryFn: () => get<Readiness>(`/admin/overview?countryCode=${country}`),
  });
  const alerts = useQuery({
    queryKey: ['admin-overview', 'alerts', country],
    queryFn: () => get<Alert[]>(`/admin/alerts?countryCode=${country}&includeGlobal=true&activeOnly=true`),
  });
  const system = useQuery({
    queryKey: ['admin-system', country],
    queryFn: () => get<SystemStatus>(`/admin/system?countryCode=${country}`),
    enabled: globalAdmin,
  });
  const audit = useQuery({
    queryKey: ['admin-overview', 'audit', country],
    queryFn: () => get<AuditEntry[]>(`/admin/audit?countryCode=${country}&pageSize=5`),
    enabled: globalAdmin,
  });
  const required = [connection, comparison, crises, readiness, alerts, ...(crisisId ? [filtered] : []), ...(globalAdmin ? [system, audit] : [])];
  const updating = required.some(query => query.isFetching);
  const failed = required.some(query => query.isError);
  const completedAt = required.every(query => query.isSuccess) && !updating
    ? Math.max(...required.map(query => query.dataUpdatedAt)) : 0;
  useEffect(() => { if (completedAt) setLastUpdated(completedAt); }, [completedAt]);
  useEffect(() => {
    if (crises.data && crisisId && !crises.data.some(crisis => crisis.id === crisisId)) setCrisisId('');
  }, [crises.data, crisisId]);

  const rows = [...(comparison.data?.countries ?? [])].sort((a, b) => countryOrder.indexOf(a.countryCode) - countryOrder.indexOf(b.countryCode));
  const countryRow = rows.find(row => row.countryCode === country);
  const countryName = countryRow?.country ?? country;
  const counts = crisisId ? filtered.data?.countries.find(row => row.countryCode === country) : countryRow;
  const visibleCrises = crises.data?.filter(crisis => !crisisId || crisis.id === crisisId)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const actions = queueActions(alerts.data ?? [], readiness.data, country);
  const providerFailures = alerts.data?.some(alert => alert.conditionKey?.startsWith('service:') && alert.link.endsWith('integrations'));
  const connected = connection.data?.status === 'ready';
  const health = connection.isError ? 'Data connection check failed' : providerFailures ? 'Provider issues reported'
    : failed ? 'Dashboard data incomplete' : connected ? 'Data connection verified' : 'Checking data connection';
  const caseFilters = crisisId ? `&${new URLSearchParams({ country, crisisId })}` : '';

  return (
    <div className="administrator-dashboard">
      <header className="overview-header">
        <div>
          <h1>{globalAdmin ? 'System Administration' : 'Country administration'}</h1>
          <p>Monitor humanitarian operations, urgent cases and platform readiness across your assigned countries.</p>
        </div>
        <div className="overview-header-actions">
          <Badge tone={providerFailures || failed ? 'amber' : connected ? 'green' : 'neutral'}>
            <span className="overview-status-dot" aria-hidden="true" />{health}
          </Badge>
          <span className="overview-updated" role="status">
            {lastUpdated ? <>Last updated <time dateTime={new Date(lastUpdated).toISOString()}>{formatDate(new Date(lastUpdated).toISOString())}</time></> : 'Awaiting first update'}
          </span>
          <button type="button" className="overview-refresh" disabled={updating} aria-busy={updating}
            onClick={() => void Promise.all(required.map(query => query.refetch()))}>
            <RefreshCw size={15} aria-hidden="true" /> Refresh
          </button>
        </div>
      </header>
      {failed && <p className="overview-update-error" role="status">Some data could not be refreshed. Use Refresh to try again.</p>}

      <ul className="overview-kpis" aria-label="Response figures">
        {metrics.map(metric => {
          const { key, label, Icon, tone, hint } = metric;
          const count = counts?.[key];
          const attention = !!count && (key === 'unassigned' || key === 'overdue');
          const data = <>
            <Icon size={25} aria-hidden="true" />
            <span><span>{label}</span><strong>{count === undefined ? '—' : formatNumber(count)}</strong>
              <small>{hint}{attention && <span className="sr-only"> · Needs attention</span>}</small></span>
          </>;
          const to = 'to' in metric ? metric.to + (key === 'activeCrises' ? '' : caseFilters) : null;
          return <li key={key} data-tone={key === 'unassigned' && !attention ? 'neutral' : tone}>{to ? <Link to={to}>{data}</Link> : <div>{data}</div>}</li>;
        })}
      </ul>

      <label className="overview-crisis-filter">Crisis
        <select value={crisisId} onChange={event => setCrisisId(event.target.value)} disabled={!crises.data?.length}>
          <option value="">All crises{crises.data && ` (${crises.data.length})`}</option>
          {crises.data?.map(crisis => <option key={crisis.id} value={crisis.id}>{crisis.name}</option>)}
        </select>
      </label>

      <div className="overview-grid overview-primary">
        <Panel title="Country operations overview" id="country-operations" Icon={Globe2}>
          {!!rows.length ? <div className="overview-table-scroll" tabIndex={0} role="region" aria-label="Country operations table">
            <table aria-labelledby="country-operations">
              <caption className="sr-only">Attention flags reflect unassigned cases and cases open for more than 24 hours.</caption>
              <thead><tr>{['Country', 'Active', 'Open', 'Unassigned', 'Overdue', 'Attention'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
              <tbody>{rows.map(row => {
                const current = row.countryCode === country;
                const name = <><CountryFlag code={row.countryCode} /><span>{row.country} <small>({row.countryCode})</small></span></>;
                const attention = row.overdue ? 'Overdue' : row.unassigned ? 'Unassigned' : 'No case flags';
                return <tr key={row.countryCode} data-current={current}>
                  <th scope="row">
                    {globalAdmin && !current
                      ? <button type="button" onClick={() => selectCountry(row.countryCode, client)}>{name}</button>
                      : <span aria-current={current ? 'true' : undefined}>{name}</span>}
                  </th>
                  <td>{formatNumber(row.activeCrises)}</td><td>{formatNumber(row.open)}</td>
                  <td>{formatNumber(row.unassigned)}</td><td>{formatNumber(row.overdue)}</td>
                  <td><Badge tone={row.overdue ? 'red' : row.unassigned ? 'amber' : 'neutral'}>{attention}</Badge></td>
                </tr>;
              })}</tbody>
            </table>
          </div> : <p className="overview-empty">{comparison.isError ? 'Country figures unavailable.' : 'Loading country figures…'}</p>}
        </Panel>

        <CrisesPanel country={country} countryName={countryName} crises={visibleCrises} error={crises.isError} />

        <Panel title="Priority action queue" id="priority-actions" Icon={Zap} action={showAll
          ? <PanelLink to="/admin#priority-actions">Show fewer</PanelLink>
          : <PanelLink to="/admin?priority=all#priority-actions">View all</PanelLink>}>
          {actions.length ? <ul className="overview-actions" data-expanded={showAll}>
            {(showAll ? actions : actions.slice(0, 4)).map(({ id, title, description, scope, date, category, tone, Icon, to }) => (
              <li key={id}><Link to={to}>
                <span className="overview-action-icon" data-tone={tone}><Icon size={17} aria-hidden="true" /></span>
                <span className="overview-action-copy">
                  <strong>{title}</strong><small>{description}</small>
                  <small>{scope}{date && <> · <time dateTime={date}>{formatDate(date)}</time></>}</small>
                </span>
                <Badge tone={tone}>{category}</Badge>
                <ChevronRight size={14} aria-hidden="true" />
              </Link></li>
            ))}
          </ul> : <p className="overview-empty">{alerts.isPending || readiness.isPending ? 'Loading priority actions…' : alerts.isError || readiness.isError ? 'Priority actions unavailable.' : 'No unresolved priority actions.'}</p>}
          {showAll && <PanelLink to="/admin?section=alerts">Manage alerts</PanelLink>}
        </Panel>
      </div>

      <div className="overview-grid overview-secondary">
        <ResourcesPanel readiness={readiness.data} error={readiness.isError} />
        {globalAdmin && <>
          <IntegrationsPanel status={system.data} error={system.isError} />
          <Panel title="Recent administrative activity" id="overview-activity" Icon={History}
            action={<PanelLink to="/admin?section=activity#audit-history">View all</PanelLink>}>
            {audit.data?.length ? <ul className="overview-timeline">
              {audit.data.map(item => <li key={item.id}><Link to="/admin?section=activity#audit-history">
                <History size={14} aria-hidden="true" />
                <span><strong>{auditActionLabel(item.action)}</strong><small>{country} · <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></small></span>
              </Link></li>)}
            </ul> : <p className="overview-empty">{audit.isError ? 'Audit history unavailable.' : audit.isPending ? 'Loading activity…' : 'No audit events for this country.'}</p>}
          </Panel>
        </>}
      </div>
    </div>
  );
}
