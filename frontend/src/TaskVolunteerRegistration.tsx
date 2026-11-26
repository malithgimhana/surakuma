import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { get } from './api';
import { useCaseDispatches } from './CaseDispatches';
import { Button, Empty, ErrorState, Field, Loading, PageHeader } from './components';
import { AssignedCountry, useDivisions } from './geography';
import type { Volunteer } from './types';
import { VolunteerPanel } from './VolunteerCoordinatorUi';
import { coordinationPath, useVolunteerSearch, useVolunteerWrite } from './volunteerWorkspace';
import type { EligibleVolunteerCase, VolunteerWorkspaceData } from './volunteerWorkspace';

type Registration = {
  requestId: string;
  caseDispatchId?: string;
  name?: string;
  email: string;
  password?: string;
  useExistingAccount: boolean;
  profile: { skills: string; available: boolean; serviceRegionId: string | null };
};

export default function TaskVolunteerRegistration({ data, initialCase, initialDispatch }: {
  data: VolunteerWorkspaceData;
  initialCase: string | null;
  initialDispatch: string | null;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [caseId, setCaseId] = useState(initialCase ?? '');
  const [dispatchId, setDispatchId] = useState(initialDispatch ?? '');
  const [useExistingAccount, setUseExistingAccount] = useState(false);
  const criteria = useVolunteerSearch(search);
  const cases = useQuery({
    queryKey: ['volunteer-cases', data.country, 'registration', criteria.value],
    queryFn: () => get<EligibleVolunteerCase[]>(`/volunteer-tasks/cases?search=${encodeURIComponent(criteria.value)}`),
  });
  const linkedCase = useQuery({
    queryKey: ['volunteer-cases', data.country, 'linked', initialCase],
    queryFn: () => get<EligibleVolunteerCase[]>(`/volunteer-tasks/cases?requestId=${encodeURIComponent(initialCase ?? '')}`),
    enabled: !!initialCase,
  });
  const options = [...new Map([...(linkedCase.data ?? []), ...(cases.data ?? [])].map(item => [item.id, item])).values()];
  const request = options.find(item => item.id === caseId);
  const regions = useDivisions(data.country);
  const area = regions.data?.find(region => region.id === request?.administrativeDivisionId);
  const dispatches = useCaseDispatches(request?.id, 'volunteer-coordinator', !!request?.requiresCentreHandover);
  const available = dispatches.data?.dispatches.filter(dispatch => dispatch.availableForAssignment) ?? [];
  const dispatch = dispatchId ? available.find(item => item.id === dispatchId)
    : available.length === 1 ? available[0] : undefined;
  const register = useVolunteerWrite<Volunteer, Registration>('/volunteers/task-registration');
  const canRegister = !!request && (!request.requiresCentreHandover || !!dispatch);
  const assignmentPath = coordinationPath('assign', {
    ...(caseId && { case: caseId }),
    ...(dispatch?.id && { dispatch: dispatch.id }),
  });
  const read = (fields: FormData, name: string) => String(fields.get(name) ?? '').trim();
  return <>
    <PageHeader title="Register task volunteer" description="Register a volunteer for one assignment on a case in your scope."
      action={<Link className="button secondary" to={assignmentPath}>Back to assignment</Link>} />
    <VolunteerPanel title="Case and volunteer details">
      <form className="vc-form" onSubmit={event => {
        event.preventDefault();
        if (!request || !canRegister || register.isPending) return;
        const fields = new FormData(event.currentTarget);
        register.mutate({
          requestId: request.id, caseDispatchId: dispatch?.id, email: read(fields, 'email'), useExistingAccount,
          ...(!useExistingAccount && { name: read(fields, 'name'), password: String(fields.get('password') ?? '') }),
          profile: { skills: read(fields, 'skills'), available: true, serviceRegionId: request.administrativeDivisionId ?? null },
        }, { onSuccess: profile => navigate(coordinationPath('manage', { volunteer: profile.id, mode: 'view' }),
          { replace: true, state: { success: 'Volunteer registered. Verify the profile before assigning the task.' } }) });
      }}>
        <div className="vc-form-grid">
          <Field label="Search cases">
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Case reference or location" />
          </Field>
          <Field label="Case" hint={criteria.pending || cases.isFetching ? 'Searching cases…' : undefined}>
            <select value={caseId} onChange={event => { setCaseId(event.target.value); setDispatchId(''); }} required>
              <option value="">Choose an eligible case</option>
              {options.map(item => <option key={item.id} value={item.id}>{item.reference} · {item.locationText}</option>)}
            </select>
          </Field>
          {request?.requiresCentreHandover && <Field label="Centre dispatch">
            <select value={dispatch?.id ?? ''} required onChange={event => setDispatchId(event.target.value)}>
              <option value="">Choose a received dispatch</option>
              {available.map(item => <option key={item.id} value={item.id}>{item.reference} · {item.centre}</option>)}
            </select>
          </Field>}
          {request && <div className="vc-inset">
            <strong>{data.organisations.find(org => org.id === request.organisationId)?.name}</strong>
            <p><AssignedCountry code={data.country} /></p>
            <p>Task area · {area?.name ?? request.locationText}</p>
          </div>}
        </div>
        {cases.isPending && <Loading />}
        {cases.error && <ErrorState error={cases.error} retry={() => void cases.refetch()} />}
        {linkedCase.error && <ErrorState error={linkedCase.error} retry={() => void linkedCase.refetch()} />}
        {dispatches.error && <ErrorState error={dispatches.error} retry={() => void dispatches.refetch()} />}
        {initialCase && linkedCase.isSuccess && !request && <p role="status" className="muted">
          This case has no delivery ready to assign in your workspace. Check for an existing assignment or ask the receiving centre to confirm arrival.
        </p>}
        {cases.isSuccess && !options.length && !initialCase && <Empty title={criteria.value ? 'No ready cases match your search' : 'No cases ready for a volunteer'}
          description={criteria.value ? 'Try the case reference or clear your search.' : 'Cases appear here when they need a volunteer. For aid deliveries, the centre records receipt first.'} />}
        {request?.requiresCentreHandover && dispatches.isPending && <Loading />}
        {request?.requiresCentreHandover && dispatches.isSuccess && !dispatch && <p role="status" className="muted">
          {available.length ? 'Choose a received dispatch to continue.' : 'There are no unassigned items ready for collection at the centre.'}
        </p>}
        {canRegister && <fieldset key={`${caseId}-${dispatch?.id ?? ''}`} className="vc-fieldset vc-form-grid" disabled={register.isPending}>
          <legend>Volunteer account</legend>
          <label className="checkbox-label">
            <input type="checkbox" checked={useExistingAccount} onChange={event => setUseExistingAccount(event.target.checked)} />
            Use existing citizen account
          </label>
          {!useExistingAccount && <Field label="Full name"><input name="name" maxLength={100} required /></Field>}
          <Field label="Email"><input name="email" type="email" autoComplete="off" maxLength={256} required /></Field>
          {!useExistingAccount && <Field label="Initial password" hint="Use at least 10 characters. The account invitation includes the sign-in details.">
            <input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={100} required />
          </Field>}
          <Field label="Skills" hint="Separate multiple skills with commas.">
            <input name="skills" maxLength={1000} defaultValue={dispatch ? 'Distribution' : ''} placeholder="e.g. First Aid" required />
          </Field>
        </fieldset>}
        {register.error && <ErrorState error={register.error} />}
        {canRegister && <div className="vc-actions vc-form-footer">
          <Button busy={register.isPending} disabled={!canRegister}>{useExistingAccount ? 'Save task volunteer profile' : 'Create account and profile'}</Button>
        </div>}
      </form>
    </VolunteerPanel>
  </>;
}
