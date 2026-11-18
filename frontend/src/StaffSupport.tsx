import { CrisisAlertComposer, CrisisPublishedAlerts, emptyAlertDraft, useCrisisAlertHistory } from './CrisisAlerts';
import { CrisisCreationForm } from './CrisisCreationForm';
import { AdministratorAlerts, StaffLifecycle, SystemAdministratorRequests } from './AdministrationWorkflows';
import { AdminCaseQueue } from './AdminCaseQueue';
import { AdminActivity } from './AdminActivity';
import { AdministrationOverview } from './AdministrationOverview';
import { OperationalReports } from './OperationalReports';
import { OrganisationsPage, usePartnerDirectory } from './OrganisationsPage';
import { useCountry, useCountries } from './geography';
import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Building2, Eye, EyeOff, Plus, Users } from 'lucide-react';
import { api, get } from './api';
import { useAuth, useOptionalAuth } from './auth';
import { SystemReadiness } from './SystemReadiness';
import { getAdminSection } from './adminSections';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorState,
  Field,
  formatDate,
  IconTile,
  Loading,
  PageHeader,
} from './components';
import type { AidRequest, Crisis, Lookups, Page, User, VolunteerData } from './types';
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
      method?: 'post' | 'put' | 'delete';
    }) => (await api.request({ url: path, method, data })).data as unknown,
    onSuccess: () => client.invalidateQueries(),
  });
}
function Message({ mutation }: { mutation: ReturnType<typeof useWrite> }) {
  return mutation.error ? (
    <ErrorState error={mutation.error} />
  ) : mutation.isSuccess ? (
    <p className="success-text" role="status">
      Saved successfully.
    </p>
  ) : null;
}
const values = (form: HTMLFormElement) => Object.fromEntries(new FormData(form).entries());
export function VolunteerPage({ self = false }: { self?: boolean }) {
  const [params] = useSearchParams();
  const view = self ? '' : params.get('view') ?? '';
  const country = useCountry();
  const { user } = useAuth(),
    query = useQuery({
      queryKey: ['volunteers', country],
      queryFn: () => get<VolunteerData>('/volunteers'),
    }),
    write = useWrite();
  const [add, setAdd] = useState(false), [caseSearch, setCaseSearch] = useState('');
  const [debouncedCaseSearch, setDebouncedCaseSearch] = useState('');
  const [selectedCase, setSelectedCase] = useState('');
  const [taskStart, setTaskStart] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [taskSkill, setTaskSkill] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedCaseSearch(caseSearch.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [caseSearch]);
  const cases = useQuery({
    queryKey: ['volunteer-cases', debouncedCaseSearch],
    queryFn: () => get<Pick<AidRequest, 'id' | 'reference' | 'locationText' | 'organisationId'>[]>(`/volunteer-tasks/cases?search=${encodeURIComponent(debouncedCaseSearch)}`),
    placeholderData: (previous) => previous,
    enabled: !self,
  });
  const searchingCases = caseSearch.trim() !== debouncedCaseSearch || cases.isFetching;
  const availableCases = cases.data ?? [];
  const selectedOrganisation = availableCases.find((r) => r.id === selectedCase)?.organisationId;
  const candidateWindow = !!selectedCase && !!taskStart && !!taskDue && Date.parse(taskStart) < Date.parse(taskDue);
  const candidates = useQuery({
    queryKey: ['volunteer-candidates', selectedCase, taskStart, taskDue, taskSkill],
    enabled: candidateWindow && !self,
    queryFn: () => get<{ id: string; openCommitments: number; explanation: string }[]>(`/volunteer-tasks/candidates?${new URLSearchParams({
      requestId: selectedCase, startsAt: new Date(taskStart).toISOString(), dueAt: new Date(taskDue).toISOString(), skill: taskSkill,
    })}`),
  });
  const scopedVolunteers = query.data?.profiles.filter((v) => v.verified && v.available && v.organisationId === selectedOrganisation) ?? [];
  const availableVolunteers = candidateWindow && candidates.data
    ? candidates.data.flatMap(c => scopedVolunteers.filter(v => v.id === c.id))
    : scopedVolunteers;
  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => get<Lookups>('/public/lookups'),
  });
  const profile = query.data?.profiles.find((p) => p.userId === user?.id);
  const rosterTasks = self
    ? query.data?.tasks.filter((t) => t.volunteerId === profile?.id)
    : query.data?.tasks;
  const taskView = ['open', 'deployments', 'reports', 'overdue'].includes(view);
  const directoryView = ['verified', 'available'].includes(view);
  const tasks = rosterTasks?.filter((task) => {
    const open = !['Completed', 'Declined'].includes(task.status);
    if (view === 'open') return open;
    if (view === 'deployments') return ['Accepted', 'InProgress'].includes(task.status);
    if (view === 'reports') return task.status === 'AwaitingVerification';
    if (view === 'overdue') return open && Date.parse(task.dueAt) < Date.now();
    return !directoryView;
  });
  const profiles = query.data?.profiles.filter((v) => !directoryView || v.verified && (view !== 'available' || v.available));
  return (
    <>
      <PageHeader
        title={self ? 'My volunteer assignments' : ({ reports: 'Reports awaiting verification', open: 'Open assignments',
          deployments: 'Active deployments', overdue: 'Overdue tasks', verified: 'Verified volunteers',
          available: 'Available verified volunteers' } as Record<string, string>)[view] ?? 'Volunteer coordination'}
        description={
          self
            ? 'Your time and skills make a difference.'
            : 'Verify skills, match availability, and confirm completed work.'
        }
        action={
          !self && (
            <Button onClick={() => setAdd(!add)}>
              <Plus size={18} />
              Manage volunteer
            </Button>
          )
        }
      />
      <Message mutation={write} />
      {add && !self && (
        <Card>
          <h2>Volunteer profile</h2>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const f = values(e.currentTarget);
              write.mutate({
                path: '/volunteers',
                data: { ...f, verified: f.verified === 'on', available: f.available === 'on' },
              });
            }}
          >
            <Field label="Registered user ID">
              <input name="userId" required placeholder="Copy from Administration → Users" />
            </Field>
            <Field label="Organisation">
              <select name="organisationId">
                {lookups.data?.organisations
                  .filter((o) => user?.memberships.some((m) => m.organisationId === o.id))
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Skills (comma separated)">
              <input name="skills" required />
            </Field>
            <Field label="Availability schedule">
              <input name="availability" placeholder="Weekdays 09:00–17:00" required />
            </Field>
            <label className="checkbox-label">
              <input type="checkbox" name="verified" />
              Verified by coordinator
            </label>
            <label className="checkbox-label">
              <input type="checkbox" name="available" defaultChecked />
              Available for assignments
            </label>
            <Button busy={write.isPending}>Save profile</Button>
          </form>
        </Card>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : (
        <>
          {!self && !taskView && (
            <Card>
              <h2>Volunteer directory</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Volunteer profile</th>
                      <th>Skills</th>
                      <th>Availability</th>
                      <th>Verification</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profiles?.map((v) => (
                      <tr key={v.id}>
                        <td>
                          <strong>{query.data?.names?.[v.userId] || v.id.slice(0, 8)}</strong>
                        </td>
                        <td>{v.skills}</td>
                        <td>
                          {v.availability}
                          <small>{v.available ? 'Available' : 'Unavailable'}</small>
                        </td>
                        <td>
                          <Badge value={v.verified ? 'Verified' : 'UnderReview'} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {!self && !view && (
            <Card>
              <h2>Assign a task</h2>
              <form
                className="form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = values(e.currentTarget);
                  write.mutate({
                    path: '/volunteer-tasks',
                    data: { ...f, dueAt: new Date(String(f.dueAt)).toISOString(),
                      startsAt: taskStart ? new Date(taskStart).toISOString() : null },
                  });
                }}
              >
                <Field label="Search cases" hint="Search by reference, location or request details, then select a case.">
                  <input value={caseSearch} onChange={(e) => { setCaseSearch(e.target.value); setSelectedCase(''); }} />
                </Field>
                <Field label="Case" hint={searchingCases ? 'Searching cases…' : cases.error ? 'Could not load cases. Check your connection and change the search to try again.' : availableCases.length === 0 ? 'No selectable cases in these results. Try a more specific search.' : availableCases.length === 20 ? 'Showing the first 20 matches. Narrow your search to find more.' : undefined}>
                  <select name="requestId" required value={selectedCase} onChange={(e) => setSelectedCase(e.target.value)} disabled={searchingCases || !!cases.error}>
                    <option value="">Select a case</option>
                    {availableCases.map((r) => (
                      <option key={r.id} value={r.id}>{r.reference} · {r.locationText}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Verified volunteer" hint={selectedCase && !availableVolunteers.length ? 'No verified, available volunteers in this organisation.' : undefined}>
                  <select name="volunteerId" required disabled={!availableVolunteers.length} key={selectedCase}>
                    {availableVolunteers
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {query.data?.names?.[v.userId] || v.id.slice(0, 8)} · {v.skills}
                          {candidates.data?.some(c => c.id === v.id) ? ' · schedule match' : ''}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Task title">
                  <input name="title" required />
                </Field>
                <Field label="Required skill">
                  <input name="requiredSkill" placeholder="distribution" value={taskSkill} onChange={e => setTaskSkill(e.target.value)} />
                </Field>
                <Field label="Start date and time" hint="Leave blank for immediate assignment. Enter a window to rank candidates by commitments.">
                  <input type="datetime-local" value={taskStart} onChange={e => setTaskStart(e.target.value)} />
                </Field>
                <Field label="Due date and time">
                  <input type="datetime-local" name="dueAt" required value={taskDue} onChange={e => setTaskDue(e.target.value)} />
                </Field>
                {candidateWindow && candidates.error && <p role="status">Scheduling recommendations are unavailable. Assignments still check recorded conflicts.</p>}
                {candidates.data?.[0] && <p>{candidates.data[0].explanation}</p>}
                <Button busy={write.isPending} disabled={searchingCases || !!cases.error || !availableVolunteers.length}>Assign task</Button>
              </form>
            </Card>
          )}
          <div className="resource-grid section-small">
            {tasks?.map((task) => (
              <Card key={task.id}>
                <div className="inline spread">
                  <IconTile icon={Users} tone="purple" />
                  <Badge value={task.status} />
                </div>
                <h3>{task.title}</h3>
                <p className="muted">
                  {task.startsAt && `Starts ${formatDate(task.startsAt)} · `}Due {formatDate(task.dueAt)} · {task.requiredSkill}
                </p>
                {task.note && <p>{task.note}</p>}
                {!!query.data?.history?.some((event) => event.taskId === task.id) && (
                  <details className="stack" open={!self && task.status === 'AwaitingVerification' || undefined}>
                    <summary>Task history and reports</summary>
                    <ol className="stack">
                      {query.data.history.filter((event) => event.taskId === task.id).map((event) => (
                        <li key={event.id}>
                          <strong>{({ Complete: 'Report submitted', Return: 'Returned for correction', Verify: 'Report verified' } as Record<string, string>)[event.action] ?? event.action}</strong>
                          {' · '}{formatDate(event.createdAt)}
                          {event.workDescription && <p>Work completed — {event.workDescription}</p>}
                          {event.outcome && <p>Outcome — {event.outcome}</p>}
                          {event.peopleAssisted != null && <p>People assisted — {event.peopleAssisted}</p>}
                          {event.issues && <p>Issues — {event.issues}</p>}
                          {event.note && <p>{event.note}</p>}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                {self && ['InProgress', 'Returned'].includes(task.status) && (
                  <form className="stack" onSubmit={(event) => {
                    event.preventDefault();
                    const fields = values(event.currentTarget);
                    write.mutate({ path: `/volunteer-tasks/${task.id}`, data: {
                      ...fields, action: 'Complete', peopleAssisted: fields.peopleAssisted === '' ? null : Number(fields.peopleAssisted),
                    } });
                  }}>
                    <Field label="Work completed"><textarea name="workDescription" required minLength={10} maxLength={2000} /></Field>
                    <Field label="Actual outcome"><textarea name="outcome" required minLength={10} maxLength={2000} /></Field>
                    <Field label="People assisted (if applicable)"><input name="peopleAssisted" type="number" min={0} max={10000000} step={1} /></Field>
                    <Field label="Issues encountered"><textarea name="issues" maxLength={2000} /></Field>
                    <Field label="Completion notes"><textarea name="note" maxLength={2000} /></Field>
                    <Button busy={write.isPending}>Submit for verification</Button>
                  </form>
                )}
                {!self && task.status === 'AwaitingVerification' && (
                  <form className="stack" onSubmit={(event) => {
                    event.preventDefault();
                    const action = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
                    if (action) write.mutate({
                      path: `/volunteer-tasks/${task.id}`, data: { action, note: values(event.currentTarget).note },
                    });
                  }}>
                    <Field label="Verification notes"><textarea name="note" required minLength={5} maxLength={2000} /></Field>
                    <div className="button-row">
                      <Button value="Verify" busy={write.isPending}>Verify report</Button>
                      <Button value="Return" variant="secondary" busy={write.isPending}>Return for correction</Button>
                    </div>
                  </form>
                )}
                <div className="button-row">
                  {(self ? task.status === 'Assigned' ? ['Accept', 'Decline'] : task.status === 'Accepted' ? ['Start'] : [] : []).map((action) => (
                    <Button
                      key={action}
                      busy={write.isPending}
                      variant={action === 'Decline' ? 'secondary' : 'primary'}
                      onClick={() =>
                        write.mutate({
                          path: `/volunteer-tasks/${task.id}`,
                          data: {
                            action,
                          },
                        })
                      }
                    >
                      {action}
                    </Button>
                  ))}
                </div>
              </Card>
            ))}
          </div>
          {!directoryView && !tasks?.length && <Empty title={taskView ? 'No tasks match this queue' : 'No tasks assigned yet'} />}
          {directoryView && !profiles?.length && <Empty title="No volunteers match this queue" />}
        </>
      )}
    </>
  );
}
export function CrisesPage() {
  const country = useCountry(), countries = useCountries();
  const [searchParams] = useSearchParams();
  const requestedCentre = searchParams.get('centre');
  const requestedCrisis = searchParams.get('crisisId');
  const [preparedCrisis, setPreparedCrisis] = useState<string | null>(null);
  const policy = Array.isArray(countries.data) ? countries.data.find(c => c.code === country) : undefined;
  const [alertDraft, setAlertDraft] = useState(emptyAlertDraft);
  const alertHistory = useCrisisAlertHistory(country, true);
  const query = useQuery({ queryKey: ['crises', country], queryFn: () => get<Crisis[]>('/crises') }),
    lookups = useQuery({ queryKey: ['lookups', country], queryFn: () => get<Lookups>('/public/lookups') }),
    write = useWrite();
  const activeCrises = query.data?.filter((crisis) => crisis.active) ?? [];
  useEffect(() => {
    if (requestedCrisis && query.data?.some(crisis => crisis.id === requestedCrisis))
      document.getElementById(`crisis-${requestedCrisis}`)?.focus();
  }, [requestedCrisis, query.data]);
  const directory = usePartnerDirectory(country, !!requestedCentre);
  const preferredCentre = directory.data?.find((organisation) => organisation.id === requestedCentre && organisation.enabled && ["Verified", "LegacyActive"].includes(organisation.verification?.verificationState || ""));
  const [create, setCreate] = useState(false),
    [areaCrisis, setAreaCrisis] = useState('');
  const showAreas = !!areaCrisis;
  function setResponseActive(crisis: Crisis, active: boolean) {
    write.mutate({ path: `/crises/${crisis.id}`, method: 'put', data: { ...crisis, active } });
  }
  const areas = useQuery({
    queryKey: ['areas', areaCrisis],
    queryFn: () =>
      get<{ id: string; name: string; geoJson: string }[]>(`/crises/${areaCrisis}/areas`),
    enabled: showAreas,
  });
  return (
    <>
      <PageHeader
        title="Crises & public information"
        description="Manage response areas and publish verified, translated public alerts."
        action={
          <Button onClick={() => setCreate(!create)}>
            <Plus size={18} />
            Create crisis
          </Button>
        }
      />
      <Message mutation={write} />
      {preferredCentre && <p className="muted">Choose an active crisis to set {preferredCentre.name} as its primary response centre. New requests will be routed there after you save.</p>}
      {create && (
        <Card>
          <h2>New crisis</h2>
          <CrisisCreationForm busy={write.isPending} onCreate={(data) => write.mutate({ path: '/crises', data })} />
        </Card>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : (
        <div className="resource-grid section-small">
          {(query.data ?? []).map((c) => (
            <Card key={c.id}>
              <Badge value={c.active ? 'Open' : 'Closed'} />
              <h3 id={`crisis-${c.id}`} tabIndex={-1}>{c.name}</h3>
              <Link to={`/staff/crises/${c.id}/decision-support`}>Forecasts, briefings and investigations</Link>
              <p>
                {c.type} · {c.district}
              </p>
              <form className="stack" onSubmit={(e) => {
                e.preventDefault();
                const centre = String(new FormData(e.currentTarget).get('centre') || '');
                write.mutate({ path: `/crises/${c.id}/centre`, method: 'put', data: { organisationId: centre || null } });
              }}>
                <Field label="Primary response centre">
                  <select name="centre" defaultValue={(preparedCrisis === c.id && preferredCentre?.id) || c.primaryOrganisationId || ''}
                    key={`${c.primaryOrganisationId ?? ''}:${preparedCrisis === c.id ? preferredCentre?.id ?? '' : ''}`}>
                    <option value="">No centre configured</option>
                    {lookups.data?.organisations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </Field>
                {c.active && preferredCentre && c.primaryOrganisationId !== preferredCentre.id && (
                  <Button type="button" variant="ghost" onClick={() => setPreparedCrisis(c.id)}>Choose {preferredCentre.name}</Button>
                )}
                <Button variant="secondary" busy={write.isPending}>Save response centre</Button>
              </form>
              <div className="button-row">
                <Button
                  variant="secondary"
                  disabled={write.isPending}
                  onClick={() => setResponseActive(c, !c.active)}
                >
                  {c.active ? 'End response' : 'Reopen response'}
                </Button>
                <Button variant="secondary" onClick={() => setAreaCrisis(c.id)}>
                  Operational areas
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {showAreas && (
        <Card>
          <h2>Operational areas</h2>
          {areas.error && <ErrorState error={areas.error} />}
          {areas.data?.map((a) => (
            <p key={a.id}>{a.name}</p>
          ))}
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              write.mutate({ path: `/crises/${areaCrisis}/areas`, data: values(e.currentTarget) });
            }}
          >
            <Field label="Area name">
              <input name="name" required />
            </Field>
            <Field label="GeoJSON Polygon or MultiPolygon">
              <textarea name="geoJson" rows={3} maxLength={4000} required />
            </Field>
            <Button busy={write.isPending}>Add operational area</Button>
          </form>
        </Card>
      )}
      <CrisisAlertComposer country={country} policy={policy} crises={activeCrises} draft={alertDraft}
        setDraft={setAlertDraft} loading={query.isPending || countries.isPending} failed={!!(query.error || countries.error)} />
      <CrisisPublishedAlerts country={country} policy={policy} crises={query.data ?? []} history={alertHistory} />
    </>
  );
}
const adminUsersPageSize = 10;
const adminAccountDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Colombo',
});

interface AdminUser {
  id: string;
  name: string;
  email: string;
  createdAt?: string | null;
  firstRecordedAt?: string | null;
  disabled?: boolean;
  isSystemAdministrator?: boolean;
  memberships: { id: string; role: string; organisationId: string | null; countryCode?: string; crisisId?: string; suspended?: boolean; createdAt?: string }[];
}
function AccountStatus({ user }: { user: AdminUser }) {
  const staffRoles = user.memberships.filter((membership) => membership.role !== 'Citizen');
  const suspendedCount = staffRoles.filter((membership) => membership.suspended).length;
  const status = user.disabled ? 'Disabled'
    : suspendedCount === 0 ? 'Active'
    : !user.isSystemAdministrator && suspendedCount === staffRoles.length ? 'Staff suspended'
    : 'Some roles suspended';
  const tone = user.disabled ? 'disabled' : suspendedCount ? 'suspended' : 'active';
  return <span className={`account-status account-status-${tone}`}>{status}</span>;
}

function AccountRoleDetails({ memberships, isSystemAdministrator, lookups }: { memberships: AdminUser['memberships']; isSystemAdministrator?: boolean; lookups?: Lookups }) {
  if (!memberships.length && !isSystemAdministrator) return <span className="muted">No staff roles</span>;

  const groups = new Map<string, AdminUser['memberships']>();
  for (const membership of memberships) {
    // Only combine roles that share the same organisation and scope.
    const key = JSON.stringify([membership.organisationId, membership.countryCode || 'LK', membership.crisisId || null, membership.role === 'Administrator']);
    const group = groups.get(key);
    if (group) group.push(membership);
    else groups.set(key, [membership]);
  }

  return (
    <div className="admin-role-groups">
      {isSystemAdministrator && <div className="admin-role-group"><strong>System Administrator</strong><small className="admin-role-context">All countries</small></div>}
      {[...groups].map(([key, roles]) => {
        const [grant] = roles;
        const organisation = lookups?.organisations.find((item) => item.id === grant.organisationId)?.name;
        const crisis = lookups?.crises.find((item) => item.id === grant.crisisId)?.name;
        const scope = grant.role === 'Administrator' ? 'Global access'
          : grant.crisisId ? (crisis ? `Crisis: ${crisis}` : 'Crisis scope')
          : 'Country scope';
        return (
          <div className="admin-role-group" key={key}>
            <strong>
              {roles.map((role, index) => (
                <span key={role.id}>
                  {index > 0 && ', '}
                  {role.role.replace(/([a-z])([A-Z])/g, '$1 $2')}
                  {role.suspended && <small className="admin-role-suspended"> (suspended)</small>}
                </span>
              ))}
            </strong>
            <small className="admin-role-context" title={scope === 'Country scope' ? 'This role applies across crises in this country, within its permissions.' : undefined}>
              <Building2 size={16} aria-hidden="true" />
              <span>{grant.organisationId && `${organisation || 'Organisation unavailable'} · `}{grant.role === 'Administrator' ? scope : `${grant.countryCode || 'LK'} · ${scope}`}</span>
            </small>
          </div>
        );
      })}
    </div>
  );
}

function AdminAccountRow({ user, global, lookups }: { user: AdminUser; global: boolean; lookups?: Lookups }) {
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((part) => [...part][0]).join('').toUpperCase();
  const avatarTone = [...(initials || user.id)].reduce((sum, char) => sum + (char.codePointAt(0) ?? 0), 0) % 5;
  const recordedAt = user.createdAt || user.firstRecordedAt;

  return (
    <tr>
      <td>
        <div className="admin-person">
          <span className="admin-person-avatar" data-tone={avatarTone} aria-hidden="true">{initials || '?'}</span>
          <div className="admin-person-info">
            <div className="admin-person-heading">
              <strong>{user.name}</strong>
              <details className="admin-user-id"><summary>View user ID</summary><small>{user.id}</small></details>
            </div>
            {user.email && <div className="admin-person-email">{user.email}</div>}
          </div>
        </div>
      </td>
      <td><AccountRoleDetails memberships={user.memberships} isSystemAdministrator={user.isSystemAdministrator} lookups={lookups} /></td>
      <td><AccountStatus user={user} /></td>
      <td>
        {recordedAt ? (
          <>
            <time dateTime={recordedAt} title={formatDate(recordedAt)}>{adminAccountDate.format(new Date(recordedAt))}</time>
            {!user.createdAt && <small className="block muted">First recorded</small>}
          </>
        ) : <span className="muted">Unknown</span>}
      </td>
      <td>
        {global || user.memberships.length > 0
          ? <StaffLifecycle user={user} global={global} organisations={lookups?.organisations} />
          : <span className="muted">View only</span>}
      </td>
    </tr>
  );
}
const auditActionLabels = new Map([
  ['Login', 'Successful sign-in'],
  ['CitizenRegistered', 'Citizen account created'],
  ['ProfileUpdated', 'Profile updated'],
  ['CaseChanged', 'Case updated'],
  ['RequestAssigned', 'Request assigned to a response centre'],
  ['RequestReassigned', 'Request reassigned'],
  ['RequestUnassigned', 'Request moved to the unassigned queue'],
  ['CaseManagerAssigned', 'Case manager assigned'],
  ['CaseManagerAvailabilityChanged', 'Case manager availability changed'],
  ['EscalationResolved', 'Escalation resolved'],
  ['AiGenerated', 'AI recommendation generated'],
  ['AiDecision', 'AI recommendation reviewed'],
  ['DuplicateReviewed', 'Potential duplicate reviewed'],
  ['ResourceCreated', 'Resource added'],
  ['StockReplenished', 'Stock replenished'],
  ['ResourceReserved', 'Resource reserved'],
  ['AllocationRecommendationAccepted', 'Allocation recommendation accepted'],
  ['AllocationRecommendationIgnored', 'Allocation recommendation skipped'],
  ['AllocationDispatch', 'Aid dispatched'],
  ['AllocationDeliver', 'Aid delivered'],
  ['AllocationCancel', 'Aid reservation cancelled'],
  ['ShelterSaved', 'Shelter details saved'],
  ['ShelterReserved', 'Shelter placement reserved'],
  ['ShelterCheckIn', 'Household checked in to shelter'],
  ['ShelterDepart', 'Household checked out of shelter'],
  ['ShelterCancel', 'Shelter reservation cancelled'],
  ['VolunteerSaved', 'Volunteer profile saved'],
  ['VolunteerAssigned', 'Volunteer task assigned'],
  ['VolunteerTaskAccept', 'Volunteer task accepted'],
  ['VolunteerTaskDecline', 'Volunteer task declined'],
  ['VolunteerTaskStart', 'Volunteer task started'],
  ['VolunteerTaskComplete', 'Volunteer task submitted for verification'],
  ['VolunteerTaskVerify', 'Volunteer task verified'],
  ['FeedbackRecorded', 'Feedback recorded'],
  ['CountryServicesConfigured', 'Country services updated'],
  ['OrganisationCountryEnabled', 'Organisation enabled for a country'],
  ['InternationalIncidentCreated', 'International incident created'],
  ['InternationalIncidentDeleted', 'International incident deleted'],
  ['CrisisLinkedToIncident', 'Crisis linked to an incident'],
  ['CrisisUnlinkedFromIncident', 'Crisis unlinked from an incident'],
  ['CrisisCentreChanged', 'Primary response centre changed'],
  ['CrisisCreated', 'Crisis created'],
  ['CrisisUpdated', 'Crisis updated'],
  ['OperationalAreaCreated', 'Operational area added'],
  ['OperationalAreaRemoved', 'Operational area removed'],
  ['PublicAlertCreated', 'Public alert created'],
  ['PublicAlertUnpublished', 'Public alert unpublished'],
  ['StaffAccessGranted', 'Staff access granted'],
  ['StaffAccessRevoked', 'Staff access revoked'],
  ['SystemAdministratorRevoked', 'System Administrator access revoked'],
  ['OrganisationCountryRemoved', 'Organisation removed from country'],
  ['OrganisationCreated', 'Organisation added'],
  ['OrganisationDeleted', 'Organisation deleted'],
  ['OrganisationArchived', 'Organisation removed from directory'],
  ['EvidenceUploaded', 'Evidence uploaded'],
]);

function auditActionLabel(action: string) {
  return auditActionLabels.get(action) ?? (action.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim() || 'Audit event');
}

export function AdminPage() {
  const countryCode = useCountry();
  const auth = useOptionalAuth();
  const globalAdmin = !auth || !!auth.user?.roles.includes("Administrator");
  const [showStaffPassword, setShowStaffPassword] = useState(false);
  const [staffRole, setStaffRole] = useState('Coordinator');
  const administratorRole = staffRole === 'Administrator' || staffRole === 'CountryAdministrator';
  const [searchParams] = useSearchParams();
  const section = getAdminSection(searchParams.get('section'), globalAdmin);
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === '#system-administrator-requests')
      document.getElementById(hash.slice(1))?.scrollIntoView?.();
  }, [hash, section]);
  const triageCrisis = searchParams.get('country') === countryCode ? searchParams.get('crisisId') : null;
  const requestedOrganisation = section === 'users' ? searchParams.get('organisation') : null;
  const [showStaffForm, setShowStaffForm] = useState(!!requestedOrganisation);
  useEffect(() => { if (requestedOrganisation) setShowStaffForm(true); }, [requestedOrganisation]);
  const [userSearch, setUserSearch] = useState('');
  const [appliedUserSearch, setAppliedUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [userPage, setUserPage] = useState(1);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const term = userSearch.trim();
      if (term === appliedUserSearch) return;
      setAppliedUserSearch(term);
      setUserPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [userSearch, appliedUserSearch]);
  const staffPasswordId = useId();
  const userParams = new URLSearchParams({
    includeTotal: 'true',
    countryCode,
    page: String(section === 'users' ? userPage : 1),
    pageSize: String(adminUsersPageSize),
  });
  if (section === 'users' && appliedUserSearch) userParams.set('search', appliedUserSearch);
  if (section === 'users' && roleFilter) userParams.set('role', roleFilter);
  const users = useQuery({
      queryKey: ['admin-users', countryCode, userParams.toString()],
      queryFn: async () => {
        const result = await get<Page<AdminUser> | AdminUser[]>(`/admin/users?${userParams}`);
        if (!Array.isArray(result)) return result;

        // Older API processes return a capped array until they are restarted.
        const term = userParams.get('search')?.toLowerCase();
        const role = userParams.get('role');
        const matches = result.filter(u =>
          (!term || u.name.toLowerCase().includes(term) || u.email?.toLowerCase().includes(term)) &&
          (!role || (role === 'NoStaffRoles' ? u.memberships.length === 0 : u.memberships.some(m => m.role === role))),
        ).map(u => ({
          ...u,
          firstRecordedAt: u.firstRecordedAt ?? u.memberships.flatMap(m => m.createdAt ? [m.createdAt] : []).sort()[0],
        })).sort((a, b) => {
          const date = (u: AdminUser) => Date.parse(u.createdAt ?? u.firstRecordedAt ?? '') || 0;
          return date(b) - date(a) || a.name.localeCompare(b.name);
        });
        const pageSize = adminUsersPageSize;
        const pageNumber = Math.min(Number(userParams.get('page')), Math.max(1, Math.ceil(matches.length / pageSize)));
        const start = (pageNumber - 1) * pageSize;
        return { items: matches.slice(start, start + pageSize), total: matches.length, pageNumber, pageSize, legacy: true };
      },
      enabled: section === 'users',
    }),
    lookups = useQuery({ queryKey: ['lookups', countryCode], queryFn: () => get<Lookups>('/public/lookups'), enabled: section === 'users' }),
    write = useWrite();
  const userList = users.data?.items ?? [];
  const currentUserPage = users.data?.pageNumber ?? 1;
  const userPageCount = Math.max(1, Math.ceil((users.data?.total ?? 0) / (users.data?.pageSize ?? adminUsersPageSize)));
  const directory = usePartnerDirectory(countryCode, !!requestedOrganisation);
  const preferredOrganisation = directory.data?.find((organisation) => organisation.id === requestedOrganisation && organisation.enabled && ["Verified", "LegacyActive"].includes(organisation.verification?.verificationState || ""))?.id;
  if (section === 'overview') return <AdministrationOverview key={countryCode} globalAdmin={globalAdmin} auditActionLabel={auditActionLabel} />;
  if (section === 'cases') return <AdminCaseQueue globalAdmin={globalAdmin} crisisId={triageCrisis} />;
  if (section === 'activity') return <AdminActivity actionLabel={auditActionLabel} actionOptions={[...auditActionLabels.keys()]} />;
  if (section === 'integrations') return <SystemReadiness />;
  if (section === 'reports') return <OperationalReports />;
  if (section === 'alerts') return <AdministratorAlerts globalAdmin={globalAdmin} />;
  if (section === 'organisations') {
    return <div className="admin-workspace"><OrganisationsPage globalAdmin={globalAdmin} /></div>;
  }

  return (
    <div className="admin-workspace">
      <PageHeader title="Users & access" description="Manage staff accounts, roles, and access to organisations." />
      <Message mutation={write} />
      <div>
        <Card className="admin-users-card">
          <div className="admin-users-toolbar">
            <input type="search" aria-label="Search users" placeholder="Search by name or email" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
            <select aria-label="Filter by role" value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setUserPage(1); }}>
              <option value="">All roles</option>
              {['Coordinator', 'CaseManager', 'Logistics', 'ShelterAdmin', 'VolunteerCoordinator', 'Volunteer', 'Partner', 'FundingOfficer', 'CountryAdministrator', ...(globalAdmin ? ['Administrator'] : [])].map((role) => <option key={role} value={role}>{role.replace(/([a-z])([A-Z])/g, '$1 $2')}</option>)}
              <option value="NoStaffRoles">No staff roles</option>
            </select>
            <Button type="button" aria-expanded={showStaffForm} onClick={() => setShowStaffForm(!showStaffForm)}><Plus size={18} />{showStaffForm ? 'Close form' : 'Create staff account'}</Button>
          </div>
          <div className="admin-staff-form" hidden={!showStaffForm}>
        <div>
          <h2>Create staff account or grant role</h2>
          {globalAdmin && <p className="muted">Appoint a Country Administrator for the country selected above. Requests to grant System Administrator access require approval from a different System Administrator.</p>}
          <form
            className="stack"
            onReset={() => { setShowStaffPassword(false); setStaffRole('Coordinator'); }}
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = values(form);
              write.mutate(
                { path: '/admin/users', data: { ...f, countryCode, organisationId: f.organisationId || null, crisisId: f.crisisId || null } },
                { onSuccess: () => form.reset() },
              );
            }}
          >
            <fieldset disabled={write.isPending} className="staff-access-fields">
            <Field label="Email">
              <input name="email" type="email" required />
            </Field>
            <Field label="Role">
              <select name="role" value={staffRole} onChange={(event) => setStaffRole(event.target.value)}>
                {['Coordinator', 'CaseManager', 'Logistics', 'ShelterAdmin', 'VolunteerCoordinator', 'Volunteer', 'Partner', 'FundingOfficer',
                  ...(globalAdmin ? ['CountryAdministrator', 'Administrator'] : []),
                ].map((role) => <option value={role} key={role}>{role === 'Administrator' ? 'System Administrator' : role.replace(/([a-z])([A-Z])/g, '$1 $2')}</option>)}
              </select>
            </Field>
            {staffRole !== 'Administrator' && <>
            <Field label="Full name" hint="For new accounts only">
              <input name="name" maxLength={100} />
            </Field>
            <div className="field">
              <label htmlFor={staffPasswordId}>Initial password (new accounts only)</label>
              <div className="staff-password-input">
              <input
                id={staffPasswordId}
                name="password"
                type={showStaffPassword ? 'text' : 'password'}
                minLength={10}
                autoComplete="new-password"
              />
              <button type="button" className="staff-password-toggle" aria-label={showStaffPassword ? 'Hide password' : 'Show password'} aria-pressed={showStaffPassword} onClick={() => setShowStaffPassword((shown) => !shown)}>
                {showStaffPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
              </button>
              </div>
            </div>
            </>}
            {!administratorRole && <>
            <Field label="Organisation">
              <select name="organisationId" required key={preferredOrganisation || 'default'} defaultValue={preferredOrganisation}>
                {requestedOrganisation && !preferredOrganisation && <option value="">Select an organisation</option>}
                {lookups.data?.organisations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Crisis assignment">
              <select name="crisisId">
                <option value="">No assignment</option>
                {lookups.data?.crises.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            </>}
            <Button busy={write.isPending}>{staffRole === 'CountryAdministrator' ? 'Appoint Country Administrator' : staffRole === 'Administrator' ? 'Request System Administrator access' : 'Grant staff access'}</Button>
            <Button type="reset" variant="secondary">Reset form</Button>
            </fieldset>
          </form>
        </div>
          </div>
          {users.isPending ? <Loading /> : users.error ? <ErrorState error={users.error} /> : (
            <div className="table-wrap" role="region" aria-label="User accounts" tabIndex={0}>
              <table className="admin-users-table">
                <colgroup>
                  <col className="account-column" />
                  <col className="roles-column" />
                  <col className="status-column" />
                  <col className="created-column" />
                  <col className="access-column" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col">Roles &amp; organisations</th>
                    <th scope="col">Status</th>
                    <th scope="col" aria-sort="descending">Created</th>
                    <th scope="col">Access</th>
                  </tr>
                </thead>
                <tbody>
                  {userList.map((user) => (
                    <AdminAccountRow key={user.id} user={user} global={globalAdmin} lookups={lookups.data} />
                  ))}
                  {userList.length === 0 && <tr><td colSpan={5}>No users match your search.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {users.data && (
            <div className="admin-users-footer">
              <p className="muted admin-users-count" role="status">
                Showing {userList.length} of {users.data.total} matching users
              </p>
              <div className="admin-pagination" role="group" aria-label="User pages">
                <Button type="button" variant="secondary" disabled={currentUserPage <= 1 || users.isFetching} onClick={() => setUserPage(currentUserPage - 1)}>
                  <ArrowLeft size={16} aria-hidden="true" /> Previous
                </Button>
                {userPageCount > 1 && <span>Page {currentUserPage} of {userPageCount}</span>}
                <Button type="button" variant="secondary" disabled={currentUserPage >= userPageCount || users.isFetching} onClick={() => setUserPage(currentUserPage + 1)}>
                  Next <ArrowRight size={16} aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
          {users.data && 'legacy' in users.data && <p className="muted">Restart the backend to search the full directory and see recorded account creation dates.</p>}
        </Card>
      </div>
      {section === 'users' && globalAdmin && <SystemAdministratorRequests />}
    </div>
  );
}
