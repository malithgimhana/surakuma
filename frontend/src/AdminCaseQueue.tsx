import { useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, Building2, Clock, MapPin, TriangleAlert, UserRound, Users } from 'lucide-react';
import { api, get } from './api';
import {
  AdminMetrics,
  AdminPagination,
  AdminPanelHeading,
  AdminScopeField,
  ResetAdminFilters,
  useAdminTabScope,
} from './AdminTabUi';
import { Badge, Button, Card, ErrorState, Field, Loading, PageHeader } from './components';
import type { AidRequest, Lookups } from './types';

type QueueCase = AidRequest & { country: string };
const pageSize = 6;
const hour = 3_600_000;
// The platform's operational reports define overdue as open for more than 24 hours.
const overdueHours = 24;
const filtersDefault = { priority: '', type: '', waiting: '', search: '' };
function waitingTime(ms: number) {
  if (!Number.isFinite(ms)) return 'Unavailable';
  const minutes = Math.floor(ms / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export function AdminCaseQueue({
  globalAdmin,
  crisisId,
}: {
  globalAdmin: boolean;
  crisisId: string | null;
}) {
  const selection = useAdminTabScope(globalAdmin);
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({
    ...filtersDefault,
    search: params.get('reference') ?? '',
  });
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('oldest');
  const scopes = selection.scope
    ? [selection.scope]
    : selection.options.map((option) => option.code);
  const queues = useQueries({
    queries: scopes.map((country) => ({
      queryKey: ['triage', country, selection.scope ? crisisId : null],
      queryFn: async () => {
        const path = selection.scope
          ? crisisId
            ? `/requests/triage?crisisId=${encodeURIComponent(crisisId)}`
            : '/requests/triage'
          : `/requests/triage?countryCode=${encodeURIComponent(country)}`;
        return (await get<AidRequest[]>(path)).map((request) => ({ ...request, country }));
      },
    })),
  });
  const pending =
    queues.some((query) => query.isPending) || (!selection.scope && selection.countries.isPending);
  const error =
    queues.find((query) => query.error)?.error ??
    (!selection.scope ? selection.countries.error : null);
  const queue = queues.flatMap((query) => query.data ?? []);
  const now = Date.now();
  const age = (request: AidRequest) => Math.max(0, now - Date.parse(request.createdAt));
  const critical = (request: AidRequest) =>
    request.priority === 'Critical' && age(request) >= overdueHours * hour;
  const waitingForCentre = queue.filter((request) => !request.organisationId).length;
  const waitingForManager = queue.length - waitingForCentre;
  const overdue = queue.filter(critical).length;
  const oldest = queue[0] ? queue.reduce((max, request) => Math.max(max, age(request)), 0) : null;
  const matched = queue
    .filter(
      (request) =>
        (!filters.priority || request.priority === filters.priority) &&
        (!filters.type ||
          (filters.type === 'centre' ? !request.organisationId : !!request.organisationId)) &&
        (!filters.waiting || age(request) >= Number(filters.waiting) * hour) &&
        request.reference.toLowerCase().includes(filters.search.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        (sort === 'newest' ? age(a) - age(b) : age(b) - age(a)) ||
        a.reference.localeCompare(b.reference),
    );
  const currentPage = Math.min(page, Math.max(1, Math.ceil(matched.length / pageSize)));
  const displayed = matched.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  function changeFilter(name: keyof typeof filters, value: string) {
    setFilters({ ...filters, [name]: value });
    setPage(1);
  }
  const assignment = useMutation({
    mutationFn: ({ request, id }: { request: QueueCase; id: string }) =>
      api.request({
        method: 'post',
        url: `/requests/${request.id}/${request.organisationId ? 'case-manager' : 'reassign'}`,
        data: request.organisationId ? { userId: id } : { organisationId: id },
      }),
    onSuccess: () => client.invalidateQueries(),
  });
  const show = (value: number | string) => (pending || error ? undefined : value);
  return (
    <div className="admin-tab">
      <PageHeader
        title="Unassigned cases"
        description="Review requests waiting for a response centre or case manager."
      />
      <div className="admin-tab-with-rail">
        <div className="admin-tab-stack">
          <AdminMetrics
            items={[
              { label: 'Waiting for centre', value: show(waitingForCentre), icon: Users },
              {
                label: 'Waiting for case manager',
                value: show(waitingForManager),
                icon: UserRound,
              },
              {
                label: 'Critical overdue',
                value: show(overdue),
                icon: TriangleAlert,
                tone: 'coral',
              },
              {
                label: 'Longest wait',
                value: show(oldest === null ? '—' : waitingTime(oldest)),
                icon: Clock,
              },
            ]}
          />
          <Card className="admin-tab-filters">
            <AdminScopeField selection={selection} onChange={() => setPage(1)} />
            <Field label="Priority">
              <select
                value={filters.priority}
                onChange={(e) => changeFilter('priority', e.target.value)}
              >
                <option value="">All priorities</option>
                {['Critical', 'High', 'Normal', 'Low'].map((priority) => (
                  <option key={priority}>{priority}</option>
                ))}
              </select>
            </Field>
            <Field label="Assignment type">
              <select value={filters.type} onChange={(e) => changeFilter('type', e.target.value)}>
                <option value="">All types</option>
                <option value="centre">Response centre</option>
                <option value="manager">Case manager</option>
              </select>
            </Field>
            <Field label="Waiting time">
              <select
                value={filters.waiting}
                onChange={(e) => changeFilter('waiting', e.target.value)}
              >
                <option value="">Any duration</option>
                <option value="1">At least 1 hour</option>
                <option value="24">At least 24 hours</option>
              </select>
            </Field>
            <Field label="Search by request ID">
              <input
                type="search"
                placeholder="Enter a request ID"
                value={filters.search}
                onChange={(e) => changeFilter('search', e.target.value)}
              />
            </Field>
            <ResetAdminFilters
              onClick={() => {
                setFilters(filtersDefault);
                selection.setScope(selection.country);
                setPage(1);
                if (params.has('reference')) {
                  const next = new URLSearchParams(params);
                  next.delete('reference');
                  setParams(next, { replace: true });
                }
              }}
            />
          </Card>
          <Card className="admin-tab-stack">
            <div className="admin-tab-section-bar">
              <h2>Assignment queue</h2>
              {!pending && !error && (
                <small className="muted" role="status">
                  Showing {displayed.length} of {matched.length} matching requests
                </small>
              )}
              <Field label="Sort by">
                <select
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="oldest">Waiting time (longest first)</option>
                  <option value="newest">Waiting time (shortest first)</option>
                </select>
              </Field>
            </div>
            {crisisId && selection.scope && (
              <small className="muted">
                Filtered to the selected crisis.{' '}
                <Link to="/admin?section=cases">View all crises</Link>
              </small>
            )}
            {assignment.error && <ErrorState error={assignment.error} />}
            {assignment.isSuccess && (
              <p className="success-text" role="status">
                Assignment saved.
              </p>
            )}
            {pending ? (
              <Loading />
            ) : error ? (
              <ErrorState
                error={error}
                retry={() => {
                  if (!selection.scope) void selection.countries.refetch();
                  void Promise.all(queues.map((query) => query.refetch()));
                }}
              />
            ) : displayed.length ? (
              <>
                <div className="admin-tab-queue">
                  {displayed.map((request) => (
                    <CaseRow
                      key={`${request.id}:${request.organisationId ?? ''}`}
                      request={request}
                      selectedCountry={selection.country}
                      countryName={
                        selection.options.find((country) => country.code === request.country)
                          ?.name ?? request.country
                      }
                      waiting={
                        Number.isFinite(age(request)) ? waitingTime(age(request)) : 'Unavailable'
                      }
                      overdue={critical(request)}
                      busy={assignment.isPending}
                      current={assignment.variables?.request.id === request.id}
                      assign={(id) => assignment.mutate({ request, id })}
                      openCountry={() => {
                        if (selection.globalAdmin && selection.country !== request.country) {
                          selection.setScope(request.country);
                        }
                      }}
                    />
                  ))}
                </div>
                {matched.length > pageSize && (
                  <AdminPagination
                    label="Assignment queue pages"
                    size={pageSize}
                    total={matched.length}
                    page={currentPage}
                    setPage={setPage}
                  />
                )}
              </>
            ) : (
              <p className="muted">No requests are waiting for assignment with these filters.</p>
            )}
          </Card>
        </div>
        <aside className="admin-tab-stack">
          <Card>
            <AdminPanelHeading icon={BookOpen} title="Assignment guidance" />
            <p className="muted">
              Confirm the location and priority before assigning a response centre or case manager.
            </p>
            <div className="admin-tab-callout">
              <strong>Overdue requests</strong>
              <p>Prioritise critical requests waiting at least 24 hours.</p>
            </div>
          </Card>
          <Card>
            <AdminPanelHeading icon={Building2} title="Queue breakdown" />
            <div className="admin-tab-count">
              <span>Response centre needed</span>
              <strong>{show(waitingForCentre) ?? '—'}</strong>
            </div>
            <div className="admin-tab-count">
              <span>Case manager needed</span>
              <strong>{show(waitingForManager) ?? '—'}</strong>
            </div>
            <Link className="button secondary" to="/admin?section=organisations">
              View organisations
            </Link>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function CaseRow({
  request,
  selectedCountry,
  countryName,
  waiting,
  overdue,
  busy,
  current,
  assign,
  openCountry,
}: {
  request: QueueCase;
  countryName: string;
  waiting: string;
  overdue: boolean;
  busy: boolean;
  current: boolean;
  selectedCountry: string;
  assign: (id: string) => void;
  openCountry: () => void;
}) {
  const [assignee, setAssignee] = useState('');
  const centres = useQuery({
    queryKey: ['lookups', request.country],
    queryFn: () =>
      get<Lookups>(
        selectedCountry === request.country
          ? '/public/lookups'
          : `/public/lookups?countryCode=${request.country}`,
      ),
    enabled: !request.organisationId,
  });
  const managers = useQuery({
    queryKey: ['case-managers', request.id],
    queryFn: () =>
      get<{ id: string; name: string; availableForAssignment: boolean }[]>(
        `/requests/${request.id}/case-managers`,
      ),
    enabled: !!request.organisationId,
  });
  const query = request.organisationId ? managers : centres;
  const choice = request.organisationId ? 'Case manager' : 'Response centre';
  const title = request.organisationId ? 'Assign case manager' : 'Assign centre';
  return (
    <article className={`admin-tab-row admin-tab-case-row${overdue ? ' urgent' : ''}`}>
      <div>
        <div className="admin-tab-inline">
          <strong>{request.reference}</strong>
          {request.priority && <Badge value={request.priority} />}
        </div>
        <small>{request.category === 'FoodWater' ? 'Food & water' : request.category}</small>
      </div>
      <div>
        <span className="admin-tab-inline">
          <MapPin size={14} aria-hidden="true" />
          {request.locationText || 'Location not recorded'}
        </span>
        <small>{countryName}</small>
        <span className="admin-tab-inline">
          <Clock size={14} aria-hidden="true" />
          Waiting {waiting} {overdue && <span className="badge red">Overdue</span>}
        </span>
      </div>
      <div>
        <small>Assignment needed</small>
        <strong>{choice}</strong>
      </div>
      <div>
        <details>
          <summary>Issue summary</summary>
          <p>{request.description}</p>
          {request.requestedForSomeoneElse && (
            <p>
              {request.requesterRelationship || 'Relationship not provided'} ·{' '}
              {request.requesterContact || 'Contact not provided'}
            </p>
          )}
        </details>
        <p className="admin-tab-excerpt">{request.description}</p>
      </div>
      <div className="admin-tab-row-actions">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (assignee) assign(assignee);
          }}
        >
          <Field label={choice}>
            <select
              key={choice}
              value={assignee}
              required
              disabled={query.isPending || !!query.error || busy}
              onChange={(event) => setAssignee(event.target.value)}
            >
              <option value="">
                {query.isPending
                  ? 'Loading assignees…'
                  : query.error
                    ? 'Assignees unavailable'
                    : `Select a ${request.organisationId ? 'case manager' : 'centre'}`}
              </option>
              {!request.organisationId
                ? centres.data?.organisations.map((org) => (
                    <option value={org.id} key={org.id}>
                      {org.name}
                    </option>
                  ))
                : managers.data?.map((manager) => (
                    <option value={manager.id} key={manager.id}>
                      {manager.name}
                      {manager.availableForAssignment ? '' : ' (unavailable)'}
                    </option>
                  ))}
            </select>
          </Field>
          <Button busy={current && busy} disabled={busy || !assignee || !!query.error}>
            {title}
          </Button>
        </form>
        {query.error && <ErrorState error={query.error} retry={() => void query.refetch()} />}
        <Link to={`/admin/cases/${request.id}?source=triage`} onClick={openCountry}>
          View details
        </Link>
      </div>
    </article>
  );
}
