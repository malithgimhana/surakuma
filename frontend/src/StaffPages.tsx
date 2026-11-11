import { RegionField, useCountry } from './geography';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ArrowRight,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  Clock,
  ClipboardList,
  Download,
  Plus,
  Search,
  ShieldCheck,
  Tent,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { api, errorMessage, get } from './api';
import { useAuth } from './auth';
import {
  Badge,
  Button,
  Card,
  categories,
  Empty,
  ErrorState,
  Field,
  formatDate,
  IconTile,
  Loading,
  NextLink,
  PageHeader,
} from './components';
import { MapView } from './MapView';
import type {
  AidRequest,
  AllocationRecommendations,
  AiDetail,
  Alert,
  Crisis,
  Lookups,
  Metrics,
  Page,
  Priority,
  RequestDetail,
  Resource,
  Shelter,
  User,
  VolunteerData,
} from './types';

function useWrite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      path,
      data,
      method = 'post',
    }: {
      path: string;
      data?: unknown;
      method?: 'post' | 'put' | 'patch' | 'delete';
    }) => (await api.request({ url: path, method, data })).data as unknown,
    onSuccess: () => client.invalidateQueries(),
  });
}
function MutationMessage({ mutation }: { mutation: ReturnType<typeof useWrite> }) {
  return mutation.error ? (
    <ErrorState error={mutation.error} />
  ) : mutation.isSuccess ? (
    <p className="success-text" role="status">
      <CheckCircle2 size={17} /> Saved successfully.
    </p>
  ) : null;
}
function useLookups() {
  return useQuery({ queryKey: ['lookups'], queryFn: () => get<Lookups>('/public/lookups') });
}
function OrgSelect({ name = 'organisationId', initialId }: { name?: string; initialId?: string }) {
  const country = useCountry();
  const { user } = useAuth(),
    q = useLookups();
  const orgs = q.data?.organisations.filter((o) =>
    user?.roles.includes('Administrator') || user?.memberships.some((m) => m.countryCode === country && (m.role === 'CountryAdministrator' || m.organisationId === o.id)),
  );
  return (
    <Field label="Organisation">
      <select name={name} required defaultValue={initialId}>
        {orgs?.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
function formValues(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form).entries());
}
export function StaffOverview() {
  const query = useQuery({
    queryKey: ['metrics'],
    queryFn: () => get<Metrics>('/reports/metrics'),
  });
  const { user } = useAuth();
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const m = query.data!;
  return (
    <>
      <PageHeader
        eyebrow="COORDINATING CARE"
        title={`Welcome back, ${user?.name.split(' ')[0]}`}
        description="One shared view. More coordinated support."
        action={
          <Link to="/staff/cases" className="button primary">
            Review incoming cases
            <ArrowRight size={18} />
          </Link>
        }
      />
      <div className="metric-grid">
        {[
          [m.openCases, 'Open cases', ClipboardList, 'blue'],
          [m.overdueCases, 'Overdue · over 24h', Clock, 'coral'],
          [m.resolvedCases, 'Assistance delivered', CheckCircle2, 'green'],
          [m.escalatedCases, 'Escalated cases', TriangleAlert, 'yellow'],
        ].map(([value, label, Icon, tone]) => {
          const Component = Icon as typeof Clock;
          return (
            <Card key={String(label)} className="metric">
              <IconTile icon={Component} tone={String(tone)} />
              <strong>{String(value)}</strong>
              <span>{String(label)}</span>
            </Card>
          );
        })}
      </div>
      <div className="two-column section-small">
        <Card>
          <h2>Case workload</h2>
          <p className="muted">Current records within your authorised scope.</p>
          <div className="chart" role="img" aria-label="Case counts by status">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={m.byStatus}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="status" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#1769e0" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="chart-values">
            {m.byStatus.map((s) => (
              <li key={s.status}>
                {s.status}: {s.count}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2>Operational pulse</h2>
          <dl className="pulse">
            <div>
              <dt>Average first review</dt>
              <dd>
                {m.averageResponseHours === null ? 'No reviews yet' : `${m.averageResponseHours} h`}
              </dd>
            </div>
            <div>
              <dt>Shelter occupancy</dt>
              <dd>
                {m.shelterOccupancy} / {m.shelterCapacity}
              </dd>
            </div>
            <div>
              <dt>Shelter reservations</dt>
              <dd>{m.shelterReserved}</dd>
            </div>
            <div>
              <dt>Stock reserved / physical</dt>
              <dd>
                {m.resourceReserved} / {m.resourceStock}
              </dd>
            </div>
            <div>
              <dt>AI override frequency</dt>
              <dd>{(m.aiOverrideFrequency * 100).toFixed(0)}% · {m.aiApprovedCount} approved, {m.aiModifiedCount} modified, {m.aiRejectedCount} rejected, {m.aiDeferredCount} deferred</dd>
            </div>
          </dl>
          <small className="muted">
            Inventory totals combine different units; use the resource ledger for item-level
            decisions.
          </small>
        </Card>
      </div>
      <Card>
        <div className="section-heading">
          <h2>Outstanding needs</h2>
          <NextLink to="/staff/cases">Review cases</NextLink>
        </div>
        {m.shortages.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Category</th>
                  <th>Priority</th>
                  <th>Outstanding</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {m.shortages.map((s) => (
                  <tr key={s.id}>
                    <td>{s.reference}</td>
                    <td>{s.category}</td>
                    <td>
                      <Badge value={s.priority} />
                    </td>
                    <td>{s.outstanding}</td>
                    <td>
                      <Link to={`/staff/cases/${s.id}`}>Review →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No approved outstanding needs" />
        )}
      </Card>
    </>
  );
}
export function CaseQueue() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const organisations = useLookups();
  const isCaseManager = !!user?.roles.includes('CaseManager');
  const canFollowUp = !!user?.roles.some((role) => ['CaseManager', 'Coordinator'].includes(role));
  const escalations = useQuery({
    queryKey: ['escalated-cases'],
    queryFn: () => get<AidRequest[]>('/requests/escalated'),
    enabled: canFollowUp,
  });
  const availability = useQuery({
    queryKey: ['case-manager-availability'],
    queryFn: () => get<{ id: string; organisationId: string; availableForAssignment: boolean }[]>('/case-manager/availability'),
    enabled: isCaseManager,
  });
  const changeAvailability = useWrite();
  const triage = useQuery({
    queryKey: ['triage'],
    queryFn: () => get<AidRequest[]>('/requests/triage'),
    enabled: !!user?.roles.includes('Coordinator'),
  });
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [assignedToMe, setAssignedToMe] = useState(isCaseManager),
    [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['cases', search, status, page, assignedToMe],
    queryFn: () =>
      get<Page<AidRequest>>(
        `/requests?search=${encodeURIComponent(search)}&status=${status}&page=${page}&assignedToMe=${assignedToMe}`,
      ),
  });
  return (
    <>
      <PageHeader
        title="Case queue"
        description="Review requests, verify information, and coordinate the next step."
      />
      {canFollowUp && <Card>
        <h2>Cases needing follow-up</h2>
        <p>Includes problems reported after a case was completed.</p>
        {escalations.isPending ? <Loading /> : escalations.error ? <ErrorState error={escalations.error} retry={() => void escalations.refetch()} /> :
          escalations.data?.length ? <ul>{escalations.data.map((request) => <li key={request.id}>
            <Link to={`/staff/cases/${request.id}`}>{request.reference}</Link> · {t('category.' + request.category)} · {t('status.' + request.status)}
          </li>)}</ul> : <p>No cases need follow-up.</p>}
      </Card>}
      {isCaseManager && <Card>
        <h2>Case assignment availability</h2>
        {availability.error && <ErrorState error={availability.error} />}
        {availability.data?.map((membership) => <label className="checkbox-label" key={membership.id}>
          <input type="checkbox" checked={membership.availableForAssignment} disabled={changeAvailability.isPending}
            onChange={(event) => changeAvailability.mutate({ path: `/case-manager/availability/${membership.id}`, method: 'put', data: { available: event.target.checked } })} />
          Available for automatic assignments · {organisations.data?.organisations.find((org) => org.id === membership.organisationId)?.name ?? membership.organisationId}
        </label>)}
        <MutationMessage mutation={changeAvailability} />
      </Card>}
      {user?.roles.includes('Coordinator') && (
        <Card>
          <h2>Unassigned requests</h2>
          {triage.isPending ? <Loading /> : triage.error ? <ErrorState error={triage.error} /> :
            triage.data?.length ? <ul>{triage.data.map((request) => <li key={request.id}>
              <Link to={`/staff/cases/${request.id}`}>{request.reference}</Link> · {request.category} · {request.locationText}
            </li>)}</ul> : <p>No requests are waiting for assignment.</p>}
        </Card>
      )}
      <div className="directory-tools">
        {isCaseManager && <label className="checkbox-label"><input type="checkbox" checked={assignedToMe} onChange={(e) => { setAssignedToMe(e.target.checked); setPage(1); }} />My assigned cases</label>}
        <label className="search-field">
          <Search size={19} />
          <input
            aria-label="Search cases"
            placeholder="Search reference or request…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <select
          aria-label="Filter status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {[
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
          ].map((s) => (
            <option key={s} value={s}>{t('status.' + s)}</option>
          ))}
        </select>
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <>
          <Card className="flush">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Need</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Location</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {q.data?.items.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.reference}</strong>
                        {!r.organisationId && <small>Awaiting assignment</small>}
                        {r.escalated && <small className="field-error">Escalated</small>}
                      </td>
                      <td>
                        {t('category.' + r.category)}
                        <small>
                          {r.householdSize} people · {r.quantity - r.deliveredQuantity} outstanding
                        </small>
                      </td>
                      <td>
                        <Badge value={r.priority} />
                      </td>
                      <td>
                        <Badge value={r.status} />
                      </td>
                      <td>{r.locationText}</td>
                      <td>
                        <Link className="text-link" to={`/staff/cases/${r.id}`}>
                          Open
                          <ArrowRight size={16} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!q.data?.items.length && <Empty title="No matching cases" />}
          </Card>
          <div className="pagination">
            <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span>
              Page {page} · {q.data?.total} cases
            </span>
            <Button
              variant="secondary"
              disabled={page * 20 >= (q.data?.total || 0)}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </>
  );
}
const isMeasuredUnit = (unit: string) => ['kg', 'kilogram', 'kilograms', 'l', 'liter', 'liters', 'litre', 'litres'].includes(unit.trim().toLowerCase());

export function CaseDetails() {
  const { t } = useTranslation();
  const { id } = useParams(),
    { user } = useAuth(),
    lookup = useLookups(),
    write = useWrite();
  const q = useQuery({
    queryKey: ['staff-case', id],
    queryFn: () => get<RequestDetail>(`/requests/${id}`),
  });
  const caseManagers = useQuery({
    queryKey: ['case-managers', id],
    queryFn: () => get<{ id: string; name: string; availableForAssignment: boolean }[]>(`/requests/${id}/case-managers`),
    enabled: !!id && !!user?.roles.includes('Coordinator'),
  });
  const canCase = user?.roles.some((r) => ['Administrator', 'CountryAdministrator', 'Coordinator', 'CaseManager'].includes(r)),
    canLogistics = user?.roles.some((r) => ['Administrator', 'CountryAdministrator', 'Coordinator', 'Logistics'].includes(r)),
    canShelter = user?.roles.some((r) => ['Administrator', 'CountryAdministrator', 'Coordinator', 'ShelterAdmin'].includes(r));
  const ai = useQuery({
    queryKey: ['ai', id],
    queryFn: () => get<AiDetail>(`/requests/${id}/recommendations`),
    enabled: canCase,
  });
  const resources = useQuery({
    queryKey: ['case-resources', id],
    queryFn: () => get<Resource[]>(`/requests/${id}/resources`),
    enabled: canLogistics,
  });
  const allocationRecommendations = useQuery({
    queryKey: ['allocation-recommendations', id],
    queryFn: () => get<AllocationRecommendations>(`/requests/${id}/allocation-recommendations`),
    enabled: canLogistics && !!id,
  });
  const shelters = useQuery({
    queryKey: ['case-shelters', id],
    queryFn: () => get<Shelter[]>(`/requests/${id}/shelters`),
    enabled: canShelter,
  });
  const [resourceId, setResourceId] = useState(''),
    [ignoredRecommendation, setIgnoredRecommendation] = useState(false),
    [reason, setReason] = useState(''),
    [priority, setPriority] = useState<Priority>('High'),
    [downloadError, setDownloadError] = useState<unknown>(null);
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const d = q.data!,
    r = d.request;
  const recommended = allocationRecommendations.data?.candidates.find((candidate) => candidate.transportAvailable);
  const next = (
    {
      Submitted: 'UnderReview',
      UnderReview: 'Verified',
      Verified: 'Approved',
      Fulfilled: 'Closed',
    } as Record<string, string>
  )[r.status];
  return (
    <>
      <NextLink to="/staff/cases">Back to case queue</NextLink>
      <PageHeader
        title={r.reference}
        description={`${t('category.' + r.category)} · ${r.householdSize} household members`}
        action={<Badge value={r.status} />}
      />
      <MutationMessage mutation={write} />
      <div className="case-grid">
        <div className="stack">
          <Card>
            <div className="inline spread">
              <h2>Request details</h2>
              <Badge value={r.priority} />
            </div>
            <p>{r.description}</p>
            {!!d.feedback?.length && (
              <section aria-label="Citizen feedback">
                <h3>Citizen feedback</h3>
                {d.feedback.map((f) => (
                  <div className="recommendation" key={f.id}>
                    <strong>
                      {f.rating}/5 · {f.received ? 'Receipt confirmed' : 'Receipt not confirmed'}
                    </strong>
                    {f.problem && <Badge value="Warning" />}
                    <p>{f.comment}</p>
                    <small className="muted">{formatDate(f.createdAt)}</small>
                  </div>
                ))}
              </section>
            )}
            <dl className="review-grid">
              <dt>Location</dt>
              <dd>{r.locationText}</dd>
              <dt>Accessibility needs</dt>
              <dd>{r.accessibilityNeeds || 'None reported'}</dd>
              <dt>Delivered / requested</dt>
              <dd>
                {r.deliveredQuantity} / {r.quantity}
              </dd>
              <dt>Organisation</dt>
              <dd>{lookup.data?.organisations.find((o) => o.id === r.organisationId)?.name || 'Awaiting assignment'}</dd>
              <dt>Case manager</dt>
              <dd>{caseManagers.data?.find((manager) => manager.id === r.assignedCaseManagerId)?.name || (r.assignedCaseManagerId === user?.id ? 'You' : r.assignedCaseManagerId ? 'Assigned' : 'Awaiting assignment')}</dd>
              {r.requestedForSomeoneElse && <>
                <dt>Requester's relationship</dt><dd>{r.requesterRelationship || 'Not provided'}</dd>
                <dt>Requester contact</dt><dd>{r.requesterContact || 'Not provided'}</dd>
              </>}
            </dl>
            {!r.organisationId && !['Closed', 'Rejected', 'Cancelled'].includes(r.status) && user?.roles.includes('Coordinator') && (
              <form onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const organisationId = String(form.get('organisationId') || '');
                if (organisationId) write.mutate({ path: `/requests/${id}/reassign`, data: { organisationId } });
              }} className="inline">
                <label>Assign organisation <select name="organisationId" required defaultValue="">
                  <option value="">Select an organisation</option>
                  {lookup.data?.organisations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
                </select></label>
                <Button type="submit" busy={write.isPending}>Assign</Button>
              </form>
            )}
            {r.organisationId && !['Closed', 'Rejected', 'Cancelled'].includes(r.status) && user?.roles.includes('Coordinator') && (
              <form className="inline" onSubmit={(event) => {
                event.preventDefault();
                const userId = String(new FormData(event.currentTarget).get('userId') || '');
                if (userId) write.mutate({ path: `/requests/${id}/case-manager`, data: { userId } });
              }}>
                <label>Case manager <select name="userId" required defaultValue="">
                  <option value="">Select a case manager</option>
                  {caseManagers.data?.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}{manager.availableForAssignment ? '' : ' (unavailable)'}</option>)}
                </select></label>
                <Button type="submit" busy={write.isPending}>Assign case manager</Button>
              </form>
            )}
            {r.latitude !== null && <MapView point={[r.latitude, r.longitude!]} />}
            {d.attachments.map((file) => (
              <Button
                key={file.id}
                variant="secondary"
                onClick={() =>
                  void api
                    .get(`/requests/${id}/attachments/${file.id}`, { responseType: 'blob' })
                    .then((response) => {
                      const url = URL.createObjectURL(response.data);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = file.originalName;
                      a.click();
                      URL.revokeObjectURL(url);
                    })
                    .catch(setDownloadError)
                }
              >
                <Download size={16} />
                {file.originalName}
              </Button>
            ))}
            {!!downloadError && <ErrorState error={downloadError} />}
          </Card>
          {canCase && (
            <Card>
              <div className="section-heading">
                <div>
                  <span className="eyebrow">HUMAN DECISIONS FIRST</span>
                  <h2>
                    <BrainCircuit size={23} /> AI decision support
                  </h2>
                </div>
                <Button
                  variant="secondary"
                  busy={write.isPending}
                  onClick={() => write.mutate({ path: `/requests/${id}/recommendations/generate` })}
                >
                  Generate recommendation
                </Button>
              </div>
              {ai.isPending ? (
                <Loading />
              ) : ai.error ? (
                <ErrorState error={ai.error} />
              ) : (
                <>
                  {!ai.data?.recommendations.length && (
                    <p className="muted">
                      No recommendation yet. Generating one never approves this request.
                    </p>
                  )}
                  {ai.data?.recommendations.map((rec) => (
                    <div className="recommendation" key={rec.id}>
                      <div className="inline spread">
                        <strong>
                          {rec.provider} · {rec.model}
                        </strong>
                        <Badge value={rec.reviewState} />
                      </div>
                      {rec.fallback && (
                        <div className="fallback-label">
                          DEVELOPMENT RULES FALLBACK · not external AI
                        </div>
                      )}
                      <div className="inline">
                        <Badge value={rec.priority} />
                        <span>{rec.category}</span>
                        <small className="muted">
                          Confidence: {rec.confidence === null ? 'unavailable' : rec.confidence} (
                          {rec.confidenceKind})
                        </small>
                      </div>
                      <p>{rec.explanation}</p>
                      {['Pending', 'Defer'].includes(rec.reviewState) && (
                        <>
                          <div className="form-grid">
                            <Field label="Final priority for modification">
                              <select
                                value={priority}
                                onChange={(e) => setPriority(e.target.value as Priority)}
                              >
                                {['Low', 'Normal', 'High', 'Critical'].map((p) => (
                                  <option key={p}>{p}</option>
                                ))}
                              </select>
                            </Field>
                            <Field label="Decision / override reason">
                              <input
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                maxLength={1000}
                              />
                            </Field>
                          </div>
                          <div className="button-row">
                            {['Approve', 'Modify', 'Reject', 'Defer'].map((action) => (
                              <Button
                                key={action}
                                variant={action === 'Approve' ? 'primary' : 'secondary'}
                                busy={write.isPending}
                                onClick={() =>
                                  write.mutate({
                                    path: `/requests/${id}/decisions`,
                                    data: {
                                      recommendationId: rec.id,
                                      action,
                                      finalPriority: priority,
                                      finalCategory: r.category,
                                      reason,
                                    },
                                  })
                                }
                              >
                                {action}
                              </Button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {ai.data?.duplicates.map((duplicate) => (
                    <div className="recommendation" key={duplicate.id}>
                      <strong>
                        Potential duplicate · {(duplicate.similarity * 100).toFixed(0)}% token
                        similarity
                      </strong>
                      <p>{duplicate.reason}</p>
                      <div className="button-row">
                        <Link to={`/staff/cases/${duplicate.candidateId}`} className="text-link">
                          Compare case
                        </Link>
                        <Badge value={duplicate.state} />
                        {duplicate.state === 'Pending' &&
                          ['Distinct', 'Confirmed'].map((action) => (
                            <Button
                              key={action}
                              variant="secondary"
                              onClick={() =>
                                write.mutate({
                                  path: `/requests/${id}/duplicates/${duplicate.id}`,
                                  data: { action, note: '' },
                                })
                              }
                            >
                              {action}
                            </Button>
                          ))}
                      </div>
                    </div>
                  ))}
                  {ai.data?.decisions.length ? (
                    <details>
                      <summary>Human decision history ({ai.data.decisions.length})</summary>
                      {ai.data.decisions.map((decision) => (
                        <p key={decision.id}>
                          <strong>{decision.action}</strong> ·{' '}
                          {decision.reason || 'No modification'} · {formatDate(decision.createdAt)}
                        </p>
                      ))}
                    </details>
                  ) : null}
                </>
              )}
            </Card>
          )}
          {canLogistics && r.category !== 'Shelter' && (
            <Card>
              <h2>Resource allocation</h2>
              <p className="muted">
                Stock, category, transport and outstanding quantity are checked before reservation.
                Staff must verify suitability and location.
              </p>
              {allocationRecommendations.error && <ErrorState error={allocationRecommendations.error} />}
              {allocationRecommendations.data && (
                <section aria-label="Allocation recommendations" className="recommendation">
                  <h3>Suggested resources</h3>
                  <p>Recommendations only; staff confirm suitability and reserve manually.</p>
                  <p>{allocationRecommendations.data.shortageExplanation}</p>
                  {allocationRecommendations.data.shortage && <p className="field-error">Potential shortage: escalate for coordinator review. Queue position: {allocationRecommendations.data.queuePosition || 'not eligible'} of {allocationRecommendations.data.competingRequests}.</p>}
                  {allocationRecommendations.data.candidates.length === 0 && <p>No matching resource with available stock was found.</p>}
                  {allocationRecommendations.data.candidates.map((candidate, index) => (
                    <div key={candidate.resourceId}>
                      <strong>{index === 0 ? 'Preferred' : index === 1 ? 'Next-best alternative' : 'Alternative'}: {candidate.name} · score {candidate.score}</strong>
                      <p>{candidate.reason}</p>
                      {candidate.shortForRequest && <p>Only {candidate.suggestedQuantity} {candidate.unit} can be suggested from this resource.</p>}
                      <Button type="button" variant="secondary" onClick={() => setResourceId(candidate.resourceId)}>Choose for review</Button>
                    </div>
                  ))}
                  {recommended && !ignoredRecommendation && <Button type="button" variant="ghost" busy={write.isPending} onClick={() => write.mutate({ path: `/requests/${id}/allocation-recommendations/ignore`, data: { recommendedResourceId: recommended.resourceId } }, { onSuccess: () => setIgnoredRecommendation(true) })}>Ignore suggestion</Button>}
                </section>
              )}
              {!['Closed', 'Rejected', 'Cancelled', 'Fulfilled'].includes(r.status) && <form
                className="form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = formValues(e.currentTarget);
                  write.mutate({
                    path: '/allocations',
                    data: { requestId: id, resourceId: f.resourceId, quantity: Number(f.quantity), recommendedResourceId: ignoredRecommendation ? null : recommended?.resourceId },
                  }, { onError: () => void allocationRecommendations.refetch() });
                }}
              >
                <Field label="Resource">
                  <select name="resourceId" required value={resourceId || resources.data?.find((x) => x.category === r.category)?.id || ''} onChange={(e) => setResourceId(e.target.value)}>
                    {resources.data
                      ?.filter((x) => x.category === r.category)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name} · {x.available} {x.unit} available · {x.locationText}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Quantity">
                  <input
                    type="number"
                    name="quantity"
                    min={isMeasuredUnit((resources.data?.find((x) => x.id === resourceId) ?? resources.data?.find((x) => x.category === r.category))?.unit ?? '') ? 0.1 : 1}
                    step={isMeasuredUnit((resources.data?.find((x) => x.id === resourceId) ?? resources.data?.find((x) => x.category === r.category))?.unit ?? '') ? 0.1 : 1}
                    max={r.quantity - r.deliveredQuantity}
                    defaultValue={Math.max(1, r.quantity - r.deliveredQuantity)}
                    required
                  />
                </Field>
                <Button busy={write.isPending}>Approve reservation</Button>
              </form>}
              {d.allocations.map((a) => (
                <div className="allocation-row" key={a.id}>
                  <strong>{a.quantity} units</strong>
                  <Badge value={a.status} />
                  {a.status === 'Reserved' && <strong>Next: Dispatch</strong>}
                  {a.status === 'Dispatched' && <strong>Next: Deliver</strong>}
                  {a.status === 'Reserved' &&
                    ['Dispatch', 'Cancel'].map((action) => (
                      <Button
                        key={action}
                        variant="secondary"
                        busy={write.isPending}
                        onClick={() => write.mutate({ path: `/allocations/${a.id}/${action}` })}
                      >
                        {action}
                      </Button>
                    ))}
                  {a.status === 'Dispatched' && (
                    <Button
                      busy={write.isPending}
                      onClick={() => write.mutate({ path: `/allocations/${a.id}/Deliver` })}
                    >
                      Confirm delivery
                    </Button>
                  )}
                </div>
              ))}
            </Card>
          )}
          {canShelter && r.category === 'Shelter' && (
            <Card>
              <h2>Shelter placement</h2>
              {!['Closed', 'Rejected', 'Cancelled', 'Fulfilled'].includes(r.status) && <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = formValues(e.currentTarget);
                  write.mutate({
                    path: '/shelter-allocations',
                    data: { requestId: id, shelterId: f.shelterId },
                  });
                }}
              >
                <Field label="Suitable shelter">
                  <select name="shelterId" required>
                    {shelters.data
                      ?.filter(
                        (s) =>
                          s.open &&
                          s.available >= r.householdSize &&
                          (!r.accessibilityNeeds || s.accessible),
                      )
                      .map((s) => (
                        <option value={s.id} key={s.id}>
                          {s.name} · {s.available} spaces ·{' '}
                          {s.accessible ? 'accessible' : 'standard'}
                        </option>
                      ))}
                  </select>
                </Field>
                <Button busy={write.isPending}>Approve household reservation</Button>
              </form>}
              {d.placements.map((p) => (
                <div className="allocation-row" key={p.id}>
                  <span>{p.people} people</span>
                  <Badge value={p.status} />
                  {(p.status === 'Reserved'
                    ? ['CheckIn', 'Cancel']
                    : p.status === 'CheckedIn'
                      ? ['Depart']
                      : []
                  ).map((action) => (
                    <Button
                      key={action}
                      variant="secondary"
                      busy={write.isPending}
                      onClick={() =>
                        write.mutate({ path: `/shelter-allocations/${p.id}/${action}` })
                      }
                    >
                      {action === 'CheckIn' ? 'Check in' : action}
                    </Button>
                  ))}
                </div>
              ))}
            </Card>
          )}
        </div>
        <div className="stack">
          {canCase && (
            <Card>
              <h2>Case actions</h2>
              <Field label="Reason / case note" hint="Visible to authorised staff only.">
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={1000}
                />
              </Field>
              <div className="stack">
                {r.escalated && <Button variant="secondary" busy={write.isPending} onClick={() =>
                  write.mutate({ path: `/requests/${id}/escalation/resolve`, data: { note: reason } }, { onSuccess: () => setReason('') })
                }>Resolve follow-up</Button>}
                {next && (
                  <Button
                    busy={write.isPending}
                    onClick={() =>
                      write.mutate({
                        path: `/requests/${id}/status`,
                        method: 'patch',
                        data: { status: next, reason },
                      }, { onSuccess: () => setReason('') })
                    }
                  >
                    {next === 'UnderReview'
                      ? 'Begin review'
                      : next === 'Verified'
                        ? 'Verify request'
                        : next === 'Approved'
                          ? 'Approve case'
                          : 'Close completed case'}
                  </Button>
                )}
                {!['Closed', 'Rejected', 'Cancelled'].includes(r.status) && (
                  <Button
                    variant="secondary"
                    busy={write.isPending}
                    onClick={() =>
                      write.mutate({
                        path: `/requests/${id}/escalate`,
                        data: { action: 'Escalate', note: reason },
                      }, { onSuccess: () => setReason('') })
                    }
                  >
                    Escalate for coordinator
                  </Button>
                )}
                {['UnderReview', 'Verified'].includes(r.status) && (
                  <Button
                    variant="danger"
                    busy={write.isPending}
                    onClick={() =>
                      write.mutate({
                        path: `/requests/${id}/status`,
                        method: 'patch',
                        data: { status: 'Rejected', reason },
                      }, { onSuccess: () => setReason('') })
                    }
                  >
                    Reject request with reason
                  </Button>
                )}
              </div>
            </Card>
          )}
          <Card>
            <h2>Decision timeline</h2>
            <ol className="timeline">
              {d.history.map((h) => (
                <li key={h.id}>
                  <span className="timeline-dot" />
                  <Badge value={h.status} />
                  <small>{formatDate(h.createdAt)}</small>
                  <p>{h.note}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}

export function ResourcesPage() {
  const q = useQuery({ queryKey: ['resources'], queryFn: () => get<Resource[]>('/resources') }),
    write = useWrite();
  const [unit, setUnit] = useState('packs'),
    [add, setAdd] = useState(false),
    [history, setHistory] = useState<string | null>(null);
  const movements = useQuery({
    queryKey: ['stock', history],
    queryFn: () =>
      get<{ id: string; kind: string; quantity: number; note: string; createdAt: string }[]>(
        `/resources/${history}/movements`,
      ),
    enabled: !!history,
  });
  return (
    <>
      <PageHeader
        title="Resources & logistics"
        description="Keep reservations, physical stock and delivery records distinct."
        action={
          <Button onClick={() => setAdd(!add)}>
            <Plus size={18} />
            Add resource
          </Button>
        }
      />
      <MutationMessage mutation={write} />
      {add && (
        <Card>
          <h2>New inventory item</h2>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const f = formValues(e.currentTarget);
              write.mutate({
                path: '/resources',
                data: {
                  ...f,
                  stock: Number(f.stock),
                  latitude: Number(f.latitude),
                  longitude: Number(f.longitude),
                  transportAvailable: f.transportAvailable === 'on',
                },
              });
            }}
          >
            <OrgSelect /><RegionField />
            <Field label="Resource name">
              <input name="name" required maxLength={100} />
            </Field>
            <Field label="Category">
              <select name="category">
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Unit">
              <input name="unit" value={unit} onChange={(e) => setUnit(e.target.value)} required />
            </Field>
            <Field label="Opening stock">
              <input name="stock" type="number" min={0} step={isMeasuredUnit(unit) ? 0.1 : 1} required />
            </Field>
            <Field label="Location">
              <input name="locationText" required />
            </Field>
            <Field label="Latitude">
              <input
                name="latitude"
                type="number"
                min={-90}
                max={90}
                step="any"
                defaultValue={6.93}
              />
            </Field>
            <Field label="Longitude">
              <input
                name="longitude"
                type="number"
                min={-180}
                max={180}
                step="any"
                defaultValue={79.88}
              />
            </Field>
            <Field label="Suitability notes">
              <input name="suitability" />
            </Field>
            <label className="checkbox-label">
              <input type="checkbox" name="transportAvailable" defaultChecked />
              Transport available
            </label>
            <Button busy={write.isPending}>Save resource</Button>
          </form>
        </Card>
      )}
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="resource-grid">
          {q.data?.map((r) => (
            <Card key={r.id}>
              <div className="inline spread">
                <IconTile icon={Boxes} tone="blue" />
                <Badge value={r.available === 0 ? 'Warning' : 'Open'} />
              </div>
              <h3>{r.name}</h3>
              <p className="muted">{r.locationText}</p>
              <div className="stock-numbers">
                <div>
                  <strong>{r.available}</strong>
                  <small>Available {r.unit}</small>
                </div>
                <div>
                  <strong>{r.reserved}</strong>
                  <small>Reserved</small>
                </div>
                <div>
                  <strong>{r.stock}</strong>
                  <small>Physical</small>
                </div>
              </div>
              <p>{r.suitability}</p>
              <form
                className="inline"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = formValues(e.currentTarget);
                  write.mutate({
                    path: `/resources/${r.id}/replenish`,
                    data: { quantity: Number(f.quantity), note: String(f.note) },
                  });
                }}
              >
                <input
                  name="quantity"
                  type="number"
                  min={isMeasuredUnit(r.unit) ? 0.1 : 1}
                  step={isMeasuredUnit(r.unit) ? 0.1 : 1}
                  placeholder="Quantity"
                  aria-label={`Replenish ${r.name} quantity`}
                  required
                />
                <input
                  name="note"
                  placeholder="Reason"
                  aria-label="Replenishment reason"
                  required
                />
                <Button variant="secondary" busy={write.isPending}>
                  Add stock
                </Button>
              </form>
              <button
                className="text-link"
                onClick={() => setHistory(history === r.id ? null : r.id)}
              >
                View stock ledger →
              </button>
              {history === r.id &&
                (movements.isPending ? (
                  <Loading />
                ) : movements.error ? (
                  <ErrorState error={movements.error} />
                ) : (
                  <ul className="ledger">
                    {movements.data?.map((m) => (
                      <li key={m.id}>
                        <strong>{m.kind}</strong> · {m.quantity}
                        <small>
                          {formatDate(m.createdAt)} {m.note}
                        </small>
                      </li>
                    ))}
                  </ul>
                ))}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
export function ShelterManagement() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['staff-shelters'], queryFn: () => get<Shelter[]>('/staff/shelters') }),
    write = useWrite(),
    { user } = useAuth();
  const [editing, setEditing] = useState<Shelter | null | undefined>(undefined);
  const shelters = q.data?.filter((s) =>
    user?.memberships.some((m) => m.organisationId === s.organisationId),
  );
  return (
    <>
      <PageHeader
        title={t('staffShelters')}
        description={t('shelterManagementDescription')}
        action={
          <Button onClick={() => setEditing(null)}>
            <Plus size={18} />
            {t('addShelter')}
          </Button>
        }
      />
      <MutationMessage mutation={write} />
      {editing !== undefined && (
        <Card>
          <h2>{t(editing ? 'updateShelter' : 'newShelter')}</h2>
          <form
            key={editing?.id || 'new'}
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const f = formValues(e.currentTarget);
              write.mutate({
                path: editing ? `/shelters/${editing.id}` : '/shelters',
                method: editing ? 'put' : 'post',
                data: {
                  ...f,
                  capacity: Number(f.capacity),
                  latitude: Number(f.latitude),
                  longitude: Number(f.longitude),
                  accessible: f.accessible === 'on',
                  open: f.open === 'on',
                },
              });
            }}
          >
            <OrgSelect initialId={editing?.organisationId} /><RegionField initialDivisionId={editing?.administrativeDivisionId} />
            <Field label={t('shelterName')}>
              <input name="name" defaultValue={editing?.name} required />
            </Field>
            <Field label={t('shelterAddress')}>
              <input name="address" defaultValue={editing?.address} required />
            </Field>
            <Field label={t('shelterCapacity')}>
              <input
                name="capacity"
                type="number"
                min={1}
                defaultValue={editing?.capacity || 50}
                required
              />
            </Field>
            <Field label={t('shelterLatitude')}>
              <input
                name="latitude"
                type="number"
                step="any"
                min={-90}
                max={90}
                defaultValue={editing?.latitude || 6.93}
              />
            </Field>
            <Field label={t('shelterLongitude')}>
              <input
                name="longitude"
                type="number"
                step="any"
                min={-180}
                max={180}
                defaultValue={editing?.longitude || 79.88}
              />
            </Field>
            <Field label={t('shelterFacilities')}>
              <input name="facilities" defaultValue={editing?.facilities || 'Water, toilets'} />
            </Field>
            <div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="accessible"
                  defaultChecked={editing?.accessible ?? true}
                />
                {t('shelterAccessible')}
              </label>
              <label className="checkbox-label">
                <input type="checkbox" name="open" defaultChecked={editing?.open ?? true} />
                {t('shelterOpen')}
              </label>
            </div>
            <Button busy={write.isPending}>{t('saveShelter')}</Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(undefined)}>
              {t('closeEditor')}
            </Button>
          </form>
        </Card>
      )}
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="resource-grid">
          {shelters?.map((s) => (
            <Card key={s.id}>
              <div className="inline spread">
                <IconTile icon={Tent} tone="yellow" />
                <Badge value={s.open ? 'Open' : 'ShelterClosed'} />
              </div>
              <h3>{s.name}</h3>
              <p className="muted">{s.address}</p>
              <div className="stock-numbers">
                <div>
                  <strong>{s.available}</strong>
                  <small>{t('shelterAvailable')}</small>
                </div>
                <div>
                  <strong>{s.reserved}</strong>
                  <small>{t('shelterReserved')}</small>
                </div>
                <div>
                  <strong>{s.occupancy}</strong>
                  <small>{t('shelterCheckedIn')}</small>
                </div>
              </div>
              <p>{s.facilities}</p>
              <Button variant="secondary" onClick={() => setEditing(s)}>
                {t('editShelter')}
              </Button>
              <NextLink to="/staff/cases">{t('allocateHousehold')}</NextLink>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
