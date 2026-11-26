import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarDays,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Layers3,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { get } from './api';
import { caseManagerProfileHref } from './countryScope';
import { Badge, Card, Empty, ErrorState, Loading, categories } from './components';
import { awaitingUnit, caseAmounts, CaseLink, CategoryIcon, UnitWarning } from './CaseManagerUi';
import { useCountry } from './geography';
import { intakeLabel } from './CitizenIntakeFields';
import { AssessmentBadge } from './CitizenTriageCard';
import type { AidRequest, Page } from './types';

export const caseTabs = [
  {
    view: 'open',
    metric: 'assigned',
    title: 'My cases',
    label: 'My assigned cases',
    icon: Layers3,
    tile: FolderOpen,
    tone: 'blue',
  },
  {
    view: 'critical',
    metric: 'critical',
    title: 'Critical',
    label: 'Critical requests',
    icon: AlertTriangle,
    tile: AlertTriangle,
    tone: 'coral',
  },
  {
    view: 'verification',
    metric: 'verification',
    title: 'Needs verification',
    label: 'Needs verification',
    icon: ShieldCheck,
    tile: ShieldCheck,
    tone: 'amber',
  },
  {
    view: 'pending-ai',
    metric: 'ai',
    title: 'AI review pending',
    label: 'AI review pending',
    icon: Sparkles,
    tile: Sparkles,
    tone: 'violet',
  },
  {
    view: 'follow-ups',
    metric: 'followUps',
    title: 'Follow-ups',
    label: 'Follow-ups',
    icon: CalendarDays,
    tile: CalendarDays,
    tone: 'blue',
  },
] as const;

const extraViews: Record<string, string> = {
  overdue: 'Assigned cases open longer than 24 hours',
  escalated: 'Assigned cases with an open escalation',
  fulfilment: 'Assigned cases in fulfilment',
  history: 'All assigned cases, including closed cases',
  team: 'All cases within your authorised centre and crisis scope',
};
const statuses = [
  'Submitted',
  'UnderReview',
  'Verified',
  'Approved',
  'InProgress',
  'PartiallyFulfilled',
  'Fulfilled',
  'Closed',
  'Rejected',
  'Cancelled',
];
const endedStatuses = ['Fulfilled', 'Closed', 'Rejected', 'Cancelled'];
const priorities = ['Critical', 'Urgent', 'High', 'Medium', 'Low', 'Normal'];

type OverviewAttention = Pick<
  AidRequest,
  | 'id'
  | 'reference'
  | 'category'
  | 'householdSize'
  | 'priority'
  | 'status'
  | 'createdAt'
  | 'unit'
  | 'escalated'
>;
export interface CaseManagerOverviewData {
  hasAccess: boolean;
  metrics?: Record<string, number>;
  decisions?: {
    id: string;
    reference: string;
    category: AidRequest['category'];
    action: string;
    createdAt: string;
  }[];
  needs?: {
    category: AidRequest['category'];
    cases: number;
    householdMembers: number;
    critical: number;
  }[];
  attention?: OverviewAttention[];
  regions?: { id: string; name: string; levelName: string }[];
}

export function useCaseManagerOverview(enabled = true) {
  const country = useCountry();
  return useQuery({
    queryKey: ['staff-overview', country, 'CaseManager'],
    queryFn: () => get<CaseManagerOverviewData>('/staff/overview/CaseManager'),
    enabled,
  });
}

export function caseQueueUrl(view = 'open', category?: string) {
  const params = new URLSearchParams({ role: 'CaseManager', view });
  if (category) params.set('category', category);
  return `/staff/cases?${params}`;
}

export function CaseManagerQueue() {
  const { t } = useTranslation();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const country = useCountry();
  const overview = useCaseManagerOverview();
  const requestedView =
    params.get('view') ?? (params.get('status') === 'UnderReview' ? 'verification' : 'open');
  const view =
    caseTabs.some((tab) => tab.view === requestedView) || Object.hasOwn(extraViews, requestedView)
      ? requestedView
      : 'open';
  const search = params.get('search') ?? '';
  const category = params.get('category') ?? '';
  const priority = params.get('priority') ?? '';
  const status = params.get('status') ?? '';
  const regionId = params.get('regionId') ?? '';
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
  const query = useQuery({
    queryKey: [
      'cases',
      'CaseManager',
      country,
      view,
      search.trim(),
      category,
      priority,
      status,
      regionId,
      page,
    ],
    refetchInterval: 60000,
    queryFn: () => {
      const request = new URLSearchParams({
        staffRole: 'CaseManager',
        assignedToMe: String(view !== 'team'),
        page: String(page),
      });
      if (view !== 'team' && view !== 'history') request.set('view', view);
      for (const [key, value] of Object.entries({
        search: search.trim(),
        category,
        priority,
        status,
        regionId,
      })) {
        if (value) request.set(key, value);
      }
      return get<Page<AidRequest>>(`/requests?${request}`);
    },
    placeholderData: keepPreviousData,
  });
  const setFilter = (key: string, value: string) =>
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        // Keep the active queue explicit when changing a legacy status deep link.
        next.set(
          'view',
          view === 'open' && key === 'status' && endedStatuses.includes(value) ? 'history' : view,
        );
        if (value) next.set(key, value);
        else next.delete(key);
        next.delete('page');
        return next;
      },
      { replace: key === 'search' },
    );
  const setPage = (number: number) =>
    setParams((old) => {
      const next = new URLSearchParams(old);
      next.set('page', String(number));
      return next;
    });
  const data = query.data;
  const pageCount = data ? Math.ceil(data.total / data.pageSize) : 0;
  const navPages = data
    ? [data.pageNumber - 1, data.pageNumber, data.pageNumber + 1].filter(
        (number) => number > 0 && number <= pageCount,
      )
    : [];
  const queue = location.pathname + location.search;
  return (
    <div className="cm-page cm-queue">
      <header className="cm-page-header">
        <div>
          <h1>Cases &amp; AI Review</h1>
          <p>Review assigned cases, verify citizen needs, use AI support, and take action.</p>
        </div>
      </header>
      <nav className="cm-queue-tabs" aria-label="Case queues">
        {caseTabs.map(({ view: tab, title, icon: Icon, metric, tone }) => (
          <Link
            key={tab}
            to={caseQueueUrl(tab)}
            data-tone={tone}
            aria-current={view === tab ? 'page' : undefined}
          >
            <Icon size={24} aria-hidden="true" />
            <span>
              {title} ({overview.data?.metrics?.[metric] ?? '—'})
            </span>
          </Link>
        ))}
      </nav>
      <div className="cm-queue-stats" aria-label="Assigned case workload">
        {caseTabs.map(({ view: tab, label, tile: Icon, metric, tone }) => (
          <Link to={caseQueueUrl(tab)} key={tab} data-tone={tone}>
            <span className="cm-stat-icon">
              <Icon size={28} aria-hidden="true" />
            </span>
            <span>
              <strong>{overview.data?.metrics?.[metric] ?? '—'}</strong>
              <small>{label}</small>
            </span>
          </Link>
        ))}
      </div>
      {overview.error && (
        <ErrorState error={overview.error} retry={() => void overview.refetch()} />
      )}
      <div className="cm-queue-filters" data-region={!!overview.data?.regions?.length}>
        <label className="search-field">
          <Search size={19} aria-hidden="true" />
          <input
            aria-label="Search cases"
            placeholder="Search reference, request description, or location…"
            value={search}
            onChange={(event) => setFilter('search', event.target.value)}
          />
        </label>
        <select
          aria-label="Assistance category"
          value={category}
          onChange={(e) => setFilter('category', e.target.value)}
        >
          <option value="">All assistance types</option>
          {categories.map((item) => (
            <option key={item} value={item}>
              {t('category.' + item)}
            </option>
          ))}
        </select>
        <select
          aria-label="Priority"
          value={priority}
          onChange={(e) => setFilter('priority', e.target.value)}
        >
          <option value="">All priorities</option>
          {priorities.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => setFilter('status', e.target.value)}
        >
          <option value="">All statuses</option>
          {statuses.map((item) => (
            <option key={item} value={item}>
              {t('status.' + item)}
            </option>
          ))}
        </select>
        {!!overview.data?.regions?.length && (
          <select
            aria-label="Administrative region"
            value={regionId}
            onChange={(e) => setFilter('regionId', e.target.value)}
          >
            <option value="">All regions</option>
            {overview.data.regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.name} · {region.levelName}
              </option>
            ))}
          </select>
        )}
      </div>
      {Object.hasOwn(extraViews, view) && (
        <p className="cm-queue-context">
          <ClipboardList size={16} aria-hidden="true" />
          {extraViews[view]} <Link to={caseQueueUrl()}>Back to my open cases</Link>
        </p>
      )}
      {view === 'follow-ups' && (
        <p className="cm-queue-context">
          Unresolved problems reported by citizens, including after delivery or case closure.
        </p>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          {data?.items.length ? (
            <Card className="cm-panel cm-table-card">
              <div
                className="table-wrap cm-table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Cases matching the selected filters"
                aria-busy={query.isFetching}
              >
                <table className="cm-case-table">
                  <thead>
                    <tr>
                      {[
                        'Reference',
                        'Requested assistance',
                        'People affected',
                        'Quantity needed',
                        'Outstanding',
                        'Priority',
                        'Score',
                        'AI assessment',
                        'Status',
                        'Location',
                        'Action',
                      ].map((label) => (
                        <th key={label} scope="col">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((request) => {
                      const amounts = caseAmounts(request);
                      return (
                        <tr
                          key={request.id}
                          className={awaitingUnit(request) ? 'cm-clarification-row' : undefined}
                        >
                          <th scope="row">
                            {request.reference}
                            {request.escalated && <small>Escalated</small>}
                          </th>
                          <td>
                            <div className="cm-case-category">
                              <CategoryIcon category={request.category} />
                              <div>
                                <strong>{intakeLabel(request.category, request.intake) ?? t('category.' + request.category)}</strong>
                                <small className="cm-case-description">{request.description}</small>
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
                          <td>{amounts.requested}</td>
                          <td>{amounts.outstanding}</td>
                          <td>
                            <Badge value={request.priority} />
                            {request.immediateDanger && <small className="field-error">Immediate danger</small>}
                          </td>
                          <td>{request.priorityScore ?? '—'}
                            {request.priorityScore != null && request.intakeScore != null && request.priorityScore > request.intakeScore &&
                              <small>+{request.priorityScore - request.intakeScore} for waiting</small>}
                          </td>
                          <td><AssessmentBadge state={request.assessmentState} /></td>
                          <td>
                            <Badge value={request.status} />
                          </td>
                          <td>
                            {request.locationText ? (
                              <span className="cm-inline">
                                <MapPin size={16} aria-hidden="true" />
                                {request.locationText}
                              </span>
                            ) : (
                              'Not recorded'
                            )}
                          </td>
                          <td>
                            <CaseLink id={request.id} reference={request.reference} queue={queue}>
                              Review case
                            </CaseLink>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <Card className="cm-panel">
              <Empty
                title="No matching cases"
                description="Try changing the queue or clearing one of the filters."
              />
            </Card>
          )}
          {!!data?.total && (
            <div className="cm-pagination">
              <p aria-live="polite">
                Showing {(data.pageNumber - 1) * data.pageSize + 1}–
                {Math.min(data.pageNumber * data.pageSize, data.total)} of {data.total} cases
              </p>
              <nav aria-label="Case pages">
                <button
                  disabled={data.pageNumber <= 1 || query.isPlaceholderData}
                  onClick={() => setPage(data.pageNumber - 1)}
                >
                  <ChevronLeft size={16} aria-hidden="true" /> Previous
                </button>
                {navPages.map((number) => (
                  <button
                    key={number}
                    aria-label={`Page ${number}`}
                    aria-current={number === data.pageNumber ? 'page' : undefined}
                    disabled={query.isPlaceholderData}
                    onClick={() => setPage(number)}
                  >
                    {number}
                  </button>
                ))}
                <button
                  disabled={data.pageNumber >= pageCount || query.isPlaceholderData}
                  onClick={() => setPage(data.pageNumber + 1)}
                >
                  Next <ChevronRight size={16} aria-hidden="true" />
                </button>
              </nav>
            </div>
          )}
        </>
      )}
      <nav className="cm-secondary-links" aria-label="Additional case views">
        <Link to={caseQueueUrl('history')}>All my cases, including closed</Link>
        <Link to={caseQueueUrl('team')}>All cases in my scope</Link>
        <Link to={caseQueueUrl('escalated')}>Open escalations</Link>
        <Link to={caseManagerProfileHref}>Manage assignment availability</Link>
      </nav>
    </div>
  );
}
