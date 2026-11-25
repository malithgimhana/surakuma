import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowRight, Boxes, Clock, ClipboardList, Flag, History, MapPin, Radio, Siren, Tent, Users } from 'lucide-react';
import { get } from './api';
import { Card, Empty, ErrorState, formatDate, IconTile, Loading, PageHeader } from './components';
import { coordinatorPath } from './countryScope';
import { countryPath, dashboardRefreshInterval } from './crisisOperationsApi';
import { useCountries, useCountry } from './geography';
import { useShelterSnapshot } from './ShelterDashboard';
import type { AidRequest, Crisis, VolunteerData } from './types';

type Attention = Pick<AidRequest, 'id' | 'reference' | 'category' | 'status' | 'locationText' | 'escalated'> & {
  critical: boolean;
  shortage: boolean;
  overdue: boolean;
  awaitingAuthorization: boolean;
};
type AssignedCrisis = Pick<Crisis, 'id' | 'name' | 'active' | 'type' | 'district'> & { centre?: string; openCases: number };
type Activity = { id: string; entityId: string; entityType: string; action: string; createdAt: string; reference?: string; crisis?: string };
type Overview = {
  hasAccess: boolean;
  metrics?: Record<string, number>;
  crises?: AssignedCrisis[];
  attention?: Attention[];
  activity?: Activity[];
};

export type CoordinatorVolunteersData = VolunteerData & {
  caseReferences: Record<string, string>;
  overdueTaskIds: string[];
};

export const coordinatorCase = (id: string) => coordinatorPath('/cases/' + id);
export const coordinatorCases = (view?: string) => coordinatorPath('/cases', view ? { view } : {});
export const coordinatorCrisis = (id: string) => coordinatorPath('/crises', { crisisId: id });

export function useCoordinatorOverview(country: string, enabled = true) {
  return useQuery({
    queryKey: ['staff-overview', country, 'Coordinator'],
    queryFn: () => get<Overview>(countryPath('/staff/overview/Coordinator', country)),
    enabled,
    refetchInterval: dashboardRefreshInterval,
  });
}

export function useCoordinatorVolunteers(country: string, enabled = true) {
  return useQuery({
    queryKey: ['coordinator-volunteers', country],
    queryFn: () => get<CoordinatorVolunteersData>(countryPath('/volunteers', country, { staffRole: 'Coordinator' })),
    enabled,
    refetchInterval: dashboardRefreshInterval,
  });
}

export type CoordinatorMetric = {
  label: string;
  value?: number;
  to?: string;
  icon: typeof Siren;
  tone?: string;
};

export function CoordinatorMetrics({ items, label = 'Summary' }: { items: CoordinatorMetric[]; label?: string }) {
  return <section className="coord-metrics" aria-label={label}>
    {items.map(({ label, value, to, icon, tone = 'blue' }) => {
      const content = <>
        <IconTile icon={icon} tone={tone} />
        <span><span className="coord-metric-label">{label}</span>
          <strong>{value?.toLocaleString() ?? <span aria-label="Unavailable">—</span>}</strong></span>
        {to && <ArrowRight className="coord-metric-arrow" size={16} aria-hidden="true" />}
      </>;
      return to ? <Link key={label} className="card coord-metric" to={to}>{content}</Link> :
        <Card key={label} className="coord-metric">{content}</Card>;
    })}
  </section>;
}

export function CoordinatorPanel({ title, action, children, className = '' }: {
  title: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return <Card className={`coord-panel ${className}`}>
    <div className="coord-panel-heading"><h2>{title}</h2>{action}</div>
    {children}
  </Card>;
}

function count(value: number | undefined) { return value?.toLocaleString() ?? '—'; }

export default function CoordinatorOverview({ roleControl, assigned }: { roleControl?: ReactNode; assigned: boolean }) {
  const country = useCountry();
  const { t } = useTranslation();
  const countries = useCountries();
  const overview = useCoordinatorOverview(country, assigned);
  const shelters = useShelterSnapshot(country, false, !!overview.data?.hasAccess, true);
  const volunteers = useCoordinatorVolunteers(country, !!overview.data?.hasAccess);
  const metrics = overview.data?.metrics;
  const active = overview.data?.crises?.filter(crisis => crisis.active)
    .sort((left, right) => right.openCases - left.openCases || left.name.localeCompare(right.name));
  const shelterStats = shelters.data?.statistics;
  const tasks = volunteers.data?.tasks;
  const countryName = countries.data?.find(value => value.code === country)?.name;
  return <div className="coord-page">
    <PageHeader title="Crisis command centre" description={assigned ? countryName ?? country : undefined}
      action={<>{roleControl}{assigned && <Link className="button primary" to={coordinatorCases('critical')}>View priority cases <ArrowRight size={17} /></Link>}</>} />
    {!assigned ? <Empty title="Coordinator assignment needs attention" description="An administrator can assign an operating country and response scope." /> :
      overview.isPending ? <Loading /> : overview.error ? <ErrorState error={overview.error} retry={() => void overview.refetch()} /> :
      !overview.data.hasAccess ? <Empty title="No coordinator assignment in this country" /> : <>
        <CoordinatorMetrics label="Coordination priorities" items={[
          { label: 'Assigned crises', value: metrics?.crises, icon: Siren, to: coordinatorPath('/crises') },
          { label: 'Critical cases', value: metrics?.critical, icon: AlertTriangle, tone: 'red', to: coordinatorCases('critical') },
          { label: 'Cases with stock shortages', value: metrics?.shortages, icon: Boxes, tone: 'amber', to: coordinatorCases('shortages') },
          { label: 'Overdue cases', value: metrics?.overdue, icon: Clock, tone: 'coral', to: coordinatorCases('overdue') },
        ]} />
        <div className="coord-overview-grid">
          <CoordinatorPanel title="Priority action queue" action={<Link to={coordinatorCases()}>View cases <ArrowRight size={15} /></Link>}>
            {overview.data.attention?.length ? <ul className="coord-action-list">
              {overview.data.attention.map(row => <li key={row.id}>
                <Link to={coordinatorCase(row.id)}>
                  <IconTile icon={row.critical ? Siren : row.shortage ? Boxes : row.escalated ? Flag : row.overdue ? Clock : ClipboardList}
                    tone={row.critical ? 'red' : row.shortage || row.overdue ? 'amber' : 'blue'} />
                  <span><strong>{row.reference} · {t('category.' + row.category)}</strong><small>{row.locationText || row.status}</small>
                    <span className="coord-case-flags">{[
                      row.critical && 'Critical', row.escalated && 'Escalated', row.shortage && 'Stock shortage',
                      row.overdue && 'Overdue', row.awaitingAuthorization && 'Fulfilment authorization',
                    ].filter(Boolean).join(' · ')}</span></span>
                  <ArrowRight size={17} aria-hidden="true" />
                </Link>
              </li>)}
            </ul> : <p className="muted">{overview.data.attention ? 'No cases require priority action.' : 'Priority actions unavailable.'}</p>}
          </CoordinatorPanel>
          <CoordinatorPanel title="Active response events" className="coord-response-panel"
            action={<Link to={coordinatorPath('/crises')}>All events <ArrowRight size={15} /></Link>}>
            {active?.length ? <ul className="coord-response-list">{active.map(crisis => <li key={crisis.id}>
              <div className="coord-response-heading">
                <IconTile icon={Radio} tone="blue" />
                <div><h3>{crisis.name}</h3>
                  <p className="inline"><MapPin size={14} />{[crisis.type, crisis.district].filter(Boolean).join(' · ')}</p></div>
                <span className="coord-status green">Active</span>
              </div>
              <dl className="coord-response-facts">
                <div><dt>Response centre</dt><dd>{crisis.centre ?? 'Unassigned'}</dd></div>
                <div><dt>Open cases</dt><dd>{count(crisis.openCases)}</dd></div>
              </dl>
              <Link className="coord-response-link" to={coordinatorCrisis(crisis.id)}>Manage response <ArrowRight size={16} /></Link>
            </li>)}</ul> : <p className="muted">{active ? 'No active response events are assigned.' : 'Response events unavailable.'}</p>}
          </CoordinatorPanel>
        </div>
        <CoordinatorPanel title="Operational summary">
          <CoordinatorMetrics items={[
            { label: 'Unassigned cases', value: metrics?.unassigned, icon: ClipboardList, to: coordinatorCases('unassigned') },
            { label: 'Pending escalations', value: metrics?.escalated, icon: Flag, tone: 'amber', to: coordinatorCases('escalated') },
            { label: 'Shelter capacity warnings', value: shelterStats?.attention ?? metrics?.pressure, icon: Tent, tone: 'amber', to: coordinatorPath('/shelters', { view: 'attention' }) },
            { label: 'Open cases with a case manager', value: metrics?.assignments, icon: Users, tone: 'green', to: coordinatorCases('assigned') },
          ]} />
        </CoordinatorPanel>
        <div className="coord-overview-grid coord-overview-summaries">
          <CoordinatorPanel title="Shelter readiness" action={<Link to={coordinatorPath('/shelters')}>View shelters <ArrowRight size={15} /></Link>}>
            {shelters.isPending ? <Loading /> : shelters.error ? <ErrorState error={shelters.error} retry={() => void shelters.refetch()} /> :
              <dl className="coord-facts"><div><dt>Registered shelters</dt><dd>{count(shelterStats?.total)}</dd></div>
                <div><dt>Available spaces</dt><dd>{count(shelterStats?.available)}</dd></div>
                <div><dt>Pending arrivals</dt><dd>{count(shelterStats?.pendingArrivals)}</dd></div></dl>}
          </CoordinatorPanel>
          <CoordinatorPanel title="Volunteer progress" action={<Link to={coordinatorPath('/volunteers')}>View assignments <ArrowRight size={15} /></Link>}>
            {volunteers.isPending ? <Loading /> : volunteers.error ? <ErrorState error={volunteers.error} retry={() => void volunteers.refetch()} /> :
              <dl className="coord-facts"><div><dt>In progress</dt><dd>{count(tasks?.filter(t => t.status === 'InProgress').length)}</dd></div>
                <div><dt>Completed</dt><dd>{count(tasks?.filter(t => t.status === 'Completed').length)}</dd></div>
                <div><dt>Overdue</dt><dd>{count(volunteers.data.overdueTaskIds?.length)}</dd></div></dl>}
          </CoordinatorPanel>
        </div>
        <CoordinatorPanel title="Recent activity" action={<History size={19} aria-hidden="true" />}>
          {overview.data.activity?.length ? <ul className="coord-activity-list">{overview.data.activity.map(row => <li key={row.id}>
            <Link to={row.entityType === 'Crisis' ? coordinatorCrisis(row.entityId) : coordinatorCase(row.entityId)}>
              <strong>{row.reference ?? row.crisis ?? 'Open record'}</strong> · {row.action.replace(/([a-z])([A-Z])/g, '$1 $2')}
            </Link><time dateTime={row.createdAt}>{formatDate(row.createdAt)}</time>
          </li>)}</ul> : <p className="muted">{overview.data.activity ? 'No recent activity in assigned cases or responses.' : 'Recent activity unavailable.'}</p>}
        </CoordinatorPanel>
      </>}
  </div>;
}
