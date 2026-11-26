import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Plus, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { errorMessage, get } from './api';
import { useCaseDispatches } from './CaseDispatches';
import { Button, Empty, ErrorState, Field, formatDate, Loading, PageHeader } from './components';
import { AssignedCountry, RegionField, useDivisions } from './geography';
import type { Volunteer } from './types';
import {
  useVolunteerPagination,
  VolunteerPanel,
  VolunteerPill,
  VolunteerTable,
} from './VolunteerCoordinatorUi';
import {
  coordinationPath,
  currentVolunteerTask,
  operationalVolunteerSkills,
  rosterSkills,
  splitSkills,
  useVolunteerSearch,
  useVolunteerWrite,
  volunteerName,
  volunteerTaskLabels,
} from './volunteerWorkspace';
import type { VolunteerWorkspaceData } from './volunteerWorkspace';

function availability(data: VolunteerWorkspaceData, profile: Volunteer) {
  const task = currentVolunteerTask(data.tasks.filter(t => t.volunteerId === profile.id));
  if (task?.status === 'InProgress')
    return { code: 'deployed', label: volunteerTaskLabels.InProgress, tone: 'blue' } as const;
  if (task?.status === 'AwaitingVerification' || task?.status === 'Returned')
    return { code: 'committed', label: volunteerTaskLabels[task.status], tone: 'amber' } as const;
  if (profile.taskRequestId && task)
    return task.status === 'Completed'
      ? { code: 'unavailable', label: volunteerTaskLabels.Completed, tone: 'neutral' } as const
      : { code: 'committed', label: volunteerTaskLabels[task.status], tone: 'blue' } as const;
  if (data.committed.includes(profile.id))
    return { code: 'committed', label: 'Committed', tone: 'blue' } as const;
  return profile.available
    ? ({ code: 'available', label: 'Available', tone: 'green' } as const)
    : ({ code: 'unavailable', label: 'Unavailable', tone: 'neutral' } as const);
}

export function VolunteerDirectory({
  data,
  initialAvailability = '',
  initialVerification = '',
}: {
  data: VolunteerWorkspaceData;
  initialAvailability?: string;
  initialVerification?: string;
}) {
  const [params, setParams] = useSearchParams();
  const query = params.get('search') ?? '';
  const skill = params.get('skill') ?? '';
  const active = params.get('availability') ?? initialAvailability;
  const verification = params.get('verification') ?? initialVerification;
  const organisation = params.get('organisation') ?? '';
  const regions = useDivisions(data.country);
  const filters = data.profiles
    .filter((p) => {
      const state = availability(data, p).code;
      return (
        (!query.trim() ||
          [volunteerName(data, p), p.userId, p.id, p.skills].some((s) =>
            s.toLowerCase().includes(query.trim().toLowerCase()),
          )) &&
        (!skill || splitSkills(p.skills).some((s) => s.toLowerCase() === skill.toLowerCase())) &&
        (!active ||
          (state === active &&
            (active !== 'available' ||
              verification !== 'verified' ||
              data.available.includes(p.id)))) &&
        (!verification || p.verified === (verification === 'verified')) &&
        (!organisation || p.organisationId === organisation)
      );
    })
    .sort(
      (a, b) =>
        volunteerName(data, a).localeCompare(volunteerName(data, b)) || a.id.localeCompare(b.id),
    );
  const { rows, pagination, reset } = useVolunteerPagination(filters);
  function update(name: string, value: string) {
    const next = new URLSearchParams(params);
    next.set('view', 'directory');
    if (initialAvailability) next.set('availability', active);
    if (initialVerification) next.set('verification', verification);
    if (value) next.set(name, value);
    else next.delete(name);
    reset();
    setParams(next, { replace: true });
  }
  return (
    <VolunteerPanel
      title="Volunteer directory"
      description="Find registered volunteers by skill, location and readiness."
      action={
        <div className="vc-actions">
          {data.organisations.length > 0 && <Link className="button primary" to={coordinationPath('assign')}>
            <Plus size={17} /> Assign volunteer
          </Link>}
          {data.organisations.some((o) => o.canManage) && <Link className="button secondary" to={coordinationPath('manage')}>
            Link existing volunteer
          </Link>}
        </div>
      }
    >
      <div className="vc-filters">
        <Field label="Search volunteers">
          <input
            type="search"
            value={query}
            placeholder="Name, ID or skill"
            onChange={(e) => update('search', e.target.value)}
          />
        </Field>
        <Field label="Skill">
          <select value={skill} onChange={(e) => update('skill', e.target.value)}>
            <option value="">All skills</option>
            {rosterSkills(data.profiles, operationalVolunteerSkills).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Availability">
          <select value={active} onChange={(e) => update('availability', e.target.value)}>
            <option value="">All availability</option>
            <option value="available">Available</option>
            <option value="unavailable">Unavailable</option>
            <option value="committed">Committed</option>
            <option value="deployed">Deployed</option>
          </select>
        </Field>
        <Field label="Verification status">
          <select value={verification} onChange={(e) => update('verification', e.target.value)}>
            <option value="">All statuses</option>
            <option value="verified">Verified</option>
            <option value="pending">Pending verification</option>
          </select>
        </Field>
        <Field label="Organisation">
          <select value={organisation} onChange={(e) => update('organisation', e.target.value)}>
            <option value="">All organisations</option>
            {data.organisations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {regions.error && <ErrorState error={regions.error} retry={() => void regions.refetch()} />}
      {rows.length ? (
        <VolunteerTable label="Volunteer directory results">
          <thead>
            <tr>
              <th>Volunteer / user reference</th>
              <th className="vc-skills-column">Skills</th>
              <th>Organisation / location</th>
              <th>Availability</th>
              <th>Verification</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((profile) => {
              const name = volunteerName(data, profile);
              const org = data.organisations.find((o) => o.id === profile.organisationId);
              const area = regions.data?.find((r) => r.id === profile.serviceRegionId);
              const state = availability(data, profile);
              const view = coordinationPath('manage', { volunteer: profile.id, mode: 'view' });
              return (
                <tr key={profile.id}>
                  <td>
                    <div className="vc-person">
                      <span className="vc-avatar" aria-hidden="true">
                        {name.slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <Link className="vc-text-link" to={view}>
                          {name}
                        </Link>
                        <small>{profile.taskRequestId ? 'Task volunteer' : 'Local roster'}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="vc-chips">
                      {splitSkills(profile.skills).map((s, i) => (
                        <VolunteerPill key={`${s}-${i}`}>{s}</VolunteerPill>
                      ))}
                    </div>
                  </td>
                  <td>
                    {org?.name ?? 'Organisation unavailable'}
                    <small>
                      {area?.name ??
                        (profile.serviceRegionId ? 'Assigned region' : profile.taskRequestId ? 'Task volunteer' : 'Local roster')}
                    </small>
                  </td>
                  <td>
                    <VolunteerPill tone={state.tone}>{state.label}</VolunteerPill>
                    {profile.availability && <small>{profile.availability}</small>}
                  </td>
                  <td>
                    <VolunteerPill tone={profile.verified ? 'green' : 'amber'}>
                      {profile.verified ? 'Verified' : 'Pending verification'}
                    </VolunteerPill>
                  </td>
                  <td>
                    <div className="vc-row-actions">
                      <Link to={view}>View profile</Link>
                      {(org?.canManage || profile.taskRequestId) && (
                        <Link to={coordinationPath('manage', { volunteer: profile.id })}>Edit</Link>
                      )}
                      {(org?.canManage || profile.taskRequestId) && !profile.verified && (
                        <Link to={view}>Verify volunteer</Link>
                      )}
                      <Link
                        to={coordinationPath('deployments', {
                          status: 'all',
                          volunteer: profile.id,
                        })}
                      >
                        Assigned tasks
                      </Link>
                      {profile.verified && profile.available && (!profile.taskRequestId ||
                        !data.tasks.some(task => task.volunteerId === profile.id && task.status !== 'Declined')) && (
                        <Link to={coordinationPath('assign', { volunteer: profile.id,
                          ...(profile.taskRequestId && { case: profile.taskRequestId }),
                          ...(profile.taskDispatchId && { dispatch: profile.taskDispatchId }),
                        })}>
                          Assign task
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </VolunteerTable>
      ) : (
        <Empty
          title="No volunteers match these filters"
          description={
            data.profiles.length
              ? 'Try changing the search or filters.'
              : 'Volunteer profiles will appear here after they are added.'
          }
        />
      )}
      {pagination}
    </VolunteerPanel>
  );
}

type SaveProfile = {
  userId: string;
  organisationId: string;
  countryCode: string;
  skills: string;
  availability: string;
  available: boolean;
  serviceRegionId: string | null;
};

export function ManageVolunteer({
  data,
  id,
  viewing,
}: {
  data: VolunteerWorkspaceData;
  id: string | null;
  viewing: boolean;
}) {
  const profile = id ? data.profiles.find((p) => p.id === id) : undefined;
  const schedule = useQuery({
    queryKey: ['volunteers', 'availability', data.country, profile?.id],
    queryFn: () => get<{ id: string; startsAt: string; endsAt: string }[]>(`/volunteers/${profile?.id}/availability`),
    enabled: !!profile && viewing,
  });
  const organisation = data.organisations.find((o) => o.id === profile?.organisationId);
  const canManage = id ? !!organisation?.canManage || !!profile?.taskRequestId : data.organisations.some((o) => o.canManage);
  const regions = useDivisions(data.country);
  const activeTask = currentVolunteerTask(data.tasks.filter(task => task.volunteerId === profile?.id));
  const caseReference = profile?.taskRequestId ? data.cases[profile.taskRequestId]?.reference : undefined;
  const dispatches = useCaseDispatches(profile?.taskRequestId ?? undefined, 'volunteer-coordinator',
    viewing && !!profile?.taskDispatchId);
  const dispatch = dispatches.data?.dispatches.find(item => item.id === profile?.taskDispatchId);
  const verify = useVolunteerWrite<Volunteer, { id: string }>(
    (input) => `/volunteers/${input.id}/verify`,
  );
  const directory = (
    <Link className="button secondary" to={coordinationPath('directory')}>
      <ArrowLeft size={17} /> Volunteer directory
    </Link>
  );
  return (
    <div className="vc-page">
      <PageHeader
        title={viewing ? 'Volunteer profile' : profile ? 'Edit volunteer' : 'Link existing volunteer'}
        action={directory}
      />
      {id && !profile ? (
        <Empty title="Volunteer profile unavailable" action={directory} />
      ) : profile && (viewing || !canManage) ? (
        <VolunteerPanel
          title={volunteerName(data, profile)}
          action={
            <VolunteerPill tone={profile.verified ? 'green' : 'amber'}>
              {profile.verified ? 'Verified' : 'Pending verification'}
            </VolunteerPill>
          }
        >
          <dl className="vc-data-list">
            <div>
              <dt>Organisation</dt>
              <dd>{organisation?.name}</dd>
            </div>
            <div><dt>Scope</dt><dd>{profile.taskRequestId ? 'Specific task' : 'Reusable local roster'}</dd></div>
            {profile.taskRequestId && <div>
              <dt>Case and dispatch</dt>
              <dd>{activeTask ? <Link className="vc-text-link" to={coordinationPath(
                activeTask.status === 'AwaitingVerification' ? 'reports' : 'deployments',
                { task: activeTask.id })}>
                {[caseReference, dispatch?.reference].filter(Boolean).join(' · ') || activeTask.title}
              </Link> : [caseReference, dispatch?.reference].filter(Boolean).join(' · ') || 'Linked case'}</dd>
            </div>}
            <div>
              <dt>Country</dt>
              <dd>
                <AssignedCountry code={data.country} />
              </dd>
            </div>
            <div>
              <dt>Deployment area</dt>
              <dd>
                {regions.data?.find((r) => r.id === profile.serviceRegionId)?.name ??
                  (profile.serviceRegionId ? 'Assigned region' : 'Organisation-wide')}
              </dd>
            </div>
            <div>
              <dt>Skills</dt>
              <dd>{profile.skills || 'None recorded'}</dd>
            </div>
            <div>
              <dt>Availability schedule</dt>
              <dd>{profile.availability || 'None recorded'}</dd>
            </div>
            <div>
              <dt>Upcoming availability windows</dt>
              <dd>{!viewing ? 'Open the volunteer profile to check upcoming windows.' :
                schedule.isPending ? 'Loading availability…' : schedule.error ? 'Availability could not be loaded.' :
                schedule.data.length ? <ul>{schedule.data.map(window =>
                  <li key={window.id}>{formatDate(window.startsAt)} – {formatDate(window.endsAt)}</li>)}</ul> : 'Availability unknown'}</dd>
            </div>
            <div>
              <dt>{profile.taskRequestId ? 'Assignment status' : 'Availability'}</dt>
              <dd>{availability(data, profile).label}</dd>
            </div>
          </dl>
          {regions.error && (
            <ErrorState error={regions.error} retry={() => void regions.refetch()} />
          )}
          {verify.error && (
            <p className="field-error" role="alert">
              {errorMessage(verify.error)}
            </p>
          )}
          {verify.isSuccess && (
            <p className="success-text" role="status">
              Volunteer verified.
            </p>
          )}
          <div className="vc-actions">
            {canManage && !profile.verified && (
              <Button
                type="button"
                busy={verify.isPending}
                onClick={() => verify.mutate({ id: profile.id })}
              >
                <ShieldCheck size={17} /> Verify volunteer
              </Button>
            )}
            {canManage && (
              <Link
                className="button secondary"
                to={coordinationPath('manage', { volunteer: profile.id })}
              >
                Edit volunteer
              </Link>
            )}
            {profile.verified && profile.taskRequestId &&
              !data.tasks.some(task => task.volunteerId === profile.id && task.status !== 'Declined') && <Link className="button primary"
              to={coordinationPath('assign', { case: profile.taskRequestId, volunteer: profile.id,
                ...(profile.taskDispatchId && { dispatch: profile.taskDispatchId }) })}>
              Assign this volunteer
            </Link>}
            <Link
              className="button secondary"
              to={coordinationPath('deployments', { status: 'all', volunteer: profile.id })}
            >
              View assigned tasks
            </Link>
          </div>
        </VolunteerPanel>
      ) : canManage ? (
        <VolunteerProfileForm key={profile?.id ?? 'new'} data={data} profile={profile} />
      ) : (
        <Empty
          title="Volunteer management is unavailable"
          description="Adding a volunteer requires an organisation-wide coordinator assignment."
        />
      )}
    </div>
  );
}

function VolunteerProfileForm({
  data,
  profile,
}: {
  data: VolunteerWorkspaceData;
  profile?: Volunteer;
}) {
  const navigate = useNavigate();
  const organisations = data.organisations.filter((o) => o.canManage || o.id === profile?.organisationId);
  const [org, setOrg] = useState(profile?.organisationId ?? organisations[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [registered, setRegistered] = useState<{ id: string; name: string }>();
  const [skills, setSkills] = useState(() => splitSkills(profile?.skills ?? ''));
  const [skillSearch, setSkillSearch] = useState('');
  const [validation, setValidation] = useState('');
  const lookup = useVolunteerSearch(search);
  const regions = useDivisions(data.country);
  const taskArea = regions.data?.find(region => region.id === profile?.serviceRegionId)?.name;
  const directory = useQuery({
    queryKey: ['volunteer-registered-users', data.country, org, lookup.value],
    enabled: !profile && !!org,
    queryFn: () =>
      get<{ id: string; name: string }[]>(
        `/volunteers/registered-users?${new URLSearchParams({ organisationId: org, search: lookup.value })}`,
      ),
  });
  const save = useVolunteerWrite<Volunteer, SaveProfile>('/volunteers');
  const candidateSkills = rosterSkills(data.profiles, operationalVolunteerSkills).filter(
    (skill) =>
      skill.toLowerCase().includes(skillSearch.trim().toLowerCase()) &&
      !skills.some((s) => s.toLowerCase() === skill.toLowerCase()),
  );
  const newSkill = skillSearch.trim();
  function addSkill(skill: string) {
    setSkills((previous) => [...previous, skill]);
    setSkillSearch('');
    setValidation('');
  }
  return (
    <VolunteerPanel
      title="Volunteer details"
      description={profile ? undefined : 'Choose an account that already has local Volunteer access.'}
    >
      {!profile && <Link className="vc-text-link" to={coordinationPath('assign')}>Assign or register someone for a task</Link>}
      <form
        className="vc-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (save.isPending) return;
          const form = new FormData(event.currentTarget);
          const userId = profile?.userId ?? registered?.id;
          const skillsText = skills.join(', ');
          if (
            !userId ||
            !skills.length ||
            skillsText.length > 1000 ||
            !String(form.get('availability')).trim()
          ) {
            setValidation(
              'Select a registered user and enter an availability schedule and at least one skill within the field limits.',
            );
            return;
          }
          save.mutate(
            {
              userId,
              organisationId: org,
              countryCode: data.country,
              skills: skillsText,
              availability: String(form.get('availability')).trim(),
              available: form.has('available'),
              serviceRegionId: profile?.taskRequestId ? profile.serviceRegionId ?? null
                : String(form.get('administrativeDivisionId') ?? '') || null,
            },
            {
              onSuccess: (saved) =>
                navigate(coordinationPath('manage', { volunteer: saved.id, mode: 'view' }), {
                  replace: true,
                  state: { success: 'Volunteer profile saved.' },
                }),
            },
          );
        }}
      >
        <div className="vc-form-grid">
          <Field label="Organisation">
            <select
              value={org}
              disabled={!!profile || save.isPending}
              onChange={(e) => {
                setOrg(e.target.value);
                setRegistered(undefined);
              }}
            >
              {organisations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <div>
            <strong>Operational country</strong>
            <p>
              <AssignedCountry code={data.country} />
            </p>
          </div>
          {profile ? (
            <Field label="Registered user">
              <input readOnly value={volunteerName(data, profile)} />
            </Field>
          ) : (
            <>
              <Field label="Search registered users">
                <input
                  type="search"
                  value={search}
                  placeholder="Name, ID or email"
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setRegistered(undefined);
                  }}
                />
              </Field>
              <Field
                label="Registered user"
                hint={
                  lookup.pending || directory.isFetching
                    ? 'Searching registered users…'
                    : directory.data?.length === 0
                      ? lookup.value
                        ? 'No eligible volunteer accounts match this search.'
                        : 'Ask an administrator to grant a Volunteer role in this organisation and country. Leave the crisis assignment blank for the volunteer account.'
                      : undefined
                }
              >
                <select
                  required
                  value={registered?.id ?? ''}
                  disabled={lookup.pending || directory.isFetching || !!directory.error}
                  onChange={(e) =>
                    setRegistered(directory.data?.find((u) => u.id === e.target.value))
                  }
                >
                  <option value="">Select a registered user</option>
                  {directory.data?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.id}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
        </div>
        {directory.error && (
          <ErrorState error={directory.error} retry={() => void directory.refetch()} />
        )}
        <div className="vc-form-grid">
          <fieldset className="vc-fieldset">
            <legend>Skills</legend>
            <div className="vc-chips">
              {skills.map((skill, index) => (
                <button
                  key={`${skill}-${index}`}
                  type="button"
                  className="vc-skill-option"
                  aria-label={`Remove ${skill}`}
                  onClick={() => setSkills(skills.filter((_, i) => i !== index))}
                >
                  {skill} <X size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
            <Field label="Find or add a skill">
              <input
                value={skillSearch}
                maxLength={100}
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.preventDefault();
                }}
                placeholder="Search skills"
                onChange={(e) => setSkillSearch(e.target.value)}
              />
            </Field>
            <div className="vc-chips">
              {candidateSkills.slice(0, 8).map((skill) => (
                <button
                  key={skill}
                  className="vc-skill-option"
                  type="button"
                  onClick={() => addSkill(skill)}
                >
                  <Plus size={15} aria-hidden="true" />
                  {skill}
                </button>
              ))}
              {newSkill &&
                !newSkill.includes(',') &&
                !rosterSkills(data.profiles).some(
                  (s) => s.toLowerCase() === newSkill.toLowerCase(),
                ) &&
                !skills.some((s) => s.toLowerCase() === newSkill.toLowerCase()) && (
                  <button
                    className="vc-skill-option"
                    type="button"
                    onClick={() => addSkill(newSkill)}
                  >
                    Add “{newSkill}”
                  </button>
                )}
            </div>
          </fieldset>
          <div className="vc-form">
            <Field label="Availability schedule">
              <input
                name="availability"
                required={!profile?.taskRequestId}
                maxLength={500}
                defaultValue={profile?.availability}
                placeholder="e.g. Weekdays 09:00–17:00"
              />
            </Field>
            <fieldset className="vc-fieldset">
              <legend>{profile?.taskRequestId ? 'Assigned task area' : 'Deployment area'}</legend>
              {profile?.taskRequestId ? <p className="muted">{taskArea ?? 'Set by the linked case.'}</p> : <RegionField
                countryCode={data.country}
                initialDivisionId={profile?.serviceRegionId}
                hideDistrictSuffix
              />}
            </fieldset>
          </div>
        </div>
        <div className="vc-inset vc-actions">
          <label className="checkbox-label">
            <input name="available" type="checkbox" defaultChecked={profile?.available ?? true} />{' '}
            Open to assignment
          </label>
          <VolunteerPill tone={profile?.verified ? 'green' : 'amber'}>
            {profile?.verified ? 'Verified' : 'Pending verification'}
          </VolunteerPill>
        </div>
        {validation && (
          <p className="field-error" role="alert">
            {validation}
          </p>
        )}
        {save.error && (
          <p className="field-error" role="alert">
            {errorMessage(save.error)}
          </p>
        )}
        <div className="vc-actions vc-form-footer">
          <Link className="button secondary" to={coordinationPath('directory')}>
            Cancel
          </Link>
          <Button busy={save.isPending}>Save volunteer profile</Button>
        </div>
      </form>
    </VolunteerPanel>
  );
}
