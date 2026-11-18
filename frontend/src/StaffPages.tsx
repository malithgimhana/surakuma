import { RegionField, useCountry } from './geography';
import { countryPath } from './crisisOperationsApi';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DeliveryFields, deliveryInput } from './DeliveryFields';
import { ResourceLocationFields } from './ResourceLocationFields';
import { OrganisationDialog } from './OrganisationDialog';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  Download,
  Plus,
  Search,
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
import { isMeasuredUnit } from './quantity';
import { ShelterDashboard } from './ShelterDashboard';
import { WorkspaceDialog } from './OrganisationDialog';
import type {
  AidRequest,
  AllocationRecommendations,
  AiDetail,
  Alert,
  Crisis,
  Lookups,
  Page,
  Priority,
  RequestDetail,
  Resource,
  Shelter,
  User,
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
function OrgSelect({ name = 'organisationId' }: { name?: string }) {
  const country = useCountry();
  const { user } = useAuth(),
    q = useQuery({
      queryKey: ['organisation-options', country],
      queryFn: () => get<Lookups>(`/public/lookups?countryCode=${encodeURIComponent(country)}`),
    });
  const orgs = q.data?.organisations.filter((o) =>
    user?.roles.includes('Administrator') || user?.memberships.some((m) => m.countryCode === country && (m.role === 'CountryAdministrator' || m.organisationId === o.id)),
  );
  return (
    <Field label="Organisation">
      <select name={name} required defaultValue="">
        <option value="" disabled>{q.isPending ? 'Loading organisations…' : 'Select an organisation'}</option>
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
export function CaseQueue() {
  const { pathname, search: queueSearch } = useLocation();
  const country = useCountry();
  const [params] = useSearchParams();
  const adminQueue = pathname === '/admin/cases';
  const view = params.get('view');
  const staffRole = adminQueue ? '' : params.get('role') ?? '';
  const crisisId = adminQueue && params.get('country') === country ? params.get('crisisId') : null;
  const viewLabel = ({ overdue: 'Overdue cases', open: 'Open cases', critical: 'Critical cases', escalated: 'Escalated cases',
    'pending-ai': 'Cases awaiting AI review', unassigned: 'Unassigned cases', shortages: 'Resource shortages',
    fulfilment: 'Cases eligible for fulfilment', assigned: 'Assigned cases' } as Record<string, string>)[view ?? ''] ?? 'Case queue';
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
    [filterState, setFilterState] = useState<{ search: string; status?: string; assigned?: boolean }>({ search: queueSearch }),
    [page, setPage] = useState(1);
  const status = filterState.search === queueSearch ? filterState.status ?? params.get('status') ?? '' : params.get('status') ?? '';
  const assignedToMe = filterState.search === queueSearch ? filterState.assigned ?? (params.get('assignedToMe') === 'true' || !staffRole && isCaseManager) :
    params.get('assignedToMe') === 'true' || !staffRole && isCaseManager;
  const setStatus = (status: string) => setFilterState({ search: queueSearch, status, assigned: assignedToMe });
  const setAssignedToMe = (assigned: boolean) => setFilterState({ search: queueSearch, status, assigned });
  const q = useQuery({
    queryKey: ['cases', country, search, status, page, assignedToMe, view, crisisId, staffRole],
    queryFn: () => {
      const query = new URLSearchParams({ search, status, page: String(page), assignedToMe: String(assignedToMe) });
      if (view) query.set('view', view);
      if (crisisId) query.set('crisisId', crisisId);
      if (staffRole) query.set('staffRole', staffRole);
      return get<Page<AidRequest>>(`/requests?${query}`);
    },
  });
  return (
    <>
      <PageHeader
        title={viewLabel}
        description={view === 'overdue' ? 'Cases still open more than 24 hours after submission.' : 'Review requests, verify information, and coordinate the next step.'}
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
                        <Link className="text-link" to={adminQueue ? `/admin/cases/${r.id}${queueSearch}` : `/staff/cases/${r.id}`}>
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
export function CaseDetails() {
  const location = useLocation();
  const country = useCountry();
  const { t } = useTranslation();
  const { id } = useParams(),
    { user } = useAuth(),
    lookup = useLookups(),
    write = useWrite();
  const adminCase = location.pathname.startsWith('/admin/');
  const fromAssignmentQueue = adminCase && new URLSearchParams(location.search).get('source') === 'triage';
  const canAssign = user?.roles.includes('Coordinator') || (adminCase &&
    user?.roles.some(role => role === 'Administrator' || role === 'CountryAdministrator'));
  const q = useQuery({
    queryKey: ['staff-case', id],
    queryFn: () => get<RequestDetail>(`/requests/${id}`),
  });
  const caseManagers = useQuery({
    queryKey: ['case-managers', id],
    queryFn: () => get<{ id: string; name: string; availableForAssignment: boolean }[]>(`/requests/${id}/case-managers`),
    enabled: !!id && !!canAssign,
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
  const shelterRanking = useQuery({
    queryKey: ['shelter-recommendations', id, country],
    queryFn: () => get<{ id: string; distanceKm?: number; explanation: string }[]>(`/requests/${id}/shelter-recommendations`),
    enabled: !!canShelter && q.data?.request.category === 'Shelter',
  });
  const shares = useQuery({
    queryKey: ['partner-case-shares', country, id],
    queryFn: () => get<string[]>(countryPath(`/partner/cases/${id}/shares`, country)),
    enabled: !!id && !!canAssign,
  });
  const [resourceId, setResourceId] = useState(''),
    [deliveryId, setDeliveryId] = useState<string>(),
    [reason, setReason] = useState(''),
    [ignoredRecommendation, setIgnoredRecommendation] = useState(false),
    [decisions, setDecisions] = useState<Record<string, { priority?: Priority; reason?: string }>>({}),
    [downloadError, setDownloadError] = useState<unknown>(null);
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const d = q.data!,
    r = d.request;
  const sharedOrganisations = Array.isArray(shares.data) ? shares.data : [];
  const activeFulfilment = ['Approved', 'InProgress', 'PartiallyFulfilled'].includes(r.status);
  const outstanding = Math.max(0, r.quantity - r.deliveredQuantity - d.allocations
    .filter((a) => a.status === 'Reserved' || a.status === 'Dispatched')
    .reduce((sum, a) => sum + a.quantity, 0));
  const canReserveResources = activeFulfilment && outstanding > 0;
  const suitableResources = resources.data?.filter((x) => x.category === r.category && x.available > 0 && x.transportAvailable !== false) ?? [];
  const selectedResource = suitableResources.find((x) => x.id === resourceId) ?? suitableResources[0];
  const maxReservation = Math.min(outstanding, selectedResource?.available ?? 0);
  const delivery = d.allocations.find((a) => a.id === deliveryId && a.status === 'Dispatched');
  const canReserveShelter = ['Approved', 'InProgress'].includes(r.status) && r.quantity === 1 && r.deliveredQuantity === 0 &&
    !d.placements.some((p) => p.status === 'Reserved' || p.status === 'CheckedIn');
  const compatibleShelters = shelters.data?.filter((s) => s.open && s.available >= r.householdSize && (!r.accessibilityNeeds || s.accessible)) ?? [];
  const suitableShelters = shelterRanking.data
    ? shelterRanking.data.flatMap(candidate => compatibleShelters.filter(s => s.id === candidate.id))
    : compatibleShelters;
  const reservationStatus = ['Submitted', 'UnderReview', 'Verified'].includes(r.status)
    ? `Current status: ${r.status}. The case must be verified and approved before reserving.`
    : `Current status: ${r.status}. There is no eligible outstanding reservation for this case.`;
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
      <NextLink to={fromAssignmentQueue ? '/admin?section=cases' : adminCase ? `/admin/cases${location.search}` : '/staff/cases'}>
        {fromAssignmentQueue ? 'Back to assignment queue' : 'Back to case queue'}
      </NextLink>
      <PageHeader
        title={r.reference}
        description={`${t('category.' + r.category)} · ${r.householdSize} household members`}
        action={<Badge value={r.status} />}
      />
      <MutationMessage mutation={write} />
      {canLogistics && activeFulfilment && r.organisationId && <Link to={`${adminCase ? '/admin' : '/staff'}/supply-support?${new URLSearchParams({
        case: r.id, organisation: r.organisationId, category: r.category,
      })}`}>Request additional supplies for this case</Link>}
      {d.consolidations?.map(link => <p key={link.originalId}>{link.originalId === r.id ? 'Active case ' : 'Consolidated case '}
        <Link to={`${adminCase ? '/admin' : '/staff'}/cases/${link.originalId === r.id ? link.primaryId : link.originalId}`}>
          {link.originalId === r.id ? link.primaryReference : link.originalReference}</Link></p>)}
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
            {!r.organisationId && !['Closed', 'Rejected', 'Cancelled'].includes(r.status) && canAssign && (
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
            {r.organisationId && !['Closed', 'Rejected', 'Cancelled'].includes(r.status) && canAssign && (
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
            {canAssign && (
              <details className="stack">
                <summary>Partner work assignments</summary>
                {shares.error && <ErrorState error={shares.error} />}
                {sharedOrganisations.map((org) => (
                  <div className="inline spread" key={org}>
                    <span>{lookup.data?.organisations.find((entry) => entry.id === org)?.name ?? org}</span>
                    <Button type="button" variant="secondary" busy={write.isPending} onClick={() => write.mutate({
                      path: countryPath(`/partner/cases/${id}/shares/${org}`, country), method: 'delete',
                    })}>Revoke access</Button>
                  </div>
                ))}
                {activeFulfilment && Array.isArray(shares.data) && <form className="stack" onSubmit={(event) => {
                  event.preventDefault();
                  const data = formValues(event.currentTarget);
                  write.mutate({ path: countryPath(`/partner/cases/${id}/shares/${data.partnerId}`, country),
                    method: 'put', data: { title: data.title, instructions: data.instructions } });
                }}>
                  <Field label="Partner organisation"><select name="partnerId" required defaultValue="">
                    <option value="" disabled>Select verified organisation</option>
                    {lookup.data?.organisations.filter((org) => !sharedOrganisations.includes(org.id)).map((org) =>
                      <option key={org.id} value={org.id}>{org.name}</option>)}
                  </select></Field>
                  <Field label="Partner task"><input name="title" required maxLength={160} /></Field>
                  <Field label="Partner instructions" hint="Include the work to perform. Keep citizen contact details out of this assignment.">
                    <textarea name="instructions" required maxLength={1000} />
                  </Field>
                  <Button busy={write.isPending}>Assign partner work</Button>
                </form>}
              </details>
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
                  {ai.data?.recommendations.map((rec) => {
                    const reason = decisions[rec.id]?.reason ?? '';
                    const priority = decisions[rec.id]?.priority ?? rec.priority;
                    const updateDraft = (change: { priority?: Priority; reason?: string }) =>
                      setDecisions((previous) => ({ ...previous, [rec.id]: { ...previous[rec.id], ...change } }));
                    return (
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
                        <span>Current priority <Badge value={r.priority} /></span>
                        <span>AI recommendation <Badge value={rec.priority} /></span>
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
                                onChange={(e) => updateDraft({ priority: e.target.value as Priority })}
                              >
                                {['Low', 'Normal', 'High', 'Critical'].map((p) => (
                                  <option key={p}>{p}</option>
                                ))}
                              </select>
                            </Field>
                            <Field label="Decision / override reason">
                              <input
                                value={reason}
                                onChange={(e) => updateDraft({ reason: e.target.value })}
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
                                disabled={['Modify', 'Reject'].includes(action) && !reason.trim()}
                                onClick={() =>
                                  write.mutate({
                                    path: `/requests/${id}/decisions`,
                                    data: {
                                      recommendationId: rec.id,
                                      action,
                                      finalPriority: action === 'Modify' ? priority : undefined,
                                      finalCategory: action === 'Modify' ? r.category : undefined,
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
                    );
                  })}
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
                      {['Pending', 'Confirmed'].includes(duplicate.state) && ['Submitted', 'UnderReview', 'Verified', 'Approved'].includes(r.status) &&
                        <details>
                          <summary>Consolidate this case into the candidate</summary>
                          <p>Review both requests and verify they describe the same need. Staff retain the original record and stop its separate fulfilment.</p>
                          <form className="stack" onSubmit={event => {
                            event.preventDefault();
                            const values = new FormData(event.currentTarget);
                            write.mutate({ path: `/requests/${id}/consolidate`, data: { primaryRequestId: duplicate.candidateId, reason: values.get('reason') } });
                          }}>
                            <Field label="Consolidation reason"><textarea name="reason" maxLength={1000} required /></Field>
                            <Button busy={write.isPending}>Confirm consolidation</Button>
                          </form>
                        </details>}
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
              {!canReserveResources && <p className="muted">{reservationStatus}</p>}
              {canReserveResources && !selectedResource && !resources.isPending && <p className="muted">No suitable stock is currently available.</p>}
              {resources.error && <ErrorState error={resources.error} />}
              {canReserveResources && selectedResource && <form
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
                  <select name="resourceId" required value={selectedResource.id} onChange={(e) => setResourceId(e.target.value)}>
                    {suitableResources
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
                    key={selectedResource.id}
                    min={isMeasuredUnit(selectedResource.unit) ? 0.01 : 1}
                    step={isMeasuredUnit(selectedResource.unit) ? 0.01 : 1}
                    max={maxReservation}
                    defaultValue={isMeasuredUnit(selectedResource.unit) ? maxReservation : Math.floor(maxReservation)}
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
                      onClick={() => { write.reset(); setDeliveryId(a.id); }}
                    >
                      Confirm delivery
                    </Button>
                  )}
                </div>
              ))}
              {delivery && <OrganisationDialog title="Confirm delivery" busy={write.isPending} onDismiss={() => setDeliveryId(undefined)}>
                <form className="stack logistics-dialog-body" onSubmit={(event) => {
                  event.preventDefault();
                  write.mutate({ path: `/allocations/${delivery.id}/Deliver`, data: deliveryInput(new FormData(event.currentTarget)) },
                    { onSuccess: () => setDeliveryId(undefined) });
                }}>
                  <p>Dispatched quantity · {delivery.quantity}</p>
                  <DeliveryFields quantity={delivery.quantity} unit={resources.data?.find((resource) => resource.id === delivery.resourceId)?.unit} />
                  {write.error && <ErrorState error={write.error} />}
                  <Button busy={write.isPending}>Record receipt</Button>
                </form>
              </OrganisationDialog>}
            </Card>
          )}
          {canShelter && r.category === 'Shelter' && (
            <Card>
              <h2>Shelter placement</h2>
              {!canReserveShelter && <p className="muted">{reservationStatus}</p>}
              {shelters.error && <ErrorState error={shelters.error} />}
              {canReserveShelter && !suitableShelters.length && !shelters.isPending && <p className="muted">No authorised shelter meets the household’s capacity and accessibility needs.</p>}
              {canReserveShelter && suitableShelters.length > 0 && <form
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
                    {suitableShelters
                      .map((s) => (
                        <option value={s.id} key={s.id}>
                          {s.name} · {s.available} spaces ·{' '}
                          {s.accessible ? 'accessible' : 'standard'}
                          {shelterRanking.data?.find(candidate => candidate.id === s.id)?.distanceKm != null &&
                            ` · ${shelterRanking.data.find(candidate => candidate.id === s.id)?.distanceKm} km straight-line`}
                        </option>
                      ))}
                  </select>
                </Field>
                {shelterRanking.data?.[0] && <p>{shelterRanking.data[0].explanation}</p>}
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
  const country = useCountry();
  const q = useQuery({ queryKey: ['resources', country], queryFn: () => get<Resource[]>('/resources') }),
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
            <ResourceLocationFields key={country} country={country} />
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
  const country = useCountry();
  return <CountryShelterManagement key={country} country={country} />;
}

function CountryShelterManagement({ country }: { country: string }) {
  const { t } = useTranslation();
  const write = useWrite();
  const { user } = useAuth();
  const [editing, setEditing] = useState<Shelter | null | undefined>(undefined);
  const isAdmin = user?.roles.some(
    (role) => role === 'Administrator' || role === 'CountryAdministrator',
  );
  const startEditing = (shelter: Shelter | null) => {
    write.reset();
    setEditing(shelter);
  };
  const editorTitle = t(editing ? 'updateShelter' : 'newShelter');
  const editor = editing !== undefined && (
    <form
      key={editing?.id || 'new'}
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        const f = formValues(e.currentTarget);
        write.mutate(
          {
            path:
              (editing ? `/shelters/${editing.id}` : '/shelters') +
              `?countryCode=${encodeURIComponent(country)}`,
            method: editing ? 'put' : 'post',
            data: {
              ...f,
              capacity: Number(f.capacity),
              latitude: Number(f.latitude),
              longitude: Number(f.longitude),
              accessible: f.accessible === 'on',
              open: f.open === 'on',
            },
          },
          { onSuccess: () => setEditing(undefined) },
        );
      }}
    >
      {editing ? (
        <input type="hidden" name="organisationId" value={editing.organisationId} />
      ) : (
        <OrgSelect />
      )}
      <RegionField initialDivisionId={editing?.administrativeDivisionId} />
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
          max={100000}
          defaultValue={editing?.capacity}
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
          defaultValue={editing?.latitude}
          required
        />
      </Field>
      <Field label={t('shelterLongitude')}>
        <input
          name="longitude"
          type="number"
          step="any"
          min={-180}
          max={180}
          defaultValue={editing?.longitude}
          required
        />
      </Field>
      <Field label={t('shelterFacilities')}>
        <input name="facilities" defaultValue={editing?.facilities} />
      </Field>
      <div>
        <label className="checkbox-label">
          <input type="checkbox" name="accessible" defaultChecked={editing?.accessible ?? false} />
          {t('shelterAccessible')}
        </label>
        <label className="checkbox-label">
          <input type="checkbox" name="open" defaultChecked={editing?.open ?? true} />
          {t('shelterOpen')}
        </label>
      </div>
      <Button busy={write.isPending}>{t('saveShelter')}</Button>
      <Button
        type="button"
        variant="ghost"
        disabled={write.isPending}
        onClick={() => setEditing(undefined)}
      >
        {t('closeEditor')}
      </Button>
      {write.error && <ErrorState error={write.error} />}
    </form>
  );
  return (
    <div className="shelter-management">
      <PageHeader
        title={t('staffShelters')}
        description={
          isAdmin
            ? 'Monitor capacity, accommodation and operational readiness.'
            : t('shelterManagementDescription')
        }
        action={
          <Button onClick={() => startEditing(null)}>
            <Plus size={18} aria-hidden="true" />
            {t('addShelter')}
          </Button>
        }
      />
      {editing === undefined && <MutationMessage mutation={write} />}
      {editing !== undefined &&
        (isAdmin ? (
          <WorkspaceDialog
            title={editorTitle}
            busy={write.isPending}
            onDismiss={() => setEditing(undefined)}
            className="shelter-dialog"
          >
            {editor}
          </WorkspaceDialog>
        ) : (
          <Card>
            <h2>{editorTitle}</h2>
            {editor}
          </Card>
        ))}
      <ShelterDashboard country={country} onEdit={startEditing} specialist={!isAdmin} />
    </div>
  );
}
