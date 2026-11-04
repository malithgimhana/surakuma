import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
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
import type { Alert, Crisis, Lookups, User, VolunteerData } from './types';
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
  const { user } = useAuth(),
    query = useQuery({
      queryKey: ['volunteers'],
      queryFn: () => get<VolunteerData>('/volunteers'),
    }),
    write = useWrite();
  const [add, setAdd] = useState(false);
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
                          <strong>{v.id.slice(0, 8)}</strong>
                          <small>User: {v.userId}</small>
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
                <Field label="Case ID">
                  <input
                    name="requestId"
                    required
                    placeholder="Copy the case ID from the case URL"
                  />
                </Field>
                <Field label="Verified volunteer">
                  <select name="volunteerId" required>
                    {query.data?.profiles
                      .filter((v) => v.verified && v.available)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.id.slice(0, 8)} · {v.skills}
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
                <Button busy={write.isPending}>Assign task</Button>
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
export function CrisesPage() {
  const query = useQuery({ queryKey: ['crises'], queryFn: () => get<Crisis[]>('/crises') }),
    alerts = useQuery({ queryKey: ['alerts'], queryFn: () => get<Alert[]>('/alerts') }),
    write = useWrite();
  const [create, setCreate] = useState(false),
    [areaCrisis, setAreaCrisis] = useState('');
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
          <Button onClick={() => setCreate(!create)}>
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
              <input name="district" required />
            </Field>
            <Field label="Latitude">
              <input
                type="number"
                name="latitude"
                min={-90}
                max={90}
                step="any"
                defaultValue={6.93}
              />
            </Field>
            <Field label="Longitude">
              <input
                type="number"
                name="longitude"
                min={-180}
                max={180}
                step="any"
                defaultValue={79.88}
              />
            </Field>
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
export function AdminPage() {
  const users = useQuery({
      queryKey: ['admin-users'],
      queryFn: () => get<AdminUser[]>('/admin/users'),
    }),
    lookups = useQuery({ queryKey: ['lookups'], queryFn: () => get<Lookups>('/public/lookups') }),
    audit = useQuery({
      queryKey: ['audit'],
      queryFn: () =>
        get<{ id: string; action: string; actorId: string; detail: string; createdAt: string }[]>(
          '/admin/audit',
        ),
    }),
    deliveries = useQuery({
      queryKey: ['deliveries'],
      queryFn: () =>
        get<{ id: string; state: string; attempts: number; lastError: string | null }[]>(
          '/admin/deliveries',
        ),
    }),
    write = useWrite();
  return (
    <>
      <PageHeader
        title="System administration"
        description="Manage access, organisations, audit records, and notification delivery."
      />
      <SystemReadiness />
      <Message mutation={write} />
      <div className="two-column">
        <Card>
          <h2>Create staff account or grant role</h2>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const f = values(e.currentTarget);
              write.mutate({ path: '/admin/users', data: { ...f, crisisId: f.crisisId || null } });
            }}
          >
            <Field label="Full name">
              <input name="name" required maxLength={100} />
            </Field>
            <Field label="Email">
              <input name="email" type="email" required />
            </Field>
            <Field label="Initial password (new accounts only)">
              <input
                name="password"
                type="password"
                minLength={10}
                required
                autoComplete="new-password"
              />
            </Field>
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
          </form>
        </Card>
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
      <Card>
        <h2>Users & access</h2>
        {users.isPending ? (
          <Loading />
        ) : users.error ? (
          <ErrorState error={users.error} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Email</th>
                  <th>Memberships</th>
                </tr>
              </thead>
              <tbody>
                {users.data?.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.name}</strong>
                      <small>{u.id}</small>
                    </td>
                    <td>{u.email}</td>
                    <td>
                      {u.memberships.map((m) => (
                        <div className="inline" key={m.id}>
                          <Badge value={m.role} />
                          <Button
                            variant="ghost"
                            busy={write.isPending}
                            onClick={() =>
                              write.mutate({ path: `/admin/memberships/${m.id}`, method: 'delete' })
                            }
                          >
                            Revoke
                          </Button>
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="two-column">
        <Card>
          <h2>Recent audit events</h2>
          {audit.error ? (
            <ErrorState error={audit.error} />
          ) : (
            audit.data?.map((a) => (
              <div className="audit-entry" key={a.id}>
                <strong>{a.action}</strong>
                <p>{a.detail}</p>
                <small>
                  {formatDate(a.createdAt)} · actor {a.actorId.slice(0, 8)}
                </small>
              </div>
            ))
          )}
        </Card>
        <Card>
          <h2>Notification delivery</h2>
          <p className="muted">
            Captured means stored for development demonstration; it does not mean an email was sent.
          </p>
          {deliveries.error ? (
            <ErrorState error={deliveries.error} />
          ) : (
            deliveries.data?.map((d) => (
              <div className="audit-entry" key={d.id}>
                <Badge value={d.state} />
                <span> {d.attempts} attempt(s)</span>
                {d.lastError && <p>{d.lastError}</p>}
              </div>
            ))
          )}
        </Card>
      </div>
    </>
  );
}
