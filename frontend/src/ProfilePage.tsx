import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, get } from './api';
import { useAuth } from './auth';
import { Badge, Button, Card, ErrorState, Field, Loading, PageHeader } from './components';
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
  const details = useQuery({
    queryKey: ['my-profile', user?.id],
    queryFn: () => get<ProfileDetails>('/auth/profile'),
    enabled: !!user,
  });

  return (
    <div className="form-page">
      <PageHeader title={t('profile')} />
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
    },
  });

  return (
    <form
      className="stack"
      onChange={() => {
        if (save.isSuccess || save.isError) save.reset();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(new FormData(event.currentTarget));
      }}
    >
      <Card>
        <div className="stack">
          <Field label={t('name')}>
            <input
              name="name"
              defaultValue={user.name}
              autoComplete="name"
              required
              maxLength={100}
            />
          </Field>
          <Field label={t('email')}>
            <input type="email" value={user.email} readOnly />
          </Field>
          <Field label={t('language')}>
            <select name="language" defaultValue={user.language}>
              <option value="en">English</option>
              <option value="si">සිංහල</option>
              <option value="ta">தமிழ்</option>
              <option value="ne">नेपाली</option>
              <option value="hi">हिन्दी</option>
            </select>
          </Field>
          {assignments.length > 0 && (
            <Field label={t('profileWorkPhone')}>
              <input
                type="tel"
                name="workPhone"
                defaultValue={details.workPhone ?? ''}
                maxLength={40}
                autoComplete="tel"
              />
            </Field>
          )}
        </div>
      </Card>
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
                <input name="volunteerSchedule" defaultValue={volunteer.schedule} maxLength={500} />
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
      {adminCountries.length > 0 && (
        <Card className="stack">
          <h2>{t('profileCountryAdmin')}</h2>
          <p>{adminCountries.join(' · ')}</p>
        </Card>
      )}
      {systemAdmin && (
        <Card className="stack">
          <h2>{t('profileSystemAdmin')}</h2>
          <p>{t('profileSystemAccess')}</p>
        </Card>
      )}
      <Button busy={save.isPending}>{t('save')}</Button>
      {save.isSuccess && (
        <p role="status" className="success-text">
          {t('saved')}
        </p>
      )}
      {save.error && <ErrorState error={save.error} />}
    </form>
  );
}
