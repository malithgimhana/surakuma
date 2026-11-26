import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock,
  Hourglass,
  Layers3,
  Sparkles,
  Truck,
  Upload,
  UserRound,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { get } from './api';
import { useAuth } from './auth';
import { caseManagerProfileHref } from './countryScope';
import { Badge, Card, Empty, ErrorState, formatDate, Loading } from './components';
import { caseQueueUrl, useCaseManagerOverview } from './CaseManagerQueue';
import { awaitingUnit, CaseLink, CategoryIcon, PanelTitle, UnitWarning } from './CaseManagerUi';
import type { Category } from './types';
import type { ReactNode } from 'react';

const kpis = [
  ['assigned', 'My assigned cases', 'open', ClipboardList, 'blue'],
  ['verification', 'Awaiting verification', 'verification', Hourglass, 'amber'],
  ['critical', 'Critical requests', 'critical', AlertTriangle, 'coral'],
  ['overdue', 'Overdue cases (>24h)', 'overdue', Clock, 'amber'],
  ['ai', 'AI reviews pending', 'pending-ai', Sparkles, 'violet'],
  ['escalated', 'Escalations', 'escalated', Upload, 'mint'],
] as const;
const colors: Record<Category, string> = {
  Shelter: '#3e8bf5',
  FoodWater: '#ff786b',
  Medical: '#be8ff4',
  Transportation: '#72c7ff',
  Accessibility: '#94e5c7',
  Other: '#ffc964',
};
const decisionLabels: Record<string, string> = {
  Approve: 'Approved advice',
  Modify: 'Modified advice',
  Reject: 'Rejected advice',
  Defer: 'Deferred advice',
};

type Availability = { id: string; availableForAssignment: boolean };
function AssignmentStatus() {
  const { user } = useAuth();
  const availability = useQuery({
    queryKey: ['case-manager-availability', user?.id],
    queryFn: () => get<Availability[]>('/case-manager/availability'),
  });
  const count = availability.data?.filter((grant) => grant.availableForAssignment).length ?? 0;
  const state = availability.error
    ? 'Unavailable to load'
    : availability.isPending
      ? 'Loading…'
      : count > 0
        ? count === availability.data?.length
          ? 'Available'
          : 'Partly available'
        : 'Unavailable';
  return (
    <Link className="cm-availability-chip" data-available={count > 0} to={caseManagerProfileHref}>
      <span aria-hidden="true" />
      Case assignment: <strong>{state}</strong>
      <ChevronDown size={16} aria-hidden="true" />
    </Link>
  );
}

function ageLabel(createdAt: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).valueOf()) / 60000));
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d ago`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ago`;
  return minutes >= 1 ? `${minutes}m ago` : 'Just now';
}

export default function CaseManagerOverview({ roleControl }: { roleControl?: ReactNode }) {
  const { t } = useTranslation();
  const overview = useCaseManagerOverview();
  const data = overview.data;
  const metric = (key: string) => data?.metrics?.[key] ?? 0;
  const needs = data?.needs ?? [];
  const totalPeople = needs.reduce((sum, item) => sum + item.householdMembers, 0);
  return (
    <div className="cm-page cm-overview">
      <header className="cm-page-header">
        <div>
          <h1>Case Manager Overview</h1>
          <p>Manage assigned cases, review citizen needs, and coordinate assistance.</p>
        </div>
        <div className="cm-overview-controls">
          <AssignmentStatus />
          {roleControl}
        </div>
      </header>
      {overview.isPending ? (
        <Loading />
      ) : overview.error ? (
        <ErrorState error={overview.error} retry={() => void overview.refetch()} />
      ) : !data?.hasAccess ? (
        <Empty title="No Case Manager assignment available" />
      ) : (
        <>
          <div className="cm-kpis" aria-label="Case Manager indicators">
            {kpis.map(([key, title, view, Icon, tone]) => (
              <Link to={caseQueueUrl(view)} data-tone={tone} key={key}>
                <Icon size={30} aria-hidden="true" />
                <strong>{metric(key).toLocaleString()}</strong>
                <span>{title}</span>
              </Link>
            ))}
          </div>
          <div className="cm-overview-main">
            <Card className="cm-panel">
              <PanelTitle
                icon={Layers3}
                title="Citizen Needs Summary"
                description="Assistance requests from your assigned cases"
                action={<Link className="cm-context-tag" to={caseQueueUrl()}>Open cases</Link>}
              />
              {needs.length ? (
                <div className="cm-needs-breakdown">
                  <div className="cm-donut" aria-hidden="true" inert>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart accessibilityLayer={false}>
                        <Pie
                          data={needs}
                          dataKey="householdMembers"
                          nameKey="category"
                          innerRadius="67%"
                          outerRadius="95%"
                          isAnimationActive={false}
                          stroke="none"
                          startAngle={90}
                          endAngle={-270}
                        >
                          {needs.map((item) => (
                            <Cell key={item.category} fill={colors[item.category]} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div>
                      <strong>{totalPeople.toLocaleString()}</strong>
                      <span>
                        Household
                        <br />
                        members
                      </span>
                    </div>
                  </div>
                  <span className="sr-only">
                    {totalPeople.toLocaleString()} household members counted across open requests.
                  </span>
                  <div className="table-wrap cm-breakdown-table">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Assistance</th>
                          <th scope="col">Cases</th>
                          <th scope="col">Members</th>
                          <th scope="col">Critical</th>
                        </tr>
                      </thead>
                      <tbody>
                        {needs.map((item) => (
                          <tr key={item.category}>
                            <th scope="row">
                              <Link to={caseQueueUrl('open', item.category)}>
                                <span
                                  aria-hidden="true"
                                  style={{ background: colors[item.category] }}
                                />
                                {t('category.' + item.category)}
                              </Link>
                            </th>
                            <td>{item.cases}</td>
                            <td>{item.householdMembers.toLocaleString()}</td>
                            <td>{item.critical}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="cm-chart-note">
                    Household members are counted per request and may appear more than once.
                  </p>
                </div>
              ) : (
                <p className="cm-empty-note">No open cases to summarise.</p>
              )}
            </Card>
            <Card className="cm-panel cm-attention">
              <PanelTitle
                icon={Bell}
                title="Needs Your Attention"
                description="New submissions and time-sensitive cases, newest first."
                action={
                  <Link className="cm-text-link" to={caseQueueUrl('history')}>
                    View all cases <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                }
              />
              {data.attention?.length ? (
                <div
                  className="table-wrap cm-table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Cases needing attention"
                >
                  <table>
                    <thead>
                      <tr>
                        {[
                          'Reference',
                          'Requested assistance',
                          'People',
                          'Priority',
                          'Status',
                          'Age',
                          'Action',
                        ].map((label) => (
                          <th key={label} scope="col">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.attention.map((request) => (
                        <tr key={request.id}>
                          <th scope="row">
                            {request.reference}
                            {request.escalated && <small>Escalated</small>}
                          </th>
                          <td>
                            <div className="cm-case-category">
                              <CategoryIcon category={request.category} />
                              <div>
                                {t('category.' + request.category)}
                                {awaitingUnit(request) && <UnitWarning />}
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="cm-inline">
                              <UserRound size={16} aria-hidden="true" />
                              {request.householdSize}
                            </span>
                          </td>
                          <td>
                            <Badge value={request.priority} />
                          </td>
                          <td>
                            <Badge value={request.status} />
                          </td>
                          <td>
                            <time
                              dateTime={request.createdAt}
                              title={formatDate(request.createdAt)}
                            >
                              {ageLabel(request.createdAt)}
                            </time>
                          </td>
                          <td>
                            <CaseLink
                              id={request.id}
                              reference={request.reference}
                              queue={caseQueueUrl('history')}
                            >
                              Review
                            </CaseLink>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="cm-empty-note">
                  No assigned cases currently need priority attention.
                </p>
              )}
            </Card>
          </div>
          <div className="cm-overview-bottom">
            <Card className="cm-panel">
              <PanelTitle
                icon={CheckCircle2}
                title="Recent Decisions"
                description="Your latest recorded AI review decisions."
                action={
                  <Link to={caseQueueUrl('history')} className="cm-text-link">
                    Case history <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                }
              />
              {data.decisions?.length ? (
                <ul className="cm-decision-list">
                  {data.decisions.map((decision, index) => (
                    <li key={`${decision.id}-${decision.createdAt}-${index}`}>
                      <CheckCircle2 size={19} aria-hidden="true" />
                      <div>
                        <Link to={`/staff/cases/${decision.id}#ai-history`}>
                          {decision.reference}
                        </Link>
                        <span>
                          {decisionLabels[decision.action] ?? decision.action} ·{' '}
                          {t('category.' + decision.category)}
                        </span>
                      </div>
                      <time dateTime={decision.createdAt}>{formatDate(decision.createdAt)}</time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cm-empty-note">
                  You haven’t recorded any AI review decisions on these cases.
                </p>
              )}
            </Card>
            <Card className="cm-panel">
              <PanelTitle
                icon={Layers3}
                title="My Workload"
                description="Share of your assigned open cases."
              />
              <div className="cm-workload">
                {(
                  [
                    ['assigned', 'Assigned open cases', ClipboardList, 'blue'],
                    ['verification', 'Under review', Hourglass, 'violet'],
                    ['overdue', 'Overdue (>24h)', Clock, 'coral'],
                  ] as const
                ).map(([key, label, Icon, tone]) => {
                  const percent =
                    metric('assigned') > 0
                      ? Math.round((metric(key) / metric('assigned')) * 100)
                      : null;
                  return (
                    <div key={key} data-tone={tone}>
                      <Icon size={24} aria-hidden="true" />
                      <strong>{metric(key)}</strong>
                      <div>
                        <span>{label}</span>
                        {percent !== null && (
                          <progress max={100} value={percent} aria-label={label} />
                        )}
                      </div>
                      {percent !== null && <small>{percent}%</small>}
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card className="cm-panel">
              <PanelTitle
                icon={Zap}
                title="Quick Actions"
                description="Common tasks for case management."
              />
              <div className="cm-quick-actions">
                {(
                  [
                    ['Review cases', 'open', ClipboardList],
                    ['View fulfilment cases', 'fulfilment', Truck],
                    ['Manage follow-ups', 'follow-ups', CalendarDays],
                    ['View escalations', 'escalated', ArrowUpRight],
                  ] as const
                ).map(([label, view, Icon]) => (
                  <Link key={view} to={caseQueueUrl(view)}>
                    <Icon size={22} aria-hidden="true" />
                    <span>{label}</span>
                  </Link>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
