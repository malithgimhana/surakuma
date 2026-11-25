import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { Bell, BriefcaseBusiness, CalendarDays, CheckCircle2, Layers3, LockKeyhole, MapPin, Phone, Save, ShieldCheck, UserRound, Users } from 'lucide-react';
import { api, get } from './api';
import { useAuth } from './auth';
import { Badge, Button, Card, ErrorState, Field, Loading, PageHeader } from './components';
import { AdminPanelHeading } from './AdminTabUi';
import { AssignedCountry, RegionField, useCountries, useCountry } from './geography';
import type { Crisis, User } from './types';
import { caseManagerCountries, caseScopeError, coordinatorCountries, coordinatorPath, isCaseManagerWorkspace, isCoordinatorWorkspace, isShelterWorkspace, shelterCountries, shelterPath, shelterRole } from './countryScope';
import { useShelterSnapshot } from './ShelterDashboard';
import { PanelTitle } from './CaseManagerUi';
import { isVolunteerCoordinatorWorkspace } from './countryScope';
import { VolunteerPanel } from './VolunteerCoordinatorUi';

interface Assignment {
  id: string;
  role: string;
  country: string;
  countryCode?: string;
  organisation: string | null;
  crisis: string | null;
  availableForAssignment: boolean;
  partnerStatus: string | null;
}

interface ProfileDetails {
  assignments: Assignment[];
  workPhone: string | null;
  volunteer: { skills: string; verified: boolean; schedule: string; available: boolean; countryCode?: string;
    serviceRegionId?: string | null; serviceLatitude?: number | null; serviceLongitude?: number | null;
    serviceLocationConsent?: boolean } | null;
}

const staffRoles = [
  'Coordinator',
  'CaseManager',
  'Logistics',
  'ShelterAdmin',
  'VolunteerCoordinator',
];

function assignmentScope(assignment: Assignment) {
  return [assignment.organisation, assignment.country, assignment.crisis]
    .filter(Boolean)
    .join(' · ');
}

export default function ProfilePage({ funding = false }: { funding?: boolean }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();
  const administrator = !funding && !!user?.roles.some(
    (role) => role === 'Administrator' || role === 'CountryAdministrator',
  );
  const manager = isCaseManagerWorkspace(user, location.pathname, location.search);
  const shelter = isShelterWorkspace(user, location.pathname, location.search);
  const volunteerCoordinator = isVolunteerCoordinatorWorkspace(user, location.pathname, location.search);
  const crisisCoordinator = isCoordinatorWorkspace(user, location.pathname, location.search);
  const coordinationRole = crisisCoordinator ? 'Coordinator' : volunteerCoordinator ? 'VolunteerCoordinator' : undefined;
  const citizen = user?.roles.length === 1 && user.roles[0] === 'Citizen';
  const details = useQuery({
    queryKey: ['my-profile', user?.id],
    queryFn: () => get<ProfileDetails>('/auth/profile'),
    enabled: !!user,
  });
  const profileForm = user && details.data ? (
    <ProfileForm key={`${user.id}:${manager}:${shelter}:${coordinationRole}`} user={user} details={details.data}
      managerWorkspace={manager} shelterWorkspace={shelter} coordinationRole={coordinationRole} funding={funding} />
  ) : details.error ? (
    <ErrorState error={details.error} retry={() => void details.refetch()} />
  ) : <Loading />;

  if (funding) return <div className="funding-officer-page">
    <PageHeader title={t('profile')} description="Your work contact information and funding assignments." />
    {user && details.data && <Card>
      <div className="funding-profile-identity">
        <span className="avatar" aria-hidden="true">{user.name.trim().charAt(0).toUpperCase()}</span>
        <div><h2>{user.name}</h2><p className="muted">Funding Officer</p></div>
      </div>
    </Card>}
    <div className="funding-profile-grid">
      {profileForm}
      {details.data && <Card><h2>Funding assignments</h2>
        {details.data.assignments.some(assignment => assignment.role === 'FundingOfficer') ? <ul className="funding-profile-assignments">
          {details.data.assignments.filter(assignment => assignment.role === 'FundingOfficer').map(assignment => <li key={assignment.id}>
            <strong>{assignment.organisation || 'Organisation unavailable'}</strong>
            <span>{[assignment.country || assignment.countryCode, assignment.crisis || 'No specific crisis'].filter(Boolean).join(' · ')}</span>
          </li>)}
        </ul> : <p className="muted">No funding assignment is recorded for this account.</p>}
      </Card>}
    </div>
  </div>;

  return (
    <div className={crisisCoordinator ? 'coord-page coord-profile' : volunteerCoordinator ? 'vc-page' : shelter ? 'shelter-page shelter-management' : manager ? 'cm-page cm-profile' : administrator ? 'admin-tab admin-tab-stack' : citizen ? 'citizen-page citizen-profile' : 'form-page'}>
      {coordinationRole ? <PageHeader title="My Profile" description="Manage your contact details and view your operational assignments." /> :
        shelter ? <PageHeader title="My Profile" description="Manage your contact details and view your shelter assignments." /> : manager ? <header className="cm-page-header"><div>
        <h1 className="cm-title-line"><UserRound aria-hidden="true" />My Profile</h1>
        <p>Manage your account, assignments, availability, and work preferences.</p>
      </div></header> : <PageHeader
        title={t('profile')}
        description={
          administrator ? 'Manage your account details, access scope, and preferences.' : citizen ? t('citizenProfileDescription') : undefined
        }
      />}
      {profileForm}
    </div>
  );
}

function AdminProfilePanels({
  systemAdmin,
  assignedCountries,
}: {
  systemAdmin: boolean;
  assignedCountries: string[];
}) {
  const { t } = useTranslation();
  const countries = useCountries();
  const names =
    systemAdmin && Array.isArray(countries.data)
      ? countries.data.map((country) => country.name)
      : assignedCountries;
  return (
    <div className="admin-tab-stack">
      <Card>
        <AdminPanelHeading
          icon={Layers3}
          title={t(systemAdmin ? 'profileSystemAdmin' : 'profileCountryAdmin')}
          description="Your administrative access scope and country coverage."
        />
        <div className="admin-tab-profile-settings">
          <strong>{systemAdmin ? t('profileSystemAccess') : 'Access to assigned countries'}</strong>
          {systemAdmin && countries.isPending && <Loading />}
          {systemAdmin && countries.error && (
            <ErrorState error={countries.error} retry={() => void countries.refetch()} />
          )}
          {names.length > 0 && (
            <div className="admin-tab-profile-chips">
              {names.map((name) => (
                <span key={name}>
                  <MapPin size={14} aria-hidden="true" />
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>
      </Card>
      <Card>
        <AdminPanelHeading
          icon={LockKeyhole}
          title="Security"
          description="Manage access to your account."
        />
        <div className="admin-tab-count">
          <strong>Password</strong>
          <a href="/forgot-password">Reset password</a>
        </div>
        <div className="admin-tab-count">
          <span>Two-factor authentication</span>
          <strong>Unavailable</strong>
        </div>
        <div className="admin-tab-count">
          <span>Session management</span>
          <strong>Unavailable</strong>
        </div>
      </Card>
      <Card>
        <AdminPanelHeading
          icon={Bell}
          title="Notifications"
          description="Review notifications sent to your account."
        />
        <p className="muted">Surakuma manages delivery for operational and security updates.</p>
        <div className="admin-tab-profile-settings">
          <a href="/app/notifications">Open notification inbox</a>
        </div>
      </Card>
    </div>
  );
}

function ProfileForm({ user, details, managerWorkspace, shelterWorkspace, coordinationRole, funding }: {
  user: User; details: ProfileDetails; managerWorkspace: boolean; shelterWorkspace: boolean; funding: boolean;
  coordinationRole?: 'Coordinator' | 'VolunteerCoordinator';
}) {
  const { updateUser } = useAuth();
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const { assignments, volunteer } = details;
  const country = useCountry();
  const focusedProfile = shelterWorkspace || !!coordinationRole;
  const sharedProfile = !focusedProfile && !funding;
  const citizen = sharedProfile && user.roles.includes('Citizen');
  const citizenLayout = citizen && user.roles.length === 1;
  const volunteerAssignments = sharedProfile ? assignments.filter((assignment) => assignment.role === 'Volunteer') : [];
  const staff = sharedProfile ? assignments.filter((assignment) => staffRoles.includes(assignment.role)) : [];
  const coordinatorAssignments = assignments.filter(a => a.role === coordinationRole && a.countryCode === country);
  const coordinationLabel = coordinationRole === 'Coordinator' ? 'Crisis Coordinator' : 'Volunteer Coordinator';
  const coordinatedCrises = useQuery({
    queryKey: ['crises', country, 'Coordinator'],
    queryFn: () => get<Crisis[]>('/crises'),
    enabled: coordinationRole === 'Coordinator' && coordinatorCountries(user).includes(country),
  });
  const managers = staff.filter(a => a.role === 'CaseManager');
  const otherStaff = managerWorkspace ? staff.filter(a => a.role !== 'CaseManager') : staff;
  const validManagerScope = caseManagerCountries(user).length === 1 && managers.length > 0;
  const savedAvailability = managers.filter(a => a.availableForAssignment).length;
  const savedState = !validManagerScope ? 'Assignment needs attention' : savedAvailability === 0 ? 'Unavailable' :
    savedAvailability === managers.length ? 'Available' : 'Partly available';
  const partners = sharedProfile ? assignments.filter((assignment) => assignment.role === 'Partner') : [];
  const adminCountries = [
    ...new Set(assignments.filter((a) => a.role === 'CountryAdministrator').map((a) => a.country)),
  ];
  const systemAdmin = user.roles.includes('Administrator');
  const admin = sharedProfile && !managerWorkspace && (systemAdmin || user.roles.includes('CountryAdministrator'));
  const formRef = useRef<HTMLFormElement>(null);
  const baseline = useRef('');
  const [dirty, setDirty] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [savedVersion, setSavedVersion] = useState(0);
  useEffect(() => {
    if (formRef.current) baseline.current = JSON.stringify([...new FormData(formRef.current)]);
  }, [savedVersion]);
  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const caseManagerAvailability = Object.fromEntries(
        (managerWorkspace && !validManagerScope ? [] : managers)
          .map((a) => [a, form.has('case-manager-' + a.id)] as const)
          .filter(([a, available]) => a.availableForAssignment !== available)
          .map(([a, available]) => [a.id, available]),
      );
      const schedule = form.get('volunteerSchedule');
      const available = form.has('volunteerAvailable');
      const serviceRegion = form.get('administrativeDivisionId');
      const consent = form.has('serviceLocationConsent');
      const latitude = form.get('serviceLatitude');
      const longitude = form.get('serviceLongitude');
      const area = volunteer?.countryCode && {
        regionId: typeof serviceRegion === 'string' && serviceRegion ? serviceRegion : null,
        consent,
        latitude: consent && latitude ? Number(latitude) : null,
        longitude: consent && longitude ? Number(longitude) : null,
      };
      const areaChanged = area && (area.regionId !== (volunteer?.serviceRegionId ?? null) ||
        area.consent !== !!volunteer?.serviceLocationConsent || area.latitude !== (volunteer?.serviceLatitude ?? null) ||
        area.longitude !== (volunteer?.serviceLongitude ?? null));
      const volunteerAvailability =
        volunteer &&
        typeof schedule === 'string' &&
        (schedule !== volunteer.schedule || available !== volunteer.available || areaChanged)
          ? { schedule, available, serviceArea: areaChanged ? area : undefined }
          : undefined;
      const result = await api.put<User>('/auth/profile', {
        name: form.get('name'),
        language: form.get('language'),
        householdSize: citizen ? Number(form.get('householdSize')) : undefined,
        accessibilityNeeds: citizen ? form.get('accessibilityNeeds') : undefined,
        workPhone: form.get('workPhone') ?? undefined,
        volunteerAvailability,
        caseManagerAvailability: Object.keys(caseManagerAvailability).length
          ? caseManagerAvailability
          : undefined,
      });
      return result.data;
    },
    onSuccess: async (data) => {
      updateUser(data);
      void i18n.changeLanguage(data.language);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['my-profile', user.id] }),
        client.invalidateQueries({ queryKey: ['case-manager-availability'] }),
        client.invalidateQueries({ queryKey: ['volunteers'] }),
      ]);
      setDirty(false);
      setSavedVersion((version) => version + 1);
    },
  });

  const nameField = <Field label={managerWorkspace || focusedProfile ? 'Full name' : t('name')}>
    <input name="name" defaultValue={user.name} autoComplete="name" required
      maxLength={100} pattern=".*\S.*" disabled={save.isPending} />
  </Field>;
  const emailField = <Field label={t('email')} hint={citizenLayout ? t('accountEmailHint') : undefined}>
    <input type="email" value={user.email} readOnly />
  </Field>;
  const languageField = <Field label={focusedProfile ? 'Preferred language' : t('language')}>
    <select name="language" defaultValue={user.language} disabled={save.isPending}>
      <option value="en">English</option><option value="si">සිංහල</option><option value="ta">தமிழ்</option>
      <option value="ne">नेपाली</option><option value="hi">हिन्दी</option>
    </select>
  </Field>;
  const phoneField = <Field label={t('profileWorkPhone')}>
    <input type="tel" name="workPhone" defaultValue={details.workPhone ?? ''} maxLength={40}
      autoComplete="tel" disabled={save.isPending} />
  </Field>;

  return (
    <>
      {managerWorkspace && <Card className="cm-profile-hero">
        <div className="cm-profile-identity">
          <span className="avatar" aria-hidden="true">{user.name.trim().charAt(0).toUpperCase()}</span>
          <div><h2>{user.name}</h2><p>Case Manager</p>
            {[...new Set(managers.flatMap(a => a.organisation ? [a.organisation] : []))].map(org =>
              <span className="cm-profile-org" key={org}><BriefcaseBusiness size={17} aria-hidden="true" />{org}</span>)}
          </div>
        </div>
        <div className="cm-profile-state"><span className="cm-availability-chip" data-available={validManagerScope && savedAvailability > 0}>
          <span aria-hidden="true" /><strong>{savedState}</strong>
        </span><p>{validManagerScope && savedAvailability > 0 ? 'Eligible for automatic case assignment' : 'Automatic assignment is paused'}</p></div>
      </Card>}
      {admin && (
        <Card className="admin-tab-identity">
          <span className="avatar" aria-hidden="true">
            {user.name.trim().charAt(0).toUpperCase()}
          </span>
          <div>
            <h2>{user.name}</h2>
            <p className="muted">{systemAdmin ? 'Administrator' : 'Country Administrator'}</p>
          </div>
        </Card>
      )}
      {citizenLayout && <Card className="citizen-profile-identity">
        <span className="avatar" aria-hidden="true">{user.name.trim().charAt(0).toUpperCase()}</span>
        <div><h2>{user.name}</h2><p className="muted">{t('citizenAccount')}</p></div>
      </Card>}
      <form
        key={savedVersion}
        ref={formRef}
        className={funding ? 'funding-panel funding-profile-form' : citizenLayout ? 'citizen-profile-form' : 'stack'}
        onChange={(event) => {
          if (admin)
            setDirty(JSON.stringify([...new FormData(event.currentTarget)]) !== baseline.current);
          if (save.isSuccess || save.isError) save.reset();
        }}
        onReset={() => {
          setDirty(false);
          save.reset();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (save.isPending || (admin && !dirty)) return;
          const fields = new FormData(event.currentTarget);
          const name = String(fields.get('name') ?? '').trim();
          if (!name) return;
          fields.set('name', name);
          save.mutate(fields);
        }}
      >
        {coordinationRole ? <div className="vc-profile-grid">
          <Card className="vc-profile-summary">
            <span className="vc-avatar" aria-hidden="true">{user.name.trim().charAt(0).toUpperCase()}</span>
            <h2>{user.name}</h2>
            <p className="muted">{coordinationLabel}</p>
            <dl className="vc-data-list">
              <div><dt>Assigned country</dt><dd>{coordinatorAssignments[0]?.country ?? 'Unassigned'}</dd></div>
              <div><dt>Organisation</dt><dd>{[...new Set(coordinatorAssignments.flatMap(a => a.organisation ? [a.organisation] : []))].join(' · ') || 'Unassigned'}</dd></div>
            </dl>
          </Card>
          <div className="vc-page">
            <VolunteerPanel title="Personal information">
              <div className="vc-form-grid">{nameField}{emailField}{languageField}{phoneField}</div>
              <div className="vc-actions vc-form-footer"><Button busy={save.isPending}><Save size={17} /> Save changes</Button></div>
              {save.isSuccess && <p role="status" className="success-text">{t('saved')}</p>}
              {save.error && <ErrorState error={save.error} />}
            </VolunteerPanel>
            <VolunteerPanel title={coordinationRole === 'Coordinator' ? 'Staff assignments' : 'Role and organisation'}>
              {coordinatorAssignments.length ? coordinatorAssignments.map(a => <dl className="vc-data-list" key={a.id}>
                <div><dt>Role</dt><dd>{coordinationLabel}</dd></div>
                <div><dt>Organisation</dt><dd>{a.organisation ?? 'Unassigned'}</dd></div>
                <div><dt>Authorised country</dt><dd>{a.country}</dd></div>
                {a.crisis && <div><dt>Crisis</dt><dd>{a.crisis}</dd></div>}
              </dl>) : <p className="muted">No {coordinationLabel} assignment is recorded for this country.</p>}
            </VolunteerPanel>
            {coordinationRole === 'Coordinator' && coordinatorCountries(user).includes(country) &&
              <VolunteerPanel title="Crisis assignments">
                {coordinatedCrises.isPending ? <Loading /> : coordinatedCrises.error ?
                  <ErrorState error={coordinatedCrises.error} retry={() => void coordinatedCrises.refetch()} /> :
                  coordinatedCrises.data.length ? <ul className="coord-activity-list">{coordinatedCrises.data.map(crisis =>
                    <li key={crisis.id}><Link to={coordinatorPath('/crises', { crisisId: crisis.id })}>{crisis.name}</Link>
                      <Badge value={crisis.active ? 'Active' : 'Ended'} /></li>)}</ul> :
                    <p className="muted">No response events are assigned in this country.</p>}
              </VolunteerPanel>}
          </div>
        </div> : shelterWorkspace ? <div className="shelter-profile-grid">
          <Card>
            <div className="shelter-profile-identity">
              <span className="avatar" aria-hidden="true">{user.name.trim().charAt(0).toUpperCase()}</span>
              <div><h2>{user.name}</h2><p className="muted">Shelter Administrator</p></div>
            </div>
            <h2>Personal information</h2>
            <div className="form-grid">{nameField}{emailField}{languageField}{phoneField}</div>
            <Button busy={save.isPending}><Save size={17} /> Save changes</Button>
            {save.isSuccess && <p role="status" className="success-text">{t('saved')}</p>}
            {save.error && <ErrorState error={save.error} />}
          </Card>
          <ShelterAssignments user={user} assignments={assignments} />
        </div> : managerWorkspace ? <div className="cm-profile-grid">
          <div className="cm-profile-contact">
            <Card className="cm-panel">
              <PanelTitle icon={UserRound} title="Personal information" description="Your basic profile information." />
              <div className="cm-form-fields">{nameField}
                <Field label="Role" endAdornment={<span className="cm-role-lock"><LockKeyhole size={16} aria-hidden="true" /></span>}><input value="Case Manager" readOnly /></Field>
              </div>
            </Card>
            <Card className="cm-panel">
              <PanelTitle icon={Phone} title="Work contact & language" description="How we can reach you and your preferred language." />
              <div className="cm-form-fields">{emailField}{phoneField}{languageField}</div>
            </Card>
          </div>
          <div className="cm-profile-access">
            <Card className="cm-panel">
              <PanelTitle icon={Users} title="Staff assignments" description="Your current operational assignments in Surakuma."
                action={validManagerScope && <button type="button" className="cm-permissions-button" aria-expanded={permissionsOpen}
                  aria-controls="cm-profile-permissions" onClick={() => setPermissionsOpen(open => !open)}>
                  <ShieldCheck size={17} aria-hidden="true" />{permissionsOpen ? 'Hide permissions' : 'View permissions'}
                </button>} />
              {managers.length ? managers.map(a => <dl className="cm-scope-list" key={a.id}>
                <div><dt>Organisation</dt><dd>{a.organisation || 'Unassigned'}</dd></div>
                <div><dt>Role</dt><dd>Case Manager</dd></div>
                <div><dt>Case scope</dt><dd>{a.crisis || 'Cases in the assigned centre and country'}</dd></div>
              </dl>) : <p>No Case Manager assignment is recorded.</p>}
              {validManagerScope && <p id="cm-profile-permissions" className="cm-permissions" hidden={!permissionsOpen}>
                Review, verify, approve, and escalate cases within the organisation and crisis scope of your Case Manager assignments. Fulfilment is visible here for coordination.
              </p>}
            </Card>
            <Card className="cm-panel">
              <PanelTitle icon={MapPin} title="Country & organisation scope" description="Your operating country and assigned organisations." />
              <dl className="cm-scope-list">
                <div><dt>Country</dt><dd>{[...new Set(managers.map(a => a.country))].join(' · ') || 'Unassigned'}</dd></div>
                <div><dt>Operational organisation</dt><dd>{[...new Set(managers.flatMap(a => a.organisation ? [a.organisation] : []))].join(' · ') || 'Unassigned'}</dd></div>
              </dl>
              {!validManagerScope && <p role="alert" className="field-error">{caseScopeError}</p>}
            </Card>
            <Card className="cm-panel cm-profile-availability">
              <PanelTitle icon={CalendarDays} title="Availability for automatic case assignment"
                description="Control whether you can receive new case assignments." />
              {validManagerScope ? <div className="cm-availability-box">
                {managers.map(a => <label className="cm-availability-switch" key={a.id}>
                  <CheckCircle2 size={19} aria-hidden="true" /><span><strong>Available for new cases</strong>
                    <small>{assignmentScope(a)}</small></span>
                  <input type="checkbox" name={'case-manager-' + a.id}
                    defaultChecked={a.availableForAssignment} disabled={save.isPending} />
                </label>)}
                <p>New cases can be assigned automatically within the scope of an available assignment.</p>
              </div> : <p>An administrator needs to resolve the country assignment before you can receive new cases.</p>}
            </Card>
          </div>
        </div> : <div className={admin ? 'admin-tab-profile-grid' : citizenLayout ? 'citizen-personal-panel' : undefined}>
          <Card>
            <div className="stack">
              {admin && (
                <AdminPanelHeading
                  icon={UserRound}
                  title="Personal information"
                  description="Your account details and general preferences."
                />
              )}
              {funding && <h2>Account details</h2>}
              {citizenLayout && <h2>{t('personalInformation')}</h2>}
              {nameField}{emailField}{languageField}
              {(systemAdmin || assignments.length > 0) && phoneField}
            </div>
          </Card>
          {admin && (
            <AdminProfilePanels systemAdmin={systemAdmin} assignedCountries={adminCountries} />
          )}
        </div>}
        {citizen && (
          <Card className="stack citizen-household-panel">
            <h2>{t('profileHousehold')}</h2>
            <Field label={t('householdSize')}>
              <input
                type="number"
                name="householdSize"
                defaultValue={user.householdSize}
                min={1}
                max={50}
                required
              />
            </Field>
            <Field label={t('accessibilityNeeds')} hint={citizenLayout ? t('householdAccessibilityHint') : undefined}>
              <input
                name="accessibilityNeeds"
                defaultValue={user.accessibilityNeeds}
                maxLength={500}
              />
            </Field>
          </Card>
        )}
        {volunteerAssignments.length > 0 && (
          <Card className="stack">
            <h2>{t('profileVolunteer')}</h2>
            <ul className="profile-assignments">
              {volunteerAssignments.map((a) => (
                <li key={a.id}>{assignmentScope(a)}</li>
              ))}
            </ul>
            {volunteer ? (
              <>
                <Field label={t('profileVolunteerSkills')}>
                  <input value={volunteer.skills} readOnly />
                </Field>
                <p>
                  {t('profileVerification')}{' '}
                  <Badge value={volunteer.verified ? 'Verified' : 'Pending'} />
                </p>
                <Field label={t('profileVolunteerSchedule')}>
                  <input
                    name="volunteerSchedule"
                    defaultValue={volunteer.schedule}
                    maxLength={500}
                  />
                </Field>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    name="volunteerAvailable"
                    defaultChecked={volunteer.available}
                  />
                  {t('profileVolunteerAvailable')}
                </label>
                {volunteer.countryCode && <fieldset className="stack">
                  <legend>Volunteer service area</legend>
                  <RegionField countryCode={volunteer.countryCode} initialDivisionId={volunteer.serviceRegionId} />
                  <label className="checkbox-label"><input type="checkbox" name="serviceLocationConsent"
                    defaultChecked={volunteer.serviceLocationConsent} /> Use my service point to rank nearby assignments</label>
                  <div className="form-grid">
                    <Field label="Service point latitude"><input name="serviceLatitude" type="number" min="-90" max="90" step="any"
                      defaultValue={volunteer.serviceLatitude ?? undefined} /></Field>
                    <Field label="Service point longitude"><input name="serviceLongitude" type="number" min="-180" max="180" step="any"
                      defaultValue={volunteer.serviceLongitude ?? undefined} /></Field>
                  </div>
                </fieldset>}
              </>
            ) : (
              <p>{t('profileVolunteerSetup')}</p>
            )}
          </Card>
        )}
        {otherStaff.length > 0 && (
          <Card className="stack">
            <h2>{t('profileStaff')}</h2>
            <ul className="profile-assignments">
              {otherStaff.map((a) => (
                <li key={a.id}>
                  <strong>{t('profileRole.' + a.role)}</strong>
                  <p>{assignmentScope(a)}</p>
                  {a.role === 'CaseManager' && (
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        name={'case-manager-' + a.id}
                        defaultChecked={a.availableForAssignment}
                      />
                      <span>
                        {t('profileCaseAvailable')}
                        <span className="sr-only"> {assignmentScope(a)}</span>
                      </span>
                    </label>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
        {partners.length > 0 && (
          <Card className="stack">
            <h2>{t('profilePartner')}</h2>
            <ul className="profile-assignments">
              {partners.map((a) => (
                <li key={a.id}>
                  <strong>{assignmentScope(a)}</strong>
                  <p>
                    {t('profileVerification')} <Badge value={a.partnerStatus ?? 'Pending'} />
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {focusedProfile ? null : admin ? (
          <div className="admin-tab-profile-actions">
            <Button busy={save.isPending} disabled={!dirty}>
              {t('save')}
            </Button>
            <Button type="reset" variant="secondary" disabled={!dirty || save.isPending}>
              Discard changes
            </Button>
          </div>
        ) : (
          <Button busy={save.isPending}>{(managerWorkspace || citizenLayout) && <Save size={18} aria-hidden="true" />}{t('save')}</Button>
        )}
        {!focusedProfile && save.isSuccess && (
          <p role="status" className="success-text">
            {t('saved')}
          </p>
        )}
        {!focusedProfile && save.error && <ErrorState error={save.error} />}
      </form>
    </>
  );
}

function ShelterAssignments({ user, assignments }: { user: User; assignments: Assignment[] }) {
  const countries = shelterCountries(user);
  const country = countries.length === 1 ? countries[0] : '';
  const assigned = [...new Set(assignments.filter(a => a.role === 'ShelterAdmin' && !a.crisis && a.organisation)
    .map(a => a.organisation))].join(' · ');
  const shelters = useShelterSnapshot(country, true, !!country);
  return <div className="stack">
    <Card>
      <h2><ShieldCheck size={19} /> Staff assignments</h2>
      <dl className="shelter-assignments">
        <div><dt>Operating organisation</dt><dd>{assigned || 'Unassigned'}</dd></div>
        <div><dt>Assigned country</dt><dd><AssignedCountry code={country || undefined} /></dd></div>
        <div><dt>Role</dt><dd>Shelter Administrator</dd></div>
        <div><dt>Authorized shelters</dt><dd>{shelters.data ? <Link to={shelterPath('/shelters')}>
          {shelters.data.statistics.total.toLocaleString()} shelter records</Link> : country && shelters.isPending ? 'Loading…' : 'Unavailable'}</dd></div>
        <div><dt>Permissions</dt><dd>Register and review shelters, edit capacity, manage reservations and arrivals, and request supplies within your assignment.</dd></div>
      </dl>
      {shelters.error && <ErrorState error={shelters.error} retry={() => void shelters.refetch()} />}
    </Card>
    <Card><h2><Bell size={19} /> Notifications</h2>
      <Link className="text-link" to={'/app/notifications' + shelterRole}>View operational notifications</Link>
    </Card>
  </div>;
}
