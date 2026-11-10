import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, MapPin, Plus, Users } from 'lucide-react';
import { api, get } from './api';
import { useAuth } from './auth';
import { SystemReadiness } from './SystemReadiness';
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
import type { AidRequest, Alert, Crisis, Lookups, Page, User, VolunteerData } from './types';
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
async function getHistoryPage<T>(path: string): Promise<Page<T>> {
  const result = await get<Page<T>>(path);
  if (!Array.isArray(result?.items) || typeof result.total !== 'number')
    throw new Error('The API needs to be restarted to load activity page totals.');
  return result;
}
export function VolunteerPage({ self = false }: { self?: boolean }) {
  const { user } = useAuth(),
    query = useQuery({
      queryKey: ['volunteers'],
      queryFn: () => get<VolunteerData>('/volunteers'),
    }),
    write = useWrite();
  const [add, setAdd] = useState(false), [caseSearch, setCaseSearch] = useState('');
  const [debouncedCaseSearch, setDebouncedCaseSearch] = useState('');
  const [selectedCase, setSelectedCase] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedCaseSearch(caseSearch.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [caseSearch]);
  const cases = useQuery({
    queryKey: ['volunteer-cases', debouncedCaseSearch],
    queryFn: () => get<Page<AidRequest>>(`/requests?search=${encodeURIComponent(debouncedCaseSearch)}&page=1`),
    placeholderData: (previous) => previous,
    enabled: !self,
  });
  const searchingCases = caseSearch.trim() !== debouncedCaseSearch || cases.isFetching;
  const availableCases = cases.data?.items.filter((r) => !['Closed', 'Rejected', 'Cancelled'].includes(r.status)) ?? [];
  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => get<Lookups>('/public/lookups'),
  });
  const profile = query.data?.profiles.find((p) => p.userId === user?.id);
  const tasks = self
    ? query.data?.tasks.filter((t) => t.volunteerId === profile?.id)
    : query.data?.tasks;
  return (
    <>
      <PageHeader
        title={self ? 'My volunteer assignments' : 'Volunteer coordination'}
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
          {!self && (
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
                    {query.data?.profiles.map((v) => (
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
          {!self && (
            <Card>
              <h2>Assign a task</h2>
              <form
                className="form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = values(e.currentTarget);
                  write.mutate({
                    path: '/volunteer-tasks',
                    data: { ...f, dueAt: new Date(String(f.dueAt)).toISOString() },
                  });
                }}
              >
                <Field label="Search cases" hint="Search by reference, location or request details, then select a case.">
                  <input value={caseSearch} onChange={(e) => { setCaseSearch(e.target.value); setSelectedCase(''); }} />
                </Field>
                <Field label="Case" hint={searchingCases ? 'Searching cases…' : cases.error ? 'Could not load cases. Check your connection and change the search to try again.' : availableCases.length === 0 ? 'No selectable cases in these results. Try a more specific search.' : cases.data && cases.data.total > cases.data.items.length ? 'Showing the first 20 matches. Narrow your search to find more.' : undefined}>
                  <select name="requestId" required value={selectedCase} onChange={(e) => setSelectedCase(e.target.value)} disabled={searchingCases || !!cases.error}>
                    <option value="">Select a case</option>
                    {availableCases.map((r) => (
                      <option key={r.id} value={r.id}>{r.reference} · {r.locationText}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Verified volunteer">
                  <select name="volunteerId" required>
                    {query.data?.profiles
                      .filter((v) => v.verified && v.available)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {query.data?.names?.[v.userId] || v.id.slice(0, 8)} · {v.skills}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Task title">
                  <input name="title" required />
                </Field>
                <Field label="Required skill">
                  <input name="requiredSkill" placeholder="distribution" />
                </Field>
                <Field label="Due date and time">
                  <input type="datetime-local" name="dueAt" required />
                </Field>
                <Button busy={write.isPending} disabled={searchingCases || !!cases.error || !selectedCase}>Assign task</Button>
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
                  Due {formatDate(task.dueAt)} · {task.requiredSkill}
                </p>
                {task.note && <p>{task.note}</p>}
                <div className="button-row">
                  {(self
                    ? task.status === 'Assigned'
                      ? ['Accept', 'Decline']
                      : task.status === 'Accepted'
                        ? ['Start']
                        : task.status === 'InProgress'
                          ? ['Complete']
                          : []
                    : task.status === 'AwaitingVerification'
                      ? ['Verify']
                      : []
                  ).map((action) => (
                    <Button
                      key={action}
                      busy={write.isPending}
                      variant={action === 'Decline' ? 'secondary' : 'primary'}
                      onClick={() =>
                        write.mutate({
                          path: `/volunteer-tasks/${task.id}`,
                          data: {
                            action,
                            note: action === 'Complete' ? 'Volunteer reports task complete.' : '',
                          },
                        })
                      }
                    >
                      {action === 'Complete' ? 'Submit for verification' : action}
                    </Button>
                  ))}
                </div>
              </Card>
            ))}
          </div>
          {!tasks?.length && <Empty title="No tasks assigned yet" />}
        </>
      )}
    </>
  );
}
const sriLankanDistricts = [
  'Ampara', 'Anuradhapura', 'Badulla', 'Batticaloa', 'Colombo', 'Galle', 'Gampaha',
  'Hambantota', 'Jaffna', 'Kalutara', 'Kandy', 'Kegalle', 'Kilinochchi', 'Kurunegala',
  'Mannar', 'Matale', 'Matara', 'Monaragala', 'Mullaitivu', 'Nuwara Eliya', 'Polonnaruwa',
  'Puttalam', 'Ratnapura', 'Trincomalee', 'Vavuniya',
];
export function CrisesPage() {
  const query = useQuery({ queryKey: ['crises'], queryFn: () => get<Crisis[]>('/crises') }),
    alerts = useQuery({ queryKey: ['alerts'], queryFn: () => get<Alert[]>('/alerts') }),
    lookups = useQuery({ queryKey: ['lookups'], queryFn: () => get<Lookups>('/public/lookups') }),
    write = useWrite();
  const [create, setCreate] = useState(false),
    [areaCrisis, setAreaCrisis] = useState('');
  const [latitude, setLatitude] = useState(''), [longitude, setLongitude] = useState('');
  const [locating, setLocating] = useState(false), [locationError, setLocationError] = useState('');
  const locationRequest = useRef(0);
  function locateCrisis() {
    setLocationError('');
    if (!navigator.geolocation) {
      setLocationError('Location is unavailable. Enter the coordinates manually.');
      return;
    }
    const request = ++locationRequest.current;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (locationRequest.current !== request) return;
        setLatitude(String(coords.latitude));
        setLongitude(String(coords.longitude));
        setLocating(false);
      },
      () => {
        if (locationRequest.current !== request) return;
        setLocationError('Could not get your location. Allow location access or enter the coordinates manually.');
        setLocating(false);
      },
      { timeout: 10000 },
    );
  }
  function editCoordinates(setValue: (value: string) => void, value: string) {
    locationRequest.current++;
    setLocating(false);
    setLocationError('');
    setValue(value);
  }
  const areas = useQuery({
    queryKey: ['areas', areaCrisis],
    queryFn: () =>
      get<{ id: string; name: string; geoJson: string }[]>(`/crises/${areaCrisis}/areas`),
    enabled: !!areaCrisis,
  });
  return (
    <>
      <PageHeader
        title="Crises & public information"
        description="Manage response areas and publish verified, translated public alerts."
        action={
          <Button onClick={() => { locationRequest.current++; setLocating(false); setLocationError(''); setCreate(!create); }}>
            <Plus size={18} />
            Create crisis
          </Button>
        }
      />
      <Message mutation={write} />
      {create && (
        <Card>
          <h2>New crisis</h2>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              const f = values(e.currentTarget);
              write.mutate({
                path: '/crises',
                data: {
                  ...f,
                  active: true,
                  latitude: Number(f.latitude),
                  longitude: Number(f.longitude),
                },
              });
            }}
          >
            <Field label="Crisis name">
              <input name="name" required maxLength={150} />
            </Field>
            <Field label="Type">
              <select name="type">
                {[
                  'Flood',
                  'Landslide',
                  'Earthquake',
                  'Storm',
                  'Disease outbreak',
                  'Displacement',
                  'Other',
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="District">
              <select name="district" required defaultValue="">
                <option value="" disabled>Select a district</option>
                {sriLankanDistricts.map((district) => <option key={district} value={district}>{district}</option>)}
              </select>
            </Field>
            <Field label="Latitude">
              <input
                type="number"
                name="latitude"
                min={-90}
                max={90}
                step="any"
                value={latitude}
                onChange={(e) => editCoordinates(setLatitude, e.target.value)}
                required
              />
            </Field>
            <Field label="Longitude">
              <input
                type="number"
                name="longitude"
                min={-180}
                max={180}
                step="any"
                value={longitude}
                onChange={(e) => editCoordinates(setLongitude, e.target.value)}
                required
              />
            </Field>
            <div className="crisis-location-action">
              <Button type="button" variant="secondary" busy={locating} onClick={locateCrisis}>
                <MapPin size={18} aria-hidden="true" /> Use my current location
              </Button>
              <small className="muted">Use this only if you are at the crisis location, or enter coordinates manually.</small>
              {locationError && <small className="field-error" role="alert">{locationError}</small>}
            </div>
            <Button busy={write.isPending}>Create response event</Button>
          </form>
        </Card>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : (
        <div className="resource-grid">
          {query.data?.map((c) => (
            <Card key={c.id}>
              <Badge value={c.active ? 'Open' : 'Closed'} />
              <h3>{c.name}</h3>
              <p>
                {c.type} · {c.district}
              </p>
              <form className="stack" onSubmit={(e) => {
                e.preventDefault();
                const centre = String(new FormData(e.currentTarget).get('centre') || '');
                write.mutate({ path: `/crises/${c.id}/centre`, method: 'put', data: { organisationId: centre || null } });
              }}>
                <Field label="Primary response centre">
                  <select name="centre" defaultValue={c.primaryOrganisationId || ''} key={c.primaryOrganisationId || 'none'}>
                    <option value="">No centre configured</option>
                    {lookups.data?.organisations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </Field>
                <Button variant="secondary" busy={write.isPending}>Save response centre</Button>
              </form>
              <div className="button-row">
                <Button
                  variant="secondary"
                  onClick={() =>
                    write.mutate({
                      path: `/crises/${c.id}`,
                      method: 'put',
                      data: { ...c, active: !c.active },
                    })
                  }
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
      {areaCrisis && (
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
      <Card>
        <h2>Publish public alert</h2>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            const f = values(e.currentTarget);
            write.mutate({
              path: '/alerts',
              data: {
                ...f,
                expiresAt: new Date(String(f.expiresAt)).toISOString(),
                published: true,
              },
            });
          }}
        >
          <Field label="Crisis">
            <select name="crisisId" required>
              {query.data
                ?.filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Severity">
            <select name="severity">
              <option>Information</option>
              <option>Warning</option>
            </select>
          </Field>
          <Field label="Affected area">
            <input name="area" required />
          </Field>
          <Field label="Issuing authority">
            <input name="authority" required />
          </Field>
          <Field label="English title">
            <input name="title" required />
          </Field>
          <Field label="English instructions">
            <textarea name="message" required />
          </Field>
          <Field label="සිංහල මාතෘකාව">
            <input name="sinhalaTitle" lang="si" required />
          </Field>
          <Field label="සිංහල උපදෙස්">
            <textarea name="sinhalaMessage" lang="si" required />
          </Field>
          <Field label="தமிழ் தலைப்பு">
            <input name="tamilTitle" lang="ta" required />
          </Field>
          <Field label="தமிழ் அறிவுறுத்தல்கள்">
            <textarea name="tamilMessage" lang="ta" required />
          </Field>
          <Field label="Expires at">
            <input name="expiresAt" type="datetime-local" required />
          </Field>
          <div>
            <p className="muted">Review all three translations before publishing.</p>
            <Button busy={write.isPending}>Publish verified alert</Button>
          </div>
        </form>
      </Card>
      <Card>
        <h2>Published alerts</h2>
        {alerts.error && <ErrorState error={alerts.error} />}
        {alerts.data
          ?.filter((a) => query.data?.some((c) => c.id === a.crisisId))
          .map((a) => (
            <div className="allocation-row" key={a.id}>
              <strong>{a.title}</strong>
              <Badge value={a.severity} />
              <Button
                variant="secondary"
                onClick={() => write.mutate({ path: `/alerts/${a.id}/unpublish` })}
              >
                Unpublish
              </Button>
            </div>
          ))}
      </Card>
    </>
  );
}
interface AdminUser {
  id: string;
  name: string;
  email: string;
  memberships: { id: string; role: string; organisationId: string }[];
}
function AdminTriageRequest({ request, organisations }: { request: AidRequest; organisations: Lookups['organisations'] }) {
  const write = useWrite();
  const managers = useQuery({
    queryKey: ['case-managers', request.id],
    queryFn: () => get<{ id: string; name: string; availableForAssignment: boolean }[]>(`/requests/${request.id}/case-managers`),
    enabled: !!request.organisationId,
  });
  return (
    <div className="audit-entry">
      <details>
        <summary>{request.reference} · {request.category} · {request.organisationId ? 'Awaiting case manager' : 'Awaiting centre'}</summary>
        <p>{request.description}</p>
        <p>Location: {request.locationText}</p>
        {request.requestedForSomeoneElse && <p>Requester: {request.requesterRelationship || 'Relationship not provided'} · {request.requesterContact || 'Contact not provided'}</p>}
      </details>
      <Message mutation={write} />
      {!request.organisationId ? (
        <form className="inline" onSubmit={(event) => {
          event.preventDefault();
          const organisationId = String(new FormData(event.currentTarget).get('organisationId') || '');
          if (organisationId) write.mutate({ path: `/requests/${request.id}/reassign`, data: { organisationId } });
        }}>
          <label>Response centre <select name="organisationId" required defaultValue="">
            <option value="">Select a centre</option>
            {organisations.map((organisation) => <option key={organisation.id} value={organisation.id}>{organisation.name}</option>)}
          </select></label>
          <Button busy={write.isPending}>Assign centre</Button>
        </form>
      ) : (
        <form className="inline" onSubmit={(event) => {
          event.preventDefault();
          const userId = String(new FormData(event.currentTarget).get('userId') || '');
          if (userId) write.mutate({ path: `/requests/${request.id}/case-manager`, data: { userId } });
        }}>
          {managers.error && <ErrorState error={managers.error} />}
          <label>Case manager <select name="userId" required defaultValue="">
            <option value="">Select a case manager</option>
            {managers.data?.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}{manager.availableForAssignment ? '' : ' (unavailable)'}</option>)}
          </select></label>
          <Button busy={write.isPending}>Assign case manager</Button>
        </form>
      )}
    </div>
  );
}
export function AdminPage() {
  const [showStaffPassword, setShowStaffPassword] = useState(false);
  const [searchParams] = useSearchParams();
  const section = ['cases', 'users', 'organisations', 'integrations', 'activity'].includes(searchParams.get('section') || '') ? searchParams.get('section')! : 'overview';
  const [showStaffForm, setShowStaffForm] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [deliveryPage, setDeliveryPage] = useState(1);
  const staffPasswordId = useId();
  const users = useQuery({
      queryKey: ['admin-users'],
      queryFn: () => get<AdminUser[]>('/admin/users'),
    }),
    lookups = useQuery({ queryKey: ['lookups'], queryFn: () => get<Lookups>('/public/lookups') }),
    triage = useQuery({ queryKey: ['triage'], queryFn: () => get<AidRequest[]>('/requests/triage') }),
    audit = useQuery({
      queryKey: ['audit', auditPage],
      queryFn: () =>
        getHistoryPage<{ id: string; action: string; actorId: string; detail: string; createdAt: string }>(
          `/admin/audit?page=${auditPage}&pageSize=10&includeTotal=true`,
        ),
    }),
    deliveries = useQuery({
      queryKey: ['deliveries', deliveryPage],
      queryFn: () =>
        getHistoryPage<{ id: string; state: string; attempts: number; lastError: string | null; createdAt: string; eventMessage: string; recipientName: string | null; caseReference: string | null; provider: string | null }>(
          `/admin/deliveries?page=${deliveryPage}&pageSize=10&includeTotal=true`,
        ),
    }),
    write = useWrite();
  const filteredUsers = users.data?.filter((u) => {
    const query = userSearch.trim().toLowerCase();
    return (!query || `${u.name} ${u.email}`.toLowerCase().includes(query)) && (!roleFilter || u.memberships.some((m) => m.role === roleFilter));
  });
  const titles: Record<string, [string, string]> = {
    overview: ['System administration', 'Manage access, organisations, audit records, and notification delivery.'],
    cases: ['Unassigned cases', 'Review requests waiting for a response centre or case manager.'],
    users: ['Users & access', 'Manage staff accounts, roles, and access to organisations.'],
    organisations: ['Organisations', 'View and manage partner organisations.'],
    integrations: ['Integrations', 'Review service configuration and notification readiness.'],
    activity: ['Activity', 'Review audit events and notification delivery.'],
  };
  return (
    <div className="admin-workspace">
      <PageHeader
        title={titles[section][0]}
        description={titles[section][1]}
      />
      {section === 'overview' && <div className="admin-overview-grid">
        <Link className="card admin-overview-card" to="/admin?section=cases"><span>Unassigned cases</span><strong>{triage.data?.length ?? '—'}</strong><small>Review requests →</small></Link>
        <Link className="card admin-overview-card" to="/admin?section=users"><span>Users & access</span><strong>{users.data?.length ?? '—'}</strong><small>Manage access →</small></Link>
        <Link className="card admin-overview-card" to="/admin?section=organisations"><span>Organisations</span><strong>{lookups.data?.organisations.length ?? '—'}</strong><small>View organisations →</small></Link>
        <Link className="card admin-overview-card" to="/admin?section=integrations"><span>Integrations</span><strong>Service status</strong><small>View readiness →</small></Link>
      </div>}
      {section === 'integrations' && <SystemReadiness />}
      <Message mutation={write} />
      <div hidden={section !== 'overview' && section !== 'cases'}>
      <Card>
        <h2>Unassigned requests</h2>
        {triage.isPending ? <Loading /> : triage.error ? <ErrorState error={triage.error} /> :
          triage.data?.length ? triage.data.map((request) => <AdminTriageRequest key={request.id} request={request} organisations={lookups.data?.organisations || []} />) : <p>No requests are waiting for assignment.</p>}
      </Card>
      </div>
      <div hidden={section !== 'users'}>
        <Card className="admin-users-card">
          <div className="admin-users-toolbar">
            <input aria-label="Search users" placeholder="Search users by name or email" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
            <select aria-label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="">All roles</option>
              {['Coordinator', 'CaseManager', 'Logistics', 'ShelterAdmin', 'VolunteerCoordinator', 'Volunteer', 'Partner', 'Administrator'].map((role) => <option key={role} value={role}>{role.replace(/([a-z])([A-Z])/g, '$1 $2')}</option>)}
            </select>
            <Button type="button" aria-expanded={showStaffForm} onClick={() => setShowStaffForm(!showStaffForm)}><Plus size={18} />{showStaffForm ? 'Close form' : 'Create staff account'}</Button>
          </div>
          <div className="admin-staff-form" hidden={!showStaffForm}>
        <div>
          <h2>Create staff account or grant role</h2>
          <form
            className="stack"
            onReset={() => setShowStaffPassword(false)}
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = values(form);
              write.mutate(
                { path: '/admin/users', data: { ...f, crisisId: f.crisisId || null } },
                { onSuccess: () => form.reset() },
              );
            }}
          >
            <fieldset disabled={write.isPending} className="staff-access-fields">
            <Field label="Full name">
              <input name="name" required maxLength={100} />
            </Field>
            <Field label="Email">
              <input name="email" type="email" required />
            </Field>
            <div className="field">
              <label htmlFor={staffPasswordId}>Initial password (new accounts only)</label>
              <div className="staff-password-input">
              <input
                id={staffPasswordId}
                name="password"
                type={showStaffPassword ? 'text' : 'password'}
                minLength={10}
                required
                autoComplete="new-password"
              />
              <button type="button" className="staff-password-toggle" aria-label={showStaffPassword ? 'Hide password' : 'Show password'} aria-pressed={showStaffPassword} onClick={() => setShowStaffPassword((shown) => !shown)}>
                {showStaffPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
              </button>
              </div>
            </div>
            <Field label="Organisation">
              <select name="organisationId" required>
                {lookups.data?.organisations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Role">
              <select name="role">
                {[
                  'Coordinator',
                  'CaseManager',
                  'Logistics',
                  'ShelterAdmin',
                  'VolunteerCoordinator',
                  'Volunteer',
                  'Partner',
                  'Administrator',
                ].map((r) => (
                  <option key={r}>{r}</option>
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
            <Button busy={write.isPending}>Grant staff access</Button>
            <Button type="reset" variant="secondary">Reset form</Button>
            </fieldset>
          </form>
        </div>
          </div>
          {users.isPending ? <Loading /> : users.error ? <ErrorState error={users.error} /> : <div className="table-wrap"><table className="admin-users-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role and organisation</th><th>Access</th></tr></thead>
            <tbody>{filteredUsers?.map((u) => <tr key={u.id}>
              <td><div className="admin-person"><span className="admin-person-avatar" aria-hidden="true">{u.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><div><strong>{u.name}</strong><details className="admin-user-id"><summary>View user ID</summary><small>{u.id}</small></details></div></div></td>
              <td>{u.email}</td>
              <td>{u.memberships.length ? u.memberships.map((m) => <div key={m.id} className="admin-membership"><Badge value={m.role} /><small>{lookups.data?.organisations.find((o) => o.id === m.organisationId)?.name || 'Organisation unavailable'}</small></div>) : <span className="muted">No staff roles</span>}</td>
              <td>{u.memberships.map((m) => <Button key={m.id} type="button" variant="ghost" busy={write.isPending} onClick={() => { const organisation = lookups.data?.organisations.find((o) => o.id === m.organisationId)?.name || 'this organisation'; if (window.confirm(`Revoke ${m.role} access for ${u.name} at ${organisation}?`)) write.mutate({ path: `/admin/memberships/${m.id}`, method: 'delete' }); }}>Revoke {m.role.replace(/([a-z])([A-Z])/g, '$1 $2')}</Button>)}</td>
            </tr>)}</tbody>
          </table>{filteredUsers?.length === 0 && <p>No users match your search.</p>}</div>}
          <p className="muted admin-users-count">Showing {filteredUsers?.length ?? 0} of {users.data?.length ?? 0} loaded users{users.data?.length === 100 ? ' (first 100)' : ''}</p>
        </Card>
      </div>
      <div hidden={section !== 'organisations'}>
        <Card>
          <h2>Partner organisations</h2>
          {lookups.data?.organisations.map((o) => (
            <p key={o.id}>
              <strong>{o.name}</strong>
              <small className="muted block">{o.id}</small>
            </p>
          ))}
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              write.mutate({ path: '/admin/organisations', data: values(e.currentTarget) });
            }}
          >
            <Field label="New organisation name">
              <input name="name" required maxLength={150} />
            </Field>
            <Button variant="secondary" busy={write.isPending}>
              Add organisation
            </Button>
          </form>
        </Card>
      </div>
      <div className="two-column" hidden={section !== 'activity'}>
        <Card>
          <h2>Recent audit events</h2>
          {audit.isPending ? <Loading /> : audit.error ? (
            <ErrorState error={audit.error} />
          ) : (
            audit.data?.items.map((a) => (
              <div className="audit-entry" key={a.id}>
                <strong>{a.action}</strong>
                <p>{a.detail}</p>
                <small>
                  {formatDate(a.createdAt)} · actor {a.actorId.slice(0, 8)}
                </small>
              </div>
            ))
          )}
          {!audit.isPending && !audit.error && <div className="admin-pagination" role="group" aria-label="Audit event pages">
            <Button type="button" variant="secondary" disabled={auditPage === 1 || audit.isFetching} onClick={() => setAuditPage((page) => page - 1)}>Previous</Button>
            <span aria-live="polite">Page {auditPage} of {Math.max(1, Math.ceil((audit.data?.total ?? 0) / 10))}</span>
            <Button type="button" variant="secondary" disabled={auditPage >= Math.max(1, Math.ceil((audit.data?.total ?? 0) / 10)) || audit.isFetching} onClick={() => setAuditPage((page) => page + 1)}>Next</Button>
          </div>}
          {!audit.isPending && !audit.error && audit.data?.items.length === 0 && <p>No audit events on this page.</p>}
        </Card>
        <Card>
          <h2>Notification delivery</h2>
          <p className="muted">
            Captured means stored locally; Sent means the provider accepted the message, not that it reached the inbox.
          </p>
          {deliveries.isPending ? <Loading /> : deliveries.error ? (
            <ErrorState error={deliveries.error} />
          ) : (
            deliveries.data?.items.map((d) => (
              <div className="audit-entry" key={d.id}>
                <Badge value={d.state} />
                <span> {d.attempts} attempt(s)</span>
                <p>{d.eventMessage || 'Message unavailable'}</p>
                <small>{formatDate(d.createdAt)} · {d.recipientName || 'Recipient unavailable'}{d.caseReference ? ` · ${d.caseReference}` : ''}{d.provider ? ` · ${d.provider}` : ''}</small>
                <small className="muted block">Event message in English; the delivered language may differ.</small>
                {d.lastError && <p>{d.lastError}</p>}
              </div>
            ))
          )}
          {!deliveries.isPending && !deliveries.error && deliveries.data?.items.length === 0 && <p>No delivery events on this page.</p>}
          {!deliveries.isPending && !deliveries.error && <div className="admin-pagination" role="group" aria-label="Notification delivery pages">
            <Button type="button" variant="secondary" disabled={deliveryPage === 1 || deliveries.isFetching} onClick={() => setDeliveryPage((page) => page - 1)}>Previous</Button>
            <span aria-live="polite">Page {deliveryPage} of {Math.max(1, Math.ceil((deliveries.data?.total ?? 0) / 10))}</span>
            <Button type="button" variant="secondary" disabled={deliveryPage >= Math.max(1, Math.ceil((deliveries.data?.total ?? 0) / 10)) || deliveries.isFetching} onClick={() => setDeliveryPage((page) => page + 1)}>Next</Button>
          </div>}
        </Card>
      </div>
    </div>
  );
}
