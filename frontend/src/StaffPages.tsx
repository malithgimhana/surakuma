import FulfillmentPlanning from './FulfillmentPlanning';
import { CaseDispatches } from './CaseDispatches';
import { shipmentCode } from './logistics';
import type { ItemReviewMode } from './FulfillmentPlanning';
import AllocationPreparation from './AllocationPreparation';
import { allocationLimit, allocationPath, groupAllocationSources } from './allocationSources';
import { RegionField, useCountry } from './geography';
import { countryPath, refreshCaseAfterWrite } from './crisisOperationsApi';
import { Fragment, useEffect, useState } from 'react';
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
  ClipboardList,
  Download,
  Plus,
  Search,
  Sparkles,
  Zap,
} from 'lucide-react';
import { api, errorMessage, get } from './api';
import { useAuth } from './auth';
import { coordinatorPath, isCaseManagerWorkspace, isCoordinatorWorkspace, isShelterWorkspace, shelterPath } from './countryScope';
import CoordinatorCases from './CoordinatorCases';
import CoordinatorResources from './CoordinatorResources';
import { caseAmounts, CaseManagerDetailLayout, PanelTitle } from './CaseManagerUi';
import { CaseManagerQueue } from './CaseManagerQueue';
import { CaseCommunicationPanel } from './CaseCommunicationPanel';
import { AssessmentBadge, CitizenTriageCard } from './CitizenTriageCard';
import { intakeLabel } from './CitizenIntakeFields';
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
import { baseUnit, isMeasuredUnit, stockLevelStep, unitSymbol } from './quantity';
import { ResourceUnitSelect } from './ResourceUnitSelect';
import { ShelterDashboard } from './ShelterDashboard';
import { WorkspaceDialog } from './OrganisationDialog';
import type {
  AidRequest,
  AllocationRecommendations,
  AiDetail,
  Category,
  FulfilmentEvidence,
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

function useWrite(caseId?: string) {
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
    onSuccess: (_, { path }) => {
      if (caseId && (path === `/requests/${caseId}/status` || path === '/allocations' || path.startsWith('/allocations/')))
        return refreshCaseAfterWrite(client, caseId);
      return client.invalidateQueries();
    },
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
  const { user } = useAuth();
  const location = useLocation();
  return isCaseManagerWorkspace(user, location.pathname, location.search) ? <CaseManagerQueue /> :
    isCoordinatorWorkspace(user, location.pathname, location.search) ? <CoordinatorCases /> : <StaffCaseQueue />;
}

function StaffCaseQueue() {
  const { pathname, search: queueSearch } = useLocation();
  const country = useCountry();
  const [params] = useSearchParams();
  const adminQueue = pathname === '/admin/cases';
  const view = params.get('view');
  const staffRole = adminQueue ? '' : params.get('role') ?? '';
  const casePath = (id: string) => adminQueue ? `/admin/cases/${id}${queueSearch}` :
    `/staff/cases/${id}${staffRole ? '?role=' + encodeURIComponent(staffRole) : ''}`;
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
            <Link to={casePath(request.id)}>{request.reference}</Link> · {t('category.' + request.category)} · {t('status.' + request.status)}
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
              <Link to={casePath(request.id)}>{request.reference}</Link> · {request.category} · {request.locationText}
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
                    <th>{t('requestedAid')}</th>
                    <th>Priority</th>
                    <th>Score</th>
                    <th>AI assessment</th>
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
                        <strong>{intakeLabel(r.category, r.intake) ?? t('category.' + r.category)}</strong> · {caseAmounts(r).requested}
                        <small className="case-queue-description">{r.description}</small>
                        <small>
                          {r.householdSize} people · {(r.intake?.supplyItems?.length ?? 0) > 1
                            ? caseAmounts(r).outstanding
                            : `${Number((r.quantity - r.deliveredQuantity).toFixed(5))} ${unitSymbol(r.unit)} outstanding`}
                          {r.unitRequiresClarification && ` · ${t('unitRequiresClarification')}`}
                        </small>
                      </td>
                      <td>
                        <Badge value={r.priority} />
                        {r.immediateDanger && <small className="field-error">Immediate danger</small>}
                      </td>
                      <td>{r.priorityScore ?? '—'}</td>
                      <td><AssessmentBadge state={r.assessmentState} /></td>
                      <td>
                        <Badge value={r.status} />
                      </td>
                      <td>{r.locationText}</td>
                      <td>
                        <Link className="text-link" to={casePath(r.id)}>
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
    write = useWrite(id);
  const adminCase = location.pathname.startsWith('/admin/');
  const managerWorkspace = isCaseManagerWorkspace(user, location.pathname, location.search);
  const coordinatorWorkspace = isCoordinatorWorkspace(user, location.pathname, location.search);
  const fromAssignmentQueue = adminCase && new URLSearchParams(location.search).get('source') === 'triage';
  const canAssign = !managerWorkspace && (user?.roles.includes('Coordinator') || (adminCase &&
    user?.roles.some(role => role === 'Administrator' || role === 'CountryAdministrator')));
  const q = useQuery({
    queryKey: ['staff-case', id, country, managerWorkspace, coordinatorWorkspace],
    queryFn: () => get<RequestDetail>(`/requests/${id}`),
    refetchInterval: query => query.state.data?.request.assessmentState === 'Pending' ? 2500 :
      query.state.data?.request.intake ? 60000 : false,
  });
  const shipmentId = new URLSearchParams(location.search).get('shipment');
  useEffect(() => {
    if (shipmentId && q.data) document.getElementById(`shipment-${shipmentId}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [shipmentId, q.data]);
  const caseManagers = useQuery({
    queryKey: ['case-managers', id],
    queryFn: () => get<{ id: string; name: string; availableForAssignment: boolean }[]>(`/requests/${id}/case-managers`),
    enabled: !!id && !!canAssign,
  });
  const canCase = user?.roles.some((r) => ['Administrator', 'CountryAdministrator', 'Coordinator', 'CaseManager'].includes(r)),
    canLogistics = !managerWorkspace && user?.roles.some((r) => ['Administrator', 'CountryAdministrator', 'Coordinator', 'Logistics'].includes(r)),
    canShelter = !managerWorkspace && user?.roles.some((r) => ['Administrator', 'CountryAdministrator', 'Coordinator', 'ShelterAdmin'].includes(r));
  const manageLogistics = !managerWorkspace && !coordinatorWorkspace &&
    user?.roles.some(role => ['Administrator', 'CountryAdministrator', 'Logistics'].includes(role));
  const manageShelter = !managerWorkspace && !coordinatorWorkspace &&
    user?.roles.some(role => ['Administrator', 'CountryAdministrator', 'ShelterAdmin'].includes(role));
  const ai = useQuery({
    queryKey: ['ai', id, country, managerWorkspace, coordinatorWorkspace],
    queryFn: () => get<AiDetail>(`/requests/${id}/recommendations`),
    enabled: canCase,
    refetchInterval: query => ['Queued', 'Processing'].includes(query.state.data?.processing?.state ?? '') ? 2000 : false,
  });
  const resources = useQuery({
    queryKey: ['case-resources', id],
    queryFn: () => get<Resource[]>(`/requests/${id}/resources`),
    enabled: canLogistics,
  });
  const allocationRecommendations = useQuery({
    queryKey: ['allocation-recommendations', id],
    queryFn: () => get<AllocationRecommendations>(`/requests/${id}/allocation-recommendations`),
    enabled: canLogistics && !!id && !q.data?.items?.length,
  });
  const shelters = useQuery({
    queryKey: ['case-shelters', id],
    queryFn: () => get<Shelter[]>(`/requests/${id}/shelters`),
    enabled: !!canShelter && q.data?.request.category === 'Shelter',
  });
  const shelterRanking = useQuery({
    queryKey: ['shelter-recommendations', id, country],
    queryFn: () => get<{ id: string; distanceKm?: number; explanation: string; score?: number; evidence?: FulfilmentEvidence }[]>(`/requests/${id}/shelter-recommendations`),
    enabled: !!canShelter && q.data?.request.category === 'Shelter',
  });
  const shares = useQuery({
    queryKey: ['partner-case-shares', country, id],
    queryFn: () => get<string[]>(countryPath(`/partner/cases/${id}/shares`, country)),
    enabled: !!id && !!canAssign,
  });
  const [resourceId, setResourceId] = useState(''),
    [allocationOperationId, setAllocationOperationId] = useState(() => crypto.randomUUID()),
    [deliveryId, setDeliveryId] = useState<string>(),
    [reason, setReason] = useState(''),
    [ignoredRecommendation, setIgnoredRecommendation] = useState(false),
    [decisions, setDecisions] = useState<Record<string, { priority?: Priority; category?: Category; reason?: string }>>({}),
    [downloadError, setDownloadError] = useState<unknown>(null);
  const [itemReview, setItemReview] = useState<{ caseId: string; mode: ItemReviewMode }>();
  const historyReady = !!ai.data?.decisions.length;
  useEffect(() => {
    if (managerWorkspace && location.hash === '#ai-history' && historyReady)
      document.getElementById('ai-history')?.scrollIntoView?.();
  }, [managerWorkspace, location.hash, historyReady, id]);
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const d = q.data!,
    r = d.request;
  const changeItemReview = (mode: ItemReviewMode) => setItemReview({ caseId: r.id, mode });
  const recommendation = ai.data?.recommendations[0];
  const decisionDraft = recommendation && decisions[recommendation.id];
  const decisionReason = decisionDraft?.reason ?? '';
  const decisionPriority = decisionDraft?.priority ?? recommendation?.priority;
  const updateDecisionDraft = (recommendationId: string, change: { priority?: Priority; category?: Category; reason?: string }) =>
    setDecisions(previous => ({ ...previous, [recommendationId]: { ...previous[recommendationId], ...change } }));
  const sharedOrganisations = Array.isArray(shares.data) ? shares.data : [];
  const activeFulfilment = ['Approved', 'InProgress', 'PartiallyFulfilled'].includes(r.status);
  const hasCaseItems = Boolean(d.items?.length);
  const candidates = allocationRecommendations.data?.candidates ?? [];
  const outstanding = allocationRecommendations.data?.outstanding ?? 0;
  const canReserveResources = !hasCaseItems && activeFulfilment && !r.unitRequiresClarification && outstanding > 0;
  const suitableResources = groupAllocationSources(resources.data?.filter((resource) =>
    candidates.some(candidate => candidate.resourceId === resource.id && candidate.transportAvailable)) ?? []);
  const selectedResource = suitableResources.find(source => source.resourceIds.includes(resourceId)) ?? suitableResources[0];
  const maxReservation = selectedResource && r.unit ? allocationLimit(selectedResource, outstanding, r.unit) : 0;
  const selectResource = (id: string) => {
    setResourceId(id);
    setAllocationOperationId(crypto.randomUUID());
  };
  const delivery = d.allocations.find((a) => a.id === deliveryId && a.status === 'Dispatched');
  const canReserveShelter = ['Approved', 'InProgress'].includes(r.status) && r.quantity === 1 && r.deliveredQuantity === 0 &&
    !d.placements.some((p) => p.status === 'Reserved' || p.status === 'CheckedIn');
  const compatibleShelters = shelters.data?.filter((s) => s.open && s.available >= r.householdSize && (!r.accessibilityNeeds || s.accessible)) ?? [];
  const suitableShelters = shelterRanking.data
    ? shelterRanking.data.flatMap(candidate => compatibleShelters.filter(s => s.id === candidate.id))
    : compatibleShelters;
  const reservationStatus = r.unitRequiresClarification ? 'Confirm the requested unit before reserving resources.' :
    ['Submitted', 'UnderReview', 'Verified'].includes(r.status)
    ? `Current status: ${r.status}. The case must be verified and approved before reserving.`
    : `Current status: ${r.status}. There is no eligible outstanding reservation for this case.`;
  const recommended = candidates.find((candidate) => candidate.transportAvailable);
  const openCase = !['Fulfilled', 'Closed', 'Rejected', 'Cancelled'].includes(r.status);
  const generationPath = `/requests/${id}/recommendations/generate`;
  const generationActive = write.variables?.path === generationPath;
  const generating = generationActive && write.isPending;
  const generateRecommendation = (
    <div className={managerWorkspace ? 'stack cm-generate-advice' : 'stack'}>
      <Button type="button" variant="secondary" busy={generating} disabled={write.isPending}
        onClick={() => write.mutate({ path: generationPath })}>
        {generating ? 'Generating recommendation…' : 'Generate recommendation'}
      </Button>
      {generationActive && write.isSuccess && <p role="status" className="success-text">
        {!ai.isError && recommendation?.fallback ? 'Recommendation refreshed using local rules.' : 'Recommendation refreshed.'}
      </p>}
      {generationActive && write.isError && <p role="alert">
        Could not generate a recommendation. {errorMessage(write.error)}
      </p>}
      {generating && <p role="status">Checking case details and preparing a recommendation.</p>}
    </div>
  );
  const next = coordinatorWorkspace && r.status !== 'Fulfilled' ? undefined : (
    {
      Submitted: 'UnderReview',
      UnderReview: 'Verified',
      Verified: 'Approved',
      Fulfilled: 'Closed',
    } as Record<string, string>
  )[r.status];

  const nextLabel = next && ({ UnderReview: 'Begin review', Verified: 'Verify request', Approved: 'Approve case',
    Closed: 'Close completed case' } as Record<string, string>)[next];
  const feedback = !!d.feedback?.length && (
              <section aria-label="Citizen feedback">
                <h3>Citizen feedback</h3>
                {d.feedback.map((f) => (
                  <div className="recommendation" key={f.id}>
                    <strong>
                      {f.rating}/5 · {f.received ? 'Receipt confirmed' : 'Receipt not confirmed'}
                    </strong>
                    {f.problem && <Badge value="Warning" />}
                    {f.isSuperseded && <p className="muted">Historical duplicate retained for audit</p>}
                    <p>{f.comment}</p>
                    <small className="muted">{formatDate(f.createdAt)}</small>
                  </div>
                ))}
              </section>
            );
  const measurement = canCase && openCase && (r.unitRequiresClarification || !r.administrativeDivisionId) && (
              <details>
                <summary>{r.unitRequiresClarification ? 'Clarify requested unit or region' : 'Record administrative region'}</summary>
                <form className="stack" onSubmit={event => {
                  event.preventDefault();
                  const fields = new FormData(event.currentTarget);
                  write.mutate({ path: countryPath(`/requests/${id}/measurement`, country), method: 'patch', data: {
                    unit: fields.get('unit') || null, administrativeDivisionId: fields.get('administrativeDivisionId') || null,
                    reason: fields.get('reason'),
                  } });
                }}>
                  {r.unitRequiresClarification && <Field label="Confirmed request unit" hint="Confirm with the citizen or supporting case records.">
                    <ResourceUnitSelect name="unit" category={r.category} allowPersons={r.category !== 'FoodWater'} />
                  </Field>}
                  <RegionField key={country} initialDivisionId={r.administrativeDivisionId} />
                  <Field label="Source and reason"><textarea name="reason" maxLength={1000} required /></Field>
                  <Button busy={write.isPending}>Save measurement clarification</Button>
                </form>
              </details>
            );
  const attachments = d.attachments.map((file) => (
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
            ));
  const consolidations = d.consolidations?.map(link => <p key={link.originalId}>{link.originalId === r.id ? 'Active case ' : 'Consolidated case '}
        <Link to={`${adminCase ? '/admin' : '/staff'}/cases/${link.originalId === r.id ? link.primaryId : link.originalId}`}>
          {link.originalId === r.id ? link.primaryReference : link.originalReference}</Link></p>);
  const duplicates = ai.data?.duplicates.map((duplicate) => (
                    <div className="recommendation" key={duplicate.id}>
                      <strong>
                        Potential duplicate · {(duplicate.similarity * 100).toFixed(0)}% match · {duplicate.model ?? 'Token overlap'}
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
                      {duplicate.state === 'Confirmed' && ['Submitted', 'UnderReview', 'Verified', 'Approved'].includes(r.status) &&
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
                  ));
  const aiPanel = canCase && (r.intake ? <>
    {ai.isError && <ErrorState error={ai.error} retry={() => void ai.refetch()} />}
    <CitizenTriageCard detail={d} advice={ai.data} canReview={openCase && !coordinatorWorkspace} />
    {id && <CaseCommunicationPanel requestId={id} country={country} />}
  </> : (
            <Card className={managerWorkspace ? "cm-panel cm-ai" : undefined}>
              {managerWorkspace ? <>
                <PanelTitle icon={Sparkles} title="AI advice only — Human decisions first"
                  action={recommendation && <Badge value={recommendation.reviewState} />} />
              </> : (
              <div className="section-heading">
                <div>
                  <span className="eyebrow">HUMAN DECISIONS FIRST</span>
                  <h2>
                    <BrainCircuit size={23} /> AI decision support
                  </h2>
                </div>
                {generateRecommendation}
              </div>
              )}
              {ai.isPending ? (
                <Loading />
              ) : ai.error ? (
                <ErrorState error={ai.error} />
              ) : (
                <>
                  {ai.data?.processing && <p role="status">
                    Request analysis · {ai.data.processing.state}
                    {ai.data.processing.state === 'Failed' && ` · ${ai.data.processing.failureReason}`}
                  </p>}
                  {recommendation ? (
                    <div className={managerWorkspace ? 'cm-case-advice' : 'recommendation'} key={recommendation.id}>
                      {!managerWorkspace && <div className="inline spread">
                        <strong>
                          {recommendation.provider} · {recommendation.model}
                        </strong>
                        <Badge value={recommendation.reviewState} />
                      </div>}
                      {recommendation.fallback && (
                        <div className="fallback-label">
                          LOCAL RULES FALLBACK
                        </div>
                      )}
                      <div className={managerWorkspace ? 'cm-advice-facts' : 'inline'}>
                        <span>Current priority <Badge value={r.priority} /></span>
                        <span>AI recommendation <Badge value={recommendation.priority} /></span>
                        <span>Suggested category: <strong>{t('category.' + recommendation.category)}</strong></span>
                        {managerWorkspace && <p>{recommendation.explanation}</p>}
                        <span className="muted">
                          Confidence: {recommendation.confidence === null ? 'unavailable' : recommendation.confidence} (
                          {recommendation.confidenceKind})
                        </span>
                        {managerWorkspace && recommendation.model && <span className="muted">Model: {recommendation.provider} · {recommendation.model}</span>}
                      </div>
                      {!managerWorkspace && <p>{recommendation.explanation}</p>}
                      {recommendation.urgencyScore != null && <div className="stack">
                        <strong>Urgency {recommendation.urgencyScore}/100 · Rules-based score</strong>
                        {recommendation.urgencyFactorsJson && <ul>
                          {(JSON.parse(recommendation.urgencyFactorsJson) as { label: string; points: number }[]).map(factor =>
                            <li key={factor.label}>{factor.label} (+{factor.points})</li>)}
                        </ul>}
                        {recommendation.signalsJson && <p>Extracted needs and indicators · {
                          (JSON.parse(recommendation.signalsJson) as string[]).join(', ') || 'None recorded'
                        }</p>}
                      </div>}
                      {managerWorkspace && <p className="muted cm-ai-disclaimer">Approving advice can update priority or category. It does not approve the case.</p>}
                      {!coordinatorWorkspace && (!managerWorkspace || openCase) && ['Pending', 'Defer'].includes(recommendation.reviewState) && (
                        <>
                          <div className="form-grid">
                            <Field label="Final priority for modification">
                              <select
                                value={decisionPriority}
                                onChange={(e) => updateDecisionDraft(recommendation.id, { priority: e.target.value as Priority })}
                              >
                                {['Low', 'Normal', 'High', 'Critical'].map((p) => (
                                  <option key={p}>{p}</option>
                                ))}
                              </select>
                            </Field>
                            <Field label="Final category for modification">
                              <select value={decisionDraft?.category ?? r.category} onChange={e =>
                                updateDecisionDraft(recommendation.id, { category: e.target.value as Category })}>
                                {categories.map(category => <option key={category} value={category}>{t('category.' + category)}</option>)}
                              </select>
                            </Field>
                            <Field label="Decision / override reason">
                              <input
                                value={decisionReason}
                                onChange={(e) => updateDecisionDraft(recommendation.id, { reason: e.target.value })}
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
                                disabled={['Modify', 'Reject'].includes(action) && !decisionReason.trim()}
                                onClick={() =>
                                  write.mutate({
                                    path: `/requests/${id}/decisions`,
                                    data: {
                                      recommendationId: recommendation.id,
                                      action,
                                      finalPriority: action === 'Modify' ? decisionPriority : undefined,
                                      finalCategory: action === 'Modify' ? decisionDraft?.category ?? r.category : undefined,
                                      reason: decisionReason,
                                    },
                                  })
                                }
                              >
                                {managerWorkspace && action === 'Approve' ? 'Approve recommendation' : action}
                              </Button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="muted">
                      {['Queued', 'Processing'].includes(ai.data?.processing?.state ?? '') ? 'A recommendation will appear when processing finishes.' : 'No recommendation yet.'}
                    </p>
                  )}
                  {!managerWorkspace && duplicates}
                  {ai.data?.decisions.length ? (
                    <details id={managerWorkspace ? 'ai-history' : undefined} open={managerWorkspace && location.hash === '#ai-history' ? true : undefined}>
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
              {managerWorkspace && openCase && generateRecommendation}
              {id && <CaseCommunicationPanel requestId={id} country={country} />}
            </Card>
          ));
  const canEscalate = (!managerWorkspace || !r.escalated) && !['Closed', 'Rejected', 'Cancelled'].includes(r.status);
  const actionNote = (
    <Field label="Reason / case note" hint="Visible to authorised staff only.">
      <textarea value={reason} disabled={write.isPending} onChange={e => setReason(e.target.value)} rows={managerWorkspace ? 2 : 3} maxLength={1000} />
    </Field>
  );
  const escalationActions = <>
    {r.escalated && <Button variant="secondary" busy={write.isPending} disabled={managerWorkspace && !reason.trim()} onClick={() =>
      write.mutate({ path: `/requests/${id}/escalation/resolve`, data: { note: reason } }, { onSuccess: () => setReason('') })
    }>Resolve follow-up</Button>}
    {canEscalate && <Button variant="secondary" busy={write.isPending} disabled={managerWorkspace && !reason.trim()} onClick={() =>
      write.mutate({ path: `/requests/${id}/escalate`, data: { action: 'Escalate', note: reason } }, { onSuccess: () => setReason('') })
    }>{coordinatorWorkspace ? 'Record escalation' : 'Escalate for coordinator'}</Button>}
  </>;
  const actionPanel = canCase && (
    <section id="case-actions" aria-label="Case actions">
            <Card className={managerWorkspace ? 'cm-panel cm-next-action' : undefined}>
              {managerWorkspace ? <PanelTitle icon={Zap} title="Next Case Action" /> : <h2>Case actions</h2>}
              {managerWorkspace && <div className="cm-action-callout">
                <strong>{nextLabel ?? (activeFulfilment ? 'Monitor fulfilment' : r.escalated ? 'Resolve follow-up' : 'No transition available')}</strong>
                <p>{r.category !== 'Shelter' && r.status === 'Approved' && r.requiresCoordinatorAuthorization && !r.authorizedAt
                  ? 'The case is visible to Logistics. The Crisis Coordinator must authorize fulfilment before staff can reserve stock.'
                  : activeFulfilment ? 'Follow confirmed deliveries here. Escalate if the case needs coordinator attention.' :
                   next ? 'Review the recorded needs before moving this case to its next stage.' :
                   r.escalated ? 'Record how the follow-up was addressed before resolving it.' : 'This case has reached its final status.'}</p>
              </div>}
              {managerWorkspace && activeFulfilment && <a className="cm-fulfilment-link" href="#fulfilment">
                <Boxes size={18} aria-hidden="true" />View fulfilment summary <ArrowRight aria-hidden="true" size={16} />
              </a>}
              {(!managerWorkspace || next) && actionNote}
              <div className="stack">
                {next && (
                  <Button
                    busy={write.isPending}
                    onClick={() =>
                      write.mutate({
                        path: `/requests/${id}/status`,
                        method: 'patch',
                        data: { status: next, reason },
                      }, { onSuccess: () => {
                        setReason('');
                        if (managerWorkspace && next === 'UnderReview' && r.category !== 'Shelter')
                          changeItemReview('open');
                      } })
                    }
                  >
                    {nextLabel}
                  </Button>
                )}
                {managerWorkspace && !next ? (r.escalated || canEscalate) && <details className="cm-secondary-case-actions">
                  <summary>{r.escalated ? 'Manage open follow-up' : 'Escalate to coordinator'}</summary>
                  <div className="stack">{actionNote}{escalationActions}</div>
                </details> : escalationActions}
                {!coordinatorWorkspace && ['UnderReview', 'Verified'].includes(r.status) && (
                  <Button
                    variant="danger"
                    busy={write.isPending}
                    disabled={managerWorkspace && !reason.trim()}
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
    </section>
          );

  if (managerWorkspace) return <CaseManagerDetailLayout detail={d} currentUser={user?.id}
    organisation={lookup.data?.organisations?.find(org => org.id === r.organisationId)?.name}
    crisis={lookup.data?.crises?.find(item => item.id === r.crisisId)?.name}
    assigned={r.assignedCaseManagerId && r.assignedCaseManagerId === user?.id ? 'You' : r.assignedCaseManagerId ? 'Assigned' : 'Awaiting assignment'}
    ai={aiPanel} actions={actionPanel}
    notices={<>{!generationActive && <MutationMessage mutation={write} />}{consolidations}
      {r.status === 'Verified' && <div className="cm-action-callout">
        <strong>Case verified. Approval is still needed.</strong>
        <p>{r.category === 'Shelter'
          ? 'Approve this case to make it available for shelter placement.'
          : 'Approve this case to send it to the Case Fulfillment queue.'}</p>
        <a href="#case-actions">Go to case approval</a>
      </div>}
      {r.category !== 'Shelter' && <FulfillmentPlanning key={r.id} id={r.id} caseStatus={r.status} editor={{
        mode: itemReview?.caseId === r.id ? itemReview.mode : 'closed',
        onChange: changeItemReview,
      }} />}</>}
    supporting={(measurement || d.attachments.length > 0 || feedback || !!ai.data?.duplicates.length) && (
      <Card className="cm-panel cm-support">
        <PanelTitle icon={ClipboardList} title="Supporting case information" />
        {measurement}
        {d.attachments.length > 0 && <details><summary>Attachments and evidence ({d.attachments.length})</summary>
          <div className="button-row">{attachments}</div>{!!downloadError && <ErrorState error={downloadError} />}
        </details>}
        {feedback && <details><summary>Citizen feedback ({d.feedback?.length})</summary>{feedback}</details>}
        {!!ai.data?.duplicates.length && <details><summary>Potential duplicates ({ai.data.duplicates.length})</summary>{duplicates}</details>}
      </Card>
    )} />;
  const previousQueue = (location.state as { caseQueue?: string } | null)?.caseQueue;
  return (
    <div className={coordinatorWorkspace ? 'coord-page coord-case-detail' : undefined}>
      <NextLink to={fromAssignmentQueue ? '/admin?section=cases' : adminCase ? `/admin/cases${location.search}` :
        coordinatorWorkspace ? previousQueue?.startsWith('/staff/cases?') ? previousQueue : coordinatorPath('/cases') : '/staff/cases'}>
        {fromAssignmentQueue ? 'Back to assignment queue' : 'Back to case queue'}
      </NextLink>
      <PageHeader
        title={r.reference}
        description={`${t('category.' + r.category)} · ${r.householdSize} household members`}
        action={<Badge value={r.status} />}
      />
      {coordinatorWorkspace && (d.hasStockShortage || r.escalated || r.unitRequiresClarification ||
        activeFulfilment && r.requiresCoordinatorAuthorization && !r.authorizedAt) && <Card className="coord-blockers">
        <h2>Operational blockers</h2>
        <ul>
          {d.hasStockShortage && <li>Suitable stock is insufficient for outstanding approved needs. <a href="#case-stock">Check resource availability</a></li>}
          {r.escalated && <li>An escalation is open. <a href="#case-actions">Review escalation</a></li>}
          {r.unitRequiresClarification && <li>The requested unit needs clarification.</li>}
          {activeFulfilment && r.requiresCoordinatorAuthorization && !r.authorizedAt && <li>Fulfilment is awaiting coordinator authorization.</li>}
        </ul>
      </Card>}
      {!generationActive && <MutationMessage mutation={write} />}
      {r.category !== 'Shelter' && <FulfillmentPlanning id={r.id} caseStatus={r.status} />}
      {coordinatorWorkspace && r.requiresCentreHandover && <CaseDispatches id={r.id} mode="coordinator" />}
      {manageLogistics && activeFulfilment && r.organisationId && r.unit && baseUnit(r.unit) !== 'persons' && r.category !== 'Shelter' && <Link to={`${adminCase ? '/admin' : '/staff'}/supply-support?${new URLSearchParams({
        case: r.id, organisation: r.organisationId, category: r.category, unit: r.unit,
      })}`}>Request additional supplies for this case</Link>}
      {consolidations}
      <div className="case-grid">
        <div className="stack">
          <Card>
            <div className="inline spread">
              <h2>Request details</h2>
              <Badge value={r.priority} />
            </div>
            <dl className="review-grid">
              <dt>{t('requestedAid')}</dt>
              <dd><strong>{t('category.' + r.category)}</strong></dd>
              {!hasCaseItems && <><dt>{t('quantity')}</dt>
              <dd>
                <strong>{r.quantity} {unitSymbol(r.unit)}</strong>
                {r.unitRequiresClarification && ` · ${t('unitRequiresClarification')}`}
              </dd></>}
              {(!r.intake || !canCase) && <>
                <dt>{t('citizenRequestDescription')}</dt>
                <dd className="case-request-description">{r.description}</dd>
              </>}
              <dt>Location</dt>
              <dd>{r.locationText}</dd>
              <dt>Administrative region</dt>
              <dd>{d.administrativeRegion || 'Region unrecorded'}</dd>
              <dt>Accessibility needs</dt>
              <dd>{r.accessibilityNeeds || 'None reported'}</dd>
              {hasCaseItems ? d.items?.map(item => <Fragment key={item.id}>
                <dt>{item.name}</dt><dd>{item.deliveredQuantity} / {item.approvedQuantity} {unitSymbol(item.unit)}</dd>
              </Fragment>) : <><dt>Delivered / requested</dt>
              <dd>
                {r.deliveredQuantity} / {r.quantity} {unitSymbol(r.unit)}
              </dd></>}
              <dt>Organisation</dt>
              <dd>{lookup.data?.organisations.find((o) => o.id === r.organisationId)?.name || 'Awaiting assignment'}</dd>
              <dt>Case manager</dt>
              <dd>{caseManagers.data?.find((manager) => manager.id === r.assignedCaseManagerId)?.name || (r.assignedCaseManagerId === user?.id ? 'You' : r.assignedCaseManagerId ? 'Assigned' : 'Awaiting assignment')}</dd>
              {r.requestedForSomeoneElse && <>
                <dt>Requester's relationship</dt><dd>{r.requesterRelationship || 'Not provided'}</dd>
                <dt>Requester contact</dt><dd>{r.requesterContact || 'Not provided'}</dd>
              </>}
            </dl>
            {feedback}
            {measurement}
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
            {attachments}
            {!!downloadError && <ErrorState error={downloadError} />}
          </Card>
            {aiPanel}
          {canLogistics && r.category !== 'Shelter' && (
            <Card>
              <h2>{manageLogistics ? 'Resource allocation' : 'Delivery progress'}</h2>
              {coordinatorWorkspace && <div className="button-row" id="case-stock">
                {(hasCaseItems ? [...new Set(d.items?.map(item => item.category ?? r.category))] : [r.category]).map(category =>
                  <Link key={category} className="button secondary" to={coordinatorPath('/resources', {
                    category, ...(r.organisationId ? { organisation: r.organisationId } : {}),
                  })}>Check stock · {t('category.' + category)}</Link>)}
              </div>}
              {manageLogistics && <p className="muted">
                Stock, category, unit, transport and outstanding quantity are checked before reservation.
                Staff must verify suitability and location.
              </p>}
              {manageLogistics && hasCaseItems && <p>Reserve stock for each item in Case Fulfillment.</p>}
              {!manageLogistics && hasCaseItems && (
                <ul className="ledger">
                  {d.items?.map(item => <li key={item.id}>
                    <strong>{item.name}</strong>
                    <small>{item.deliveredQuantity} of {item.approvedQuantity} {unitSymbol(item.unit)} delivered</small>
                  </li>)}
                </ul>
              )}
              {!manageLogistics && !hasCaseItems && <p>{r.deliveredQuantity} of {r.quantity} {unitSymbol(r.unit)} delivered</p>}
              {!hasCaseItems && allocationRecommendations.error && <ErrorState error={allocationRecommendations.error} />}
              {!hasCaseItems && allocationRecommendations.data && (
                <section aria-label="Allocation recommendations" className="recommendation">
                  <h3>Suggested resources</h3>
                  <p>Recommendations only; staff confirm suitability and reserve manually.</p>
                  <p>{allocationRecommendations.data.shortageExplanation}</p>
                  {allocationRecommendations.data.evidence && <p className="muted">
                    {allocationRecommendations.data.evidence.algorithm} · {allocationRecommendations.data.evidence.source} · {allocationRecommendations.data.evidence.processingState} · {allocationRecommendations.data.evidence.reviewState}
                  </p>}
                  {allocationRecommendations.data.shortage && <p className="field-error">Potential shortage. Queue position: {allocationRecommendations.data.queuePosition || 'not eligible'} of {allocationRecommendations.data.competingRequests}.</p>}
                  {allocationRecommendations.data.candidates.length === 0 && !r.unitRequiresClarification && <p>No matching resource with available stock was found.</p>}
                  {allocationRecommendations.data.candidates.map((candidate, index) => (
                    <div key={candidate.resourceId}>
                      <strong>{index === 0 ? 'Preferred' : index === 1 ? 'Next-best alternative' : 'Alternative'}: {candidate.name} · score {candidate.score}</strong>
                      <p>{candidate.reason}</p>
                      {candidate.shortForRequest && <p>{candidate.remainingAfterReservation} {unitSymbol(r.unit)} would remain after reserving {candidate.suggestedQuantity} {unitSymbol(candidate.unit)}.</p>}
                      {manageLogistics && <Button type="button" variant="secondary" onClick={() => selectResource(candidate.resourceId)}>Choose for review</Button>}
                    </div>
                  ))}
                  {manageLogistics && recommended && !ignoredRecommendation && <Button type="button" variant="ghost" busy={write.isPending} onClick={() => write.mutate({ path: `/requests/${id}/allocation-recommendations/ignore`, data: { recommendedResourceId: recommended.resourceId } }, { onSuccess: () => setIgnoredRecommendation(true) })}>Ignore suggestion</Button>}
                </section>
              )}
              {canReserveResources && <p>{outstanding} {unitSymbol(r.unit)} outstanding after existing commitments.</p>}
              {!hasCaseItems && !canReserveResources && <p className="muted">{reservationStatus}</p>}
              {canReserveResources && !selectedResource && !resources.isPending && <p className="muted">No suitable stock is currently available.</p>}
              {resources.error && <ErrorState error={resources.error} />}
              {manageLogistics && canReserveResources && selectedResource && <form
                className="form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = formValues(e.currentTarget);
                  const quantity = Number(f.quantity);
                  if (write.isPending || quantity <= 0 || quantity > maxReservation) return;
                  write.mutate({
                    path: allocationPath(selectedResource),
                    data: { requestId: id, resourceId: selectedResource.id, quantity, operationId: allocationOperationId,
                      recommendedResourceId: ignoredRecommendation ? null : recommended?.resourceId },
                  }, { onSuccess: () => setAllocationOperationId(crypto.randomUUID()), onError: () => void allocationRecommendations.refetch() });
                }}
              >
                <Field label="Resource">
                  <select name="resourceId" required value={selectedResource.id} onChange={(e) => selectResource(e.target.value)}>
                    {suitableResources
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name} · {x.available} {unitSymbol(x.unit)} available · {x.locationText}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Quantity" hint={`Enter the quantity in ${unitSymbol(selectedResource.unit)}.`}>
                  <input
                    type="number"
                    name="quantity"
                    key={`${selectedResource.id}:${maxReservation}`}
                    min={isMeasuredUnit(selectedResource.unit) ? 0.01 : 1}
                    step={isMeasuredUnit(selectedResource.unit) ? 0.01 : 1}
                    max={maxReservation}
                    defaultValue={maxReservation}
                    onChange={() => setAllocationOperationId(crypto.randomUUID())}
                    required
                  />
                </Field>
                <Button busy={write.isPending} disabled={maxReservation <= 0 || resources.isFetching || allocationRecommendations.isFetching}>Approve reservation</Button>
              </form>}
              {d.allocations.filter(a => !a.caseDispatchId).map((a) => (
                <div className="allocation-row" key={a.id} id={`shipment-${a.id}`} tabIndex={a.id === shipmentId ? -1 : undefined}>
                  <small>{shipmentCode({ ...a, kind: 'Dispatch' })}</small>
                  <strong>{a.quantity} {unitSymbol(a.unit)}</strong>
                  <Badge value={a.status} />
                  {a.status === 'Reserved' && <strong>Next: Dispatch</strong>}
                  {a.status === 'Dispatched' && <strong>Next: Deliver</strong>}
                  {manageLogistics && a.status === 'Reserved' && r.requiresCoordinatorAuthorization && !a.packedAt &&
                    <AllocationPreparation caseId={r.id} id={a.id} quantity={a.quantity} />}
                  {manageLogistics && a.status === 'Reserved' &&
                    (r.requiresCentreHandover || r.unitRequiresClarification || r.requiresCoordinatorAuthorization && !a.packedAt ? ['Cancel'] : ['Dispatch', 'Cancel']).map((action) => (
                      <Button
                        key={action}
                        variant="secondary"
                        busy={write.isPending}
                        onClick={() => write.mutate({ path: `/allocations/${a.id}/${action}` })}
                      >
                        {action}
                      </Button>
                    ))}
                  {manageLogistics && a.status === 'Dispatched' && !r.unitRequiresClarification && (
                    <Button
                      busy={write.isPending}
                      onClick={() => { write.reset(); setDeliveryId(a.id); }}
                    >
                      Confirm delivery
                    </Button>
                  )}
                </div>
              ))}
              {manageLogistics && delivery && <OrganisationDialog title="Confirm delivery" busy={write.isPending} onDismiss={() => setDeliveryId(undefined)}>
                <form className="stack logistics-dialog-body" onSubmit={(event) => {
                  event.preventDefault();
                  write.mutate({ path: `/allocations/${delivery.id}/Deliver`, data: deliveryInput(new FormData(event.currentTarget)) },
                    { onSuccess: () => setDeliveryId(undefined) });
                }}>
                  <p>Dispatched quantity · {delivery.quantity} {unitSymbol(delivery.unit)}</p>
                  <DeliveryFields quantity={delivery.quantity} unit={delivery.unit ?? undefined} />
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
              {manageShelter && canReserveShelter && suitableShelters.length > 0 && <form
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
                {shelterRanking.data?.[0]?.evidence && <p className="muted">
                  {shelterRanking.data[0].evidence.algorithm} · {shelterRanking.data[0].evidence.source} · {shelterRanking.data[0].evidence.processingState} · {shelterRanking.data[0].evidence.reviewState}
                </p>}
                {shelterRanking.data?.map(candidate => {
                  const shelter = suitableShelters.find(item => item.id === candidate.id);
                  return shelter && <p key={candidate.id}><strong>{shelter.name}{candidate.score != null && ` · Score ${candidate.score}`}</strong> {candidate.explanation}</p>;
                })}
                <Button busy={write.isPending}>Approve household reservation</Button>
              </form>}
              {d.placements.map((p) => (
                <div className="allocation-row" key={p.id}>
                  <span>{p.shelterName && `${p.shelterName} · `}{p.people} people</span>
                  <Badge value={p.status} />
                  {manageShelter && (p.status === 'Reserved'
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
            {actionPanel}
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
    </div>
  );
}

export function ResourcesPage() {
  const { user } = useAuth();
  const location = useLocation();
  return isCoordinatorWorkspace(user, location.pathname, location.search) ? <CoordinatorResources /> : <StaffResourcesPage />;
}

function StaffResourcesPage() {
  const country = useCountry();
  const { user } = useAuth();
  const location = useLocation();
  const readOnly = isCoordinatorWorkspace(user, location.pathname, location.search);
  const q = useQuery({ queryKey: ['resources', country], queryFn: () => get<Resource[]>('/resources') }),
    write = useWrite();
  const [category, setCategory] = useState<string>(categories[0]);
  const [unit, setUnit] = useState(''),
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
        title={readOnly ? 'Resource availability' : 'Resources & logistics'}
        description={readOnly ? 'View available, reserved and physical stock across your assigned organisations.' :
          'Keep reservations, physical stock and delivery records distinct.'}
        action={
          !readOnly && <Button onClick={() => {
            setCategory(categories[0]);
            setUnit('');
            setAdd(!add);
          }}>
            <Plus size={18} />
            Add resource
          </Button>
        }
      />
      <MutationMessage mutation={write} />
      {!readOnly && add && (
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
              <select name="category" value={category} onChange={event => {
                setCategory(event.target.value);
                setUnit('');
              }}>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Unit">
              <ResourceUnitSelect name="unit" category={category} value={unit} onChange={(e) => setUnit(e.target.value)} required />
            </Field>
            <Field label="Opening stock">
              <input name="stock" type="number" min={0} step={stockLevelStep(unit)} required />
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
              {!readOnly && <form
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
              </form>}
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
  const { user } = useAuth();
  const location = useLocation();
  const workspace = isShelterWorkspace(user, location.pathname, location.search);
  const readOnly = isCoordinatorWorkspace(user, location.pathname, location.search);
  return <CountryShelterManagement key={`${country}:${workspace}:${readOnly}`} country={country} workspace={workspace} readOnly={readOnly} />;
}

function CountryShelterManagement({ country, workspace, readOnly }: { country: string; workspace: boolean; readOnly: boolean }) {
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
  const editorTitle = workspace && editing ? `Operational update · ${editing.name}` : t(editing ? 'updateShelter' : 'newShelter');
  const editor = editing !== undefined && (
    <form
      key={editing?.id || 'new'}
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        if (write.isPending) return;
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
              verifyOperations: f.verifyOperations === 'on',
              expectedOperationalUpdate: workspace ? editing?.operationalUpdatedAt ?? editing?.updatedAt : undefined,
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
          min={Math.max(1, (editing?.occupancy ?? 0) + (editing?.reserved ?? 0))}
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
      {editing?.pendingVerification && <label className="checkbox-label shelter-confirm">
        <input type="checkbox" name="verifyOperations" /> I confirm the shelter's capacity, facilities and operating readiness.
      </label>}
      <Button busy={write.isPending}>{workspace ? 'Save operational update' : t('saveShelter')}</Button>
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
    <div className={`shelter-management${workspace ? ' shelter-page' : readOnly ? ' coord-page coord-shelters' : ''}`}>
      <PageHeader
        title={readOnly ? 'Shelter capacity' : workspace ? 'Shelter Management' : t('staffShelters')}
        description={
          isAdmin || readOnly
            ? 'Monitor capacity, accommodation and operational readiness.'
            : t('shelterManagementDescription')
        }
        action={
          !readOnly && (workspace ? <Link className="button" to={shelterPath('/shelters/new')}><Plus size={18} aria-hidden="true" />Add shelter</Link> :
          <Button onClick={() => startEditing(null)}>
            <Plus size={18} aria-hidden="true" />
            {t('addShelter')}
          </Button>)
        }
      />
      {editing === undefined && <MutationMessage mutation={write} />}
      {editing !== undefined &&
        (isAdmin || workspace ? (
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
      <ShelterDashboard country={country} onEdit={startEditing} specialist={!isAdmin} workspace={workspace} readOnly={readOnly} />
    </div>
  );
}
