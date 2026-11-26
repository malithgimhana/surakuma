import { lazy, Suspense, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BriefcaseBusiness,
  CalendarDays,
  Check,
  Clock,
  Languages,
  Layers3,
  Mail,
  MapPin,
  Pencil,
  Phone,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useBeforeUnload, useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { api, get } from './api';
import { useAuth } from './auth';
import { Button, Card, ErrorState, Field, Loading } from './components';
import { VolunteerAvailability } from './VolunteerAvailability';
import { RegionField, useDivisions } from './geography';
import { useMyVolunteerAssignments, VolunteerHeading, VolunteerLoadError } from './MyVolunteerAssignments';
import { WorkspaceDialog } from './OrganisationDialog';
import { currentVolunteerTask, splitSkills, volunteerTaskLabels } from './volunteerWorkspace';
import type { User } from './types';

const MapView = lazy(() => import('./MapView').then((module) => ({ default: module.MapView })));
const profilePath = '/volunteer/profile';
const missing = 'Not provided';
const languages: Record<string, string> = {
  en: 'English',
  si: 'සිංහල',
  ta: 'தமிழ்',
  ne: 'नेपाली',
  hi: 'हिन्दी',
};
const countryCenters: Record<string, [number, number]> = {
  LK: [7.88, 80.69],
  NP: [28.39, 84.13],
  IN: [22.59, 79.96],
};

interface VolunteerProfile {
  organisation?: string | null;
  countryCode: string;
  skills: string;
  verified: boolean;
  schedule: string;
  available: boolean;
  serviceRegionId: string | null;
  serviceLatitude: number | null;
  serviceLongitude: number | null;
  serviceLocationConsent: boolean;
  taskRequestId?: string | null;
  caseReference?: string | null;
  dispatchReference?: string | null;
}

interface ProfileDetails {
  assignments: {
    role: string;
    countryCode: string;
    country: string;
    organisation: string | null;
  }[];
  workPhone: string | null;
  volunteer: VolunteerProfile | null;
}

export default function MyVolunteerProfile({ editing = false }: { editing?: boolean }) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['my-profile', user?.id],
    queryFn: () => get<ProfileDetails>('/auth/profile'),
    enabled: !!user,
  });
  const title = editing ? 'Edit profile' : 'My profile';
  const description = editing
    ? 'Update your personal and volunteering information.'
    : 'Manage your personal details, skills and availability.';
  return (
    <div className="volunteer-self-page">
      <VolunteerHeading title={title} description={description} />
      {query.error ? (
        <VolunteerLoadError
          error={query.error}
          retry={() => void query.refetch()}
          item="your volunteer profile"
        />
      ) : user && query.data ? (
        editing ? (
          <EditProfile key={user.id} user={user} profile={query.data} />
        ) : (
          <ProfileOverview user={user} profile={query.data} />
        )
      ) : (
        <Loading />
      )}
    </div>
  );
}

function volunteerAssociation({ assignments, volunteer }: ProfileDetails) {
  const scoped = assignments.filter(
    (assignment) =>
      assignment.role === 'Volunteer' &&
      (!volunteer || assignment.countryCode === volunteer.countryCode),
  );
  return {
    organisation:
      volunteer?.organisation ||
      [...new Set(scoped.map((assignment) => assignment.organisation).filter(Boolean))].join(' · '),
    country:
      [...new Set(scoped.map((assignment) => assignment.country).filter(Boolean))].join(' · ') ||
      volunteer?.countryCode,
  };
}

function Verification({ volunteer }: { volunteer: VolunteerProfile | null }) {
  return (
    <span className="volunteer-chip" data-tone={volunteer?.verified ? 'green' : 'blue'}>
      {volunteer?.verified && <Check size={14} aria-hidden="true" />}
      {volunteer?.verified ? 'Verified' : volunteer ? 'Pending verification' : 'Unverified'}
    </span>
  );
}

function ProfileOverview({ user, profile }: { user: User; profile: ProfileDetails }) {
  const { state } = useLocation();
  const { volunteer, workPhone } = profile;
  const assignments = useMyVolunteerAssignments(!!volunteer);
  const tasks = assignments.data?.assignments.map(({ task }) => task) ?? [];
  const currentTask = currentVolunteerTask(volunteer?.taskRequestId
    ? tasks.filter(task => task.requestId === volunteer.taskRequestId) : tasks);
  const { organisation, country } = volunteerAssociation(profile);
  const skills = splitSkills(volunteer?.skills ?? '');
  const initials = user.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => [...word][0])
    .join('')
    .toLocaleUpperCase();
  return (
    <div className="volunteer-profile">
      {state?.profileSaved && (
        <p className="success-text" role="status">
          Profile changes saved.
        </p>
      )}
      <Card className="volunteer-identity">
        <span className="avatar volunteer-avatar" aria-hidden="true">
          {initials}
        </span>
        <div className="volunteer-identity-name">
          <h2>{user.name}</h2>
          <p>Volunteer</p>
        </div>
        <Verification volunteer={volunteer} />
        <Link to={profilePath + '/edit'} className="button secondary volunteer-edit-link">
          <Pencil size={16} aria-hidden="true" /> Edit profile
        </Link>
      </Card>
      <div className="volunteer-profile-grid">
        <Card>
          <h2>Contact information</h2>
          <dl className="volunteer-info-list">
            <InfoRow icon={Mail} label="Email address">
              {user.email || missing}
            </InfoRow>
            <InfoRow icon={Phone} label="Work phone">
              {workPhone || missing}
            </InfoRow>
          </dl>
        </Card>
        <Card>
          <h2>Preferences and availability</h2>
          <dl className="volunteer-info-list">
            <InfoRow icon={Languages} label="Preferred language">
              {languages[user.language] ?? missing}
            </InfoRow>
            <InfoRow icon={CalendarDays} label="Availability schedule">
              {volunteer?.schedule.trim() || missing}
            </InfoRow>
            <InfoRow icon={Clock} label="Availability preference">
              {volunteer ? (
                <span className="volunteer-chip" data-tone={volunteer.available ? 'green' : 'blue'}>
                  {volunteer.available ? 'Open to assignment' : 'Unavailable'}
                </span>
              ) : (
                missing
              )}
            </InfoRow>
          </dl>
        </Card>
      </div>
      {volunteer && <VolunteerAvailability />}
      <Card>
        <PanelHeading icon={Layers3}>Volunteering details</PanelHeading>
        {!volunteer && (
          <p className="muted">Your coordinator can help set up your volunteer profile.</p>
        )}
        <dl className="volunteer-info-list volunteer-info-table">
          <InfoRow icon={BriefcaseBusiness} label="Program or organisation">
            {organisation || missing}
          </InfoRow>
          <InfoRow icon={MapPin} label="Assigned country">
            {country || missing}
          </InfoRow>
          {volunteer?.taskRequestId !== undefined && <InfoRow icon={Layers3} label="Volunteer scope">
            {volunteer.taskRequestId ? 'Specific task' : 'Local roster'}
          </InfoRow>}
          {volunteer?.taskRequestId && <InfoRow icon={MapPin} label="Case and dispatch">
            {[volunteer.caseReference, volunteer.dispatchReference].filter(Boolean).join(' · ') || 'Linked task'}
          </InfoRow>}
          {volunteer && <InfoRow icon={Clock} label="Assignment status">
            {assignments.isError ? 'Assignments unavailable' : assignments.isPending ? 'Loading assignments…'
              : currentTask ? <Link to="/volunteer">{volunteerTaskLabels[currentTask.status]}</Link> : 'No assignment yet'}
          </InfoRow>}
          <InfoRow icon={Layers3} label="Recorded skills">
            {skills.length ? (
              <div className="volunteer-chips">
                {skills.map((skill, index) => (
                  <span className="volunteer-chip" data-tone="blue" key={index}>
                    {skill}
                  </span>
                ))}
              </div>
            ) : (
              missing
            )}
          </InfoRow>
          <InfoRow icon={ShieldCheck} label="Verification status">
            <Verification volunteer={volunteer} />
          </InfoRow>
          <InfoRow icon={MapPin} label="Administrative service area">
            {volunteer?.serviceRegionId ? (
              <ServiceRegion country={volunteer.countryCode} id={volunteer.serviceRegionId} />
            ) : (
              missing
            )}
          </InfoRow>
          {volunteer?.serviceLocationConsent &&
            volunteer.serviceLatitude != null &&
            volunteer.serviceLongitude != null && (
              <InfoRow icon={MapPin} label="Service location">
                {volunteer.serviceLatitude.toFixed(5)}, {volunteer.serviceLongitude.toFixed(5)}
              </InfoRow>
            )}
        </dl>
      </Card>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="volunteer-info-row">
      <dt>
        <span className="volunteer-small-icon">
          <Icon size={17} aria-hidden="true" />
        </span>
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function PanelHeading({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <h2 className="volunteer-panel-title">
      <Icon size={20} aria-hidden="true" />
      {children}
    </h2>
  );
}

function ServiceRegion({ country, id }: { country: string; id: string }) {
  const regions = useDivisions(country);
  if (regions.isPending) return <>Loading service area…</>;
  return (
    <>{regions.data?.find((region) => region.id === id)?.name ?? 'Service area name unavailable'}</>
  );
}

function initialDraft(user: User, profile: ProfileDetails) {
  const { volunteer } = profile;
  return {
    name: user.name,
    language: user.language,
    workPhone: profile.workPhone ?? '',
    skills: volunteer?.skills ?? '',
    schedule: volunteer?.schedule ?? '',
    available: volunteer?.available ?? false,
    regionId: volunteer?.serviceRegionId ?? null,
    consent: volunteer?.serviceLocationConsent ?? false,
    latitude: volunteer?.serviceLatitude?.toString() ?? '',
    longitude: volunteer?.serviceLongitude?.toString() ?? '',
  };
}

type Draft = ReturnType<typeof initialDraft>;

function withAddedSkills(recorded: string, entry: string) {
  const existing = splitSkills(recorded);
  const known = new Set(existing.map((skill) => skill.toLowerCase()));
  const added = splitSkills(entry).filter((skill) => {
    if (known.has(skill.toLowerCase())) return false;
    known.add(skill.toLowerCase());
    return true;
  });
  return added.length ? [...existing, ...added].join(', ') : recorded;
}

function EditProfile({ user, profile }: { user: User; profile: ProfileDetails }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { updateUser } = useAuth();
  const { i18n } = useTranslation();
  const { volunteer } = profile;
  const [baseline] = useState(() => initialDraft(user, profile));
  const [draft, setDraft] = useState(baseline);
  const [skillEntry, setSkillEntry] = useState('');
  const [mapOpen, setMapOpen] = useState(false);
  const [validation, setValidation] = useState<{
    phone?: string;
    name?: string;
    skills?: string;
    point?: string;
  }>({});
  const saved = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline) || !!skillEntry.trim();
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !saved.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useBeforeUnload((event) => {
    if (!dirty || saved.current) return;
    event.preventDefault();
    event.returnValue = '';
  });
  const canEditPhone = profile.assignments.length > 0 || user.roles.includes('Administrator');
  const point: [number, number] | undefined =
    draft.latitude.trim() &&
    draft.longitude.trim() &&
    Math.abs(Number(draft.latitude)) <= 90 &&
    Math.abs(Number(draft.longitude)) <= 180
      ? [Number(draft.latitude), Number(draft.longitude)]
      : undefined;
  const areaChanged =
    draft.regionId !== baseline.regionId ||
    draft.consent !== baseline.consent ||
    (draft.consent &&
      (draft.latitude !== baseline.latitude || draft.longitude !== baseline.longitude));
  const save = useMutation({
    mutationFn: async (skills: string) =>
      (
        await api.put<User>('/auth/profile', {
          name: draft.name.trim(),
          language: draft.language,
          ...(canEditPhone &&
            draft.workPhone !== baseline.workPhone && { workPhone: draft.workPhone.trim() }),
          ...(volunteer && skills !== baseline.skills && { volunteerSkills: skills }),
          ...(volunteer &&
            (draft.schedule !== baseline.schedule ||
              draft.available !== baseline.available ||
              areaChanged) && {
              volunteerAvailability: {
                schedule: draft.schedule,
                available: draft.available,
                ...(areaChanged && {
                  serviceArea: {
                    regionId: draft.regionId,
                    consent: draft.consent,
                    latitude: draft.consent ? point?.[0] : null,
                    longitude: draft.consent ? point?.[1] : null,
                  },
                }),
              },
            }),
        })
      ).data,
    onSuccess: async (updated) => {
      saved.current = true;
      updateUser(updated);
      void i18n.changeLanguage(updated.language);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['my-profile', user.id] }),
        client.invalidateQueries({ queryKey: ['volunteers'] }),
        client.invalidateQueries({ queryKey: ['volunteer-candidates'] }),
      ]);
      void navigate(profilePath, { replace: true, state: { profileSaved: true } });
    },
  });
  function change(fields: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...fields }));
    setValidation({});
    if (save.isError) save.reset();
  }
  function addSkills() {
    const updated = withAddedSkills(draft.skills, skillEntry);
    if (updated.length > 1000) {
      setValidation({ skills: 'Keep recorded skills within 1,000 characters.' });
      return;
    }
    change({ skills: updated });
    setSkillEntry('');
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending || !dirty) return;
    const errors: typeof validation = {};
    const skills = withAddedSkills(draft.skills, skillEntry);
    if (!draft.name.trim()) errors.name = 'Enter your full name.';
    if (
      draft.workPhone !== baseline.workPhone &&
      draft.workPhone.trim() &&
      !/^(?=.*[0-9])[+0-9(). -]+$/.test(draft.workPhone.trim())
    )
      errors.phone = 'Enter a phone number using digits, spaces, +, ( ), dots or hyphens.';
    if (skills !== baseline.skills && skills.length > 1000)
      errors.skills = 'Keep recorded skills within 1,000 characters.';
    if (areaChanged && draft.consent && !point)
      errors.point = 'Enter both service point coordinates or choose a point on the map.';
    setValidation(errors);
    if (!Object.keys(errors).length) save.mutate(skills);
  }
  const skills = splitSkills(draft.skills);
  const { organisation } = volunteerAssociation(profile);
  const center = volunteer && countryCenters[volunteer.countryCode];

  return (
    <form className="volunteer-edit" onSubmit={submit}>
      <fieldset disabled={save.isPending} className="volunteer-edit-columns">
        <Card className="volunteer-form-card">
          <PanelHeading icon={UserRound}>Personal information</PanelHeading>
          <Field label="Full name" error={validation.name}>
            <input
              name="name"
              value={draft.name}
              onChange={(event) => change({ name: event.target.value })}
              required
              maxLength={100}
              autoComplete="name"
            />
          </Field>
          <Field label="Email address">
            <input type="email" value={user.email} readOnly />
          </Field>
          <Field label="Preferred language">
            <select
              name="language"
              value={draft.language}
              onChange={(event) => change({ language: event.target.value })}
            >
              {Object.entries(languages).map(([code, label]) => (
                <option value={code} key={code}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {canEditPhone && (
            <Field label="Work phone (optional)" error={validation.phone}>
              <input
                name="workPhone"
                type="tel"
                value={draft.workPhone}
                onChange={(event) => change({ workPhone: event.target.value })}
                maxLength={40}
                autoComplete="tel"
              />
            </Field>
          )}
        </Card>
        <Card className="volunteer-form-card">
          <PanelHeading icon={BriefcaseBusiness}>Volunteering information</PanelHeading>
          <Field label="Volunteering program">
            <input value={organisation || missing} readOnly />
          </Field>
          {volunteer ? (
            <>
              <fieldset className="volunteer-skill-field">
                <legend>Recorded skills</legend>
                <div className="volunteer-chips">
                  {skills.map((skill, index) => (
                    <button
                      key={index}
                      type="button"
                      className="volunteer-chip"
                      data-tone="blue"
                      aria-label={`Remove skill ${skill}`}
                      onClick={() =>
                        change({
                          skills: skills.filter((_, position) => position !== index).join(', '),
                        })
                      }
                    >
                      {skill} <X size={13} aria-hidden="true" />
                    </button>
                  ))}
                </div>
                <div className="volunteer-skill-entry">
                  <Field
                    label="Recorded skills"
                    hint="Add one skill or a comma-separated list."
                    error={validation.skills}
                  >
                    <input
                      value={skillEntry}
                      onChange={(event) => setSkillEntry(event.target.value)}
                      maxLength={1000}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                        event.preventDefault();
                        addSkills();
                      }}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={addSkills}
                    disabled={!skillEntry.trim()}
                  >
                    Add
                  </Button>
                </div>
              </fieldset>
              <Field label="Availability schedule">
                <input
                  name="volunteerSchedule"
                  value={draft.schedule}
                  onChange={(event) => change({ schedule: event.target.value })}
                  maxLength={500}
                />
              </Field>
              <label className="checkbox-label">
                <input
                  name="volunteerAvailable"
                  type="checkbox"
                  checked={draft.available}
                  onChange={(event) => change({ available: event.target.checked })}
                />{' '}
                Open to assignment
              </label>
              <fieldset className="volunteer-service-area">
                <legend>{volunteer.taskRequestId ? 'Assigned task area' : 'Volunteer service area'}</legend>
                {volunteer.taskRequestId ? <p className="muted">
                  {volunteer.serviceRegionId ? <ServiceRegion country={volunteer.countryCode} id={volunteer.serviceRegionId} />
                    : 'The case location determines your task area.'}
                </p> : <RegionField
                  hideDistrictSuffix
                  countryCode={volunteer.countryCode}
                  initialDivisionId={baseline.regionId}
                  onChange={(regionId) => change({ regionId })}
                />}
                <label className="checkbox-label">
                  <input
                    name="serviceLocationConsent"
                    type="checkbox"
                    checked={draft.consent}
                    onChange={(event) => change({ consent: event.target.checked })}
                  />{' '}
                  Use my service point to rank nearby assignments
                </label>
                {draft.consent && (
                  <div className="volunteer-service-controls">
                    <div className="volunteer-coordinate-grid">
                      <Field label="Service point latitude" error={validation.point}>
                        <input
                          name="serviceLatitude"
                          type="number"
                          min={-90}
                          max={90}
                          step="any"
                          value={draft.latitude}
                          onChange={(event) => change({ latitude: event.target.value })}
                        />
                      </Field>
                      <Field label="Service point longitude">
                        <input
                          name="serviceLongitude"
                          type="number"
                          min={-180}
                          max={180}
                          step="any"
                          value={draft.longitude}
                          onChange={(event) => change({ longitude: event.target.value })}
                        />
                      </Field>
                    </div>
                    <div className="button-row">
                      {(center || point) && (
                        <Button
                          type="button"
                          variant="secondary"
                          aria-expanded={mapOpen}
                          onClick={() => setMapOpen(!mapOpen)}
                        >
                          {mapOpen ? 'Hide map' : 'Choose on map'}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setMapOpen(false);
                          change({ consent: false, latitude: '', longitude: '' });
                        }}
                      >
                        Clear service point
                      </Button>
                    </div>
                    {mapOpen && (center || point) && (
                      <Suspense fallback={<Loading />}>
                        <MapView
                          point={point}
                          initialCenter={center || point}
                          initialZoom={volunteer.countryCode === 'IN' ? 5 : 7}
                          height={240}
                          onPick={(latitude, longitude) =>
                            change({
                              latitude: latitude.toFixed(6),
                              longitude: longitude.toFixed(6),
                            })
                          }
                        />
                      </Suspense>
                    )}
                  </div>
                )}
              </fieldset>
            </>
          ) : (
            <p className="muted">Your coordinator can help set up your volunteer profile.</p>
          )}
        </Card>
      </fieldset>
      {save.error && <ErrorState error={save.error} />}
      <div className="volunteer-edit-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={save.isPending}
          onClick={() => void navigate(profilePath, { replace: true })}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!dirty} busy={save.isPending}>
          {save.isPending ? 'Saving changes…' : 'Save changes'}
        </Button>
      </div>
      {blocker.state === 'blocked' && (
        <WorkspaceDialog
          title="Discard unsaved changes?"
          busy={save.isPending}
          context="Your changes will be lost if you leave this page."
          onDismiss={blocker.reset}
        >
          <div className="button-row">
            <Button type="button" variant="secondary" onClick={blocker.reset}>
              Keep editing
            </Button>
            <Button type="button" disabled={save.isPending} onClick={blocker.proceed}>
              Discard changes
            </Button>
          </div>
        </WorkspaceDialog>
      )}
    </form>
  );
}
