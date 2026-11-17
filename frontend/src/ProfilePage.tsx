import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers3, LockKeyhole, MapPin, UserRound, Bell } from 'lucide-react';
import { api, get } from './api';
import { useAuth } from './auth';
import { Badge, Button, Card, ErrorState, Field, Loading, PageHeader } from './components';
import { AdminPanelHeading } from './AdminTabUi';
import { useCountries } from './geography';
import type { User } from './types';

interface Assignment {
  id: string;
  role: string;
  country: string;
  organisation: string | null;
  crisis: string | null;
  availableForAssignment: boolean;
  partnerStatus: string | null;
}

interface ProfileDetails {
  assignments: Assignment[];
  workPhone: string | null;
  volunteer: { skills: string; verified: boolean; schedule: string; available: boolean } | null;
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

export default function ProfilePage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const administrator = !!user?.roles.some(
    (role) => role === 'Administrator' || role === 'CountryAdministrator',
  );
  const details = useQuery({
    queryKey: ['my-profile', user?.id],
    queryFn: () => get<ProfileDetails>('/auth/profile'),
    enabled: !!user,
  });

  return (
    <div className={administrator ? 'admin-tab admin-tab-stack' : 'form-page'}>
      <PageHeader
        title={t('profile')}
        description={
          administrator ? 'Manage your account details, access scope, and preferences.' : undefined
        }
      />
      {user && details.data ? (
        <ProfileForm key={user.id} user={user} details={details.data} />
      ) : details.error ? (
        <ErrorState error={details.error} retry={() => void details.refetch()} />
      ) : (
        <Loading />
      )}
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

function ProfileForm({ user, details }: { user: User; details: ProfileDetails }) {
  const { updateUser } = useAuth();
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const { assignments, volunteer } = details;
  const citizen = user.roles.includes('Citizen');
  const volunteerAssignments = assignments.filter((assignment) => assignment.role === 'Volunteer');
  const staff = assignments.filter((assignment) => staffRoles.includes(assignment.role));
  const partners = assignments.filter((assignment) => assignment.role === 'Partner');
  const adminCountries = [
    ...new Set(assignments.filter((a) => a.role === 'CountryAdministrator').map((a) => a.country)),
  ];
  const systemAdmin = user.roles.includes('Administrator');
  const admin = systemAdmin || user.roles.includes('CountryAdministrator');
  const formRef = useRef<HTMLFormElement>(null);
  const baseline = useRef('');
  const [dirty, setDirty] = useState(false);
  const [savedVersion, setSavedVersion] = useState(0);
  useEffect(() => {
    if (formRef.current) baseline.current = JSON.stringify([...new FormData(formRef.current)]);
  }, [savedVersion]);
  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const managers = staff.filter((a) => a.role === 'CaseManager');
      const caseManagerAvailability = Object.fromEntries(
        managers
          .map((a) => [a, form.has('case-manager-' + a.id)] as const)
          .filter(([a, available]) => a.availableForAssignment !== available)
          .map(([a, available]) => [a.id, available]),
      );
      const schedule = form.get('volunteerSchedule');
      const available = form.has('volunteerAvailable');
      const volunteerAvailability =
        volunteer &&
        typeof schedule === 'string' &&
        (schedule !== volunteer.schedule || available !== volunteer.available)
          ? { schedule, available }
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

  return (
    <>
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
      <form
        key={savedVersion}
        ref={formRef}
        className="stack"
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
        <div className={admin ? 'admin-tab-profile-grid' : undefined}>
          <Card>
            <div className="stack">
              {admin && (
                <AdminPanelHeading
                  icon={UserRound}
                  title="Personal information"
                  description="Your account details and general preferences."
                />
              )}
              <Field label={t('name')}>
                <input
                  name="name"
                  defaultValue={user.name}
                  autoComplete="name"
                  required
                  maxLength={100}
                  pattern=".*\S.*"
                  disabled={save.isPending}
                />
              </Field>
              <Field label={t('email')}>
                <input type="email" value={user.email} readOnly />
              </Field>
              <Field label={t('language')}>
                <select name="language" defaultValue={user.language} disabled={save.isPending}>
                  <option value="en">English</option>
                  <option value="si">සිංහල</option>
                  <option value="ta">தமிழ்</option>
                  <option value="ne">नेपाली</option>
                  <option value="hi">हिन्दी</option>
                </select>
              </Field>
              {(systemAdmin || assignments.length > 0) && (
                <Field label={t('profileWorkPhone')}>
                  <input
                    type="tel"
                    name="workPhone"
                    defaultValue={details.workPhone ?? ''}
                    maxLength={40}
                    autoComplete="tel"
                    disabled={save.isPending}
                  />
                </Field>
              )}
            </div>
          </Card>
          {admin && (
            <AdminProfilePanels systemAdmin={systemAdmin} assignedCountries={adminCountries} />
          )}
        </div>
        {citizen && (
          <Card className="stack">
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
            <Field label={t('accessibilityNeeds')}>
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
              </>
            ) : (
              <p>{t('profileVolunteerSetup')}</p>
            )}
          </Card>
        )}
        {staff.length > 0 && (
          <Card className="stack">
            <h2>{t('profileStaff')}</h2>
            <ul className="profile-assignments">
              {staff.map((a) => (
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
        {admin ? (
          <div className="admin-tab-profile-actions">
            <Button busy={save.isPending} disabled={!dirty}>
              {t('save')}
            </Button>
            <Button type="reset" variant="secondary" disabled={!dirty || save.isPending}>
              Discard changes
            </Button>
          </div>
        ) : (
          <Button busy={save.isPending}>{t('save')}</Button>
        )}
        {save.isSuccess && (
          <p role="status" className="success-text">
            {t('saved')}
          </p>
        )}
        {save.error && <ErrorState error={save.error} />}
      </form>
    </>
  );
}
