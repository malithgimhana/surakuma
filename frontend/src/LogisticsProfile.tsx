import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CircleCheck, Contact, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, errorMessage, get } from './api';
import { useAuth } from './auth';
import { Button, Card, ErrorState, Field, Loading } from './components';
import { logisticsCountries } from './countryScope';
import { logisticsHref, LogisticsHeader, LogisticsHeading, useLogisticsData } from './LogisticsUi';
import type { User } from './types';
import LogisticsPreferences from './LogisticsPreferences';

interface ProfileDetails {
  assignments: {
    id: string;
    role: string;
    country: string;
    organisation: string | null;
    crisis: string | null;
    depot?: string | null;
  }[];
  workPhone: string | null;
  emailConfirmed?: boolean;
}

export default function LogisticsProfile() {
  const { user } = useAuth();
  const profile = useQuery({
    queryKey: ['logistics-profile', user?.id],
    queryFn: () => get<ProfileDetails>('/auth/profile'),
    enabled: !!user,
  });
  return (
    <div className="logistics-page">
      <LogisticsHeader
        title="My logistics profile"
        description="Your account, organisation and logistics permissions."
      />
      {profile.error ? (
        <ErrorState error={profile.error} retry={() => void profile.refetch()} />
      ) : user && profile.data ? (
        <LogisticsContact key={user.id} user={user} profile={profile.data} />
      ) : (
        <Loading />
      )}
    </div>
  );
}

function LogisticsContact({ user, profile }: { user: User; profile: ProfileDetails }) {
  const { t, i18n } = useTranslation();
  const { updateUser } = useAuth();
  const client = useQueryClient();
  const assignments = profile.assignments.filter((assignment) => assignment.role === 'Logistics');
  const validScope =
    logisticsCountries(user).length === 1 &&
    assignments.some((assignment) => assignment.organisation);
  const scoped = useLogisticsData(validScope);
  const [name, setName] = useState(user.name);
  const [language, setLanguage] = useState(user.language);
  const [phone, setPhone] = useState(profile.workPhone ?? '');
  const draft = {
    ...(name.trim() !== user.name ? { name: name.trim() } : {}),
    ...(language !== user.language ? { language } : {}),
    ...(phone.trim() !== (profile.workPhone ?? '') ? { workPhone: phone.trim() } : {}),
  };
  const dirty = Object.keys(draft).length > 0;
  const save = useMutation({
    mutationFn: (changes: typeof draft) => api.patch<User>('/auth/profile/contact', changes),
    onSuccess: async ({ data }) => {
      updateUser(data);
      setName(data.name);
      await i18n.changeLanguage(data.language);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['logistics-profile', user.id] }),
        client.invalidateQueries({ queryKey: ['my-profile', user.id] }),
      ]);
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (dirty && name.trim() && !save.isPending) save.mutate(draft);
  };
  const organisations = [
    ...new Set(
      assignments.flatMap((assignment) =>
        assignment.organisation ? [assignment.organisation] : [],
      ),
    ),
  ];
  const countries = [...new Set(assignments.map((assignment) => assignment.country))];
  return (
    <div className="logistics-columns">
      <div className="stack">
        <Card>
          <div className="logistics-identity">
            <span className="avatar" aria-hidden="true">
              {user.name.trim().charAt(0).toLocaleUpperCase()}
            </span>
            <div>
              <div className="logistics-scope-row">
                <h2>{user.name}</h2>
                {profile.emailConfirmed && (
                  <span className="logistics-verified logistics-status" data-status="Normal">
                    <CircleCheck size={14} aria-hidden="true" /> Email verified
                  </span>
                )}
              </div>
              <p>Logistics staff</p>
              {organisations.length > 0 && <p>{organisations.join(' · ')}</p>}
              {countries.length > 0 && <p>{countries.join(' · ')}</p>}
            </div>
          </div>
        </Card>
        <Card>
          <LogisticsHeading icon={Contact}>Contact information</LogisticsHeading>
          <form className="stack" onSubmit={submit} onChange={() => save.reset()}>
            <fieldset className="form-grid" disabled={save.isPending}>
              <div className="logistics-wide">
                <Field label={t('name')}>
                  <input
                    autoComplete="name"
                    required
                    value={name}
                    maxLength={100}
                    pattern=".*\S.*"
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
              </div>
              <div className="logistics-wide">
                <Field label={t('email')} hint="Managed by your account sign-in.">
                  <input type="email" value={user.email} readOnly />
                </Field>
              </div>
              <Field label={t('language')}>
                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  <option value="en">English</option>
                  <option value="si">සිංහල</option>
                  <option value="ta">தமிழ்</option>
                  <option value="ne">नेपाली</option>
                  <option value="hi">हिन्दी</option>
                </select>
              </Field>
              <Field label={t('profileWorkPhone')}>
                <input
                  type="tel"
                  value={phone}
                  maxLength={40}
                  pattern={String.raw`(?=.*[0-9])[+0-9\(\). \-]+`}
                  autoComplete="tel"
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
            </fieldset>
            <Button busy={save.isPending} disabled={!dirty}>
              {t('save')}
            </Button>
            {save.error && (
              <p role="alert" className="field-error">
                {errorMessage(save.error)}
              </p>
            )}
            {save.isSuccess && (
              <p role="status" className="organisation-notice">
                Profile changes saved.
              </p>
            )}
          </form>
        </Card>
      </div>
      <div className="stack">
        <Card>
          <LogisticsHeading icon={ShieldCheck}>My assignments &amp; permissions</LogisticsHeading>
          {!validScope && (
            <p role="status">
              An administrator needs to confirm one operating country and a Logistics organisation
              assignment.
            </p>
          )}
          <ul className="logistics-list">
            {assignments.map((assignment) => (
              <li key={assignment.id}>
                <strong>{assignment.organisation ?? 'Organisation unavailable'}</strong>
                <small>
                  {assignment.country}
                  {assignment.depot && ` · ${assignment.depot}`}
                  {assignment.crisis
                    ? ` · ${assignment.crisis}`
                    : ' · Organisation-wide assignment'}
                </small>
              </li>
            ))}
          </ul>
          {validScope &&
            (scoped.isPending ? (
              <Loading />
            ) : scoped.error ? (
              <ErrorState error={scoped.error} retry={() => void scoped.refetch()} />
            ) : (
              <dl className="logistics-detail-grid">
                <div>
                  <dt>Registered depots</dt>
                  <dd>
                    {(scoped.data.resourceRegistration?.depots ?? scoped.data.depots)
                      .map((depot) => depot.name).join(' · ') || 'None in your assignment.'}
                  </dd>
                </div>
                <div>
                  <dt>Allowed operations</dt>
                  <dd>
                    <ul>
                      {scoped.data.inventory.length > 0 && (
                        <li>View and record stock at assigned locations.</li>
                      )}
                      <li>
                        Reserve and dispatch stock and record delivery confirmations for approved
                        cases in your assignment.
                      </li>
                      {(scoped.data.resourceRegistration?.partners ?? scoped.data.partners).length > 0 && (
                        <li>Add resources at assigned depots for verified organisations.</li>
                      )}
                      {scoped.data.partners.length > 0 && (
                        <li>Queue shipments and request supplies for verified assigned organisations.</li>
                      )}
                    </ul>
                  </dd>
                </div>
              </dl>
            ))}
        </Card>
        <Card>
          <LogisticsHeading icon={Bell}>Notification preferences</LogisticsHeading>
          <LogisticsPreferences />
          <Link className="logistics-link" to={logisticsHref('/app/notifications')}>
            Open notification inbox
          </Link>
        </Card>
      </div>
    </div>
  );
}
