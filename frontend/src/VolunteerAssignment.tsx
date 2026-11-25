import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage, get } from './api';
import { useCaseDispatches } from './CaseDispatches';
import { Badge, Button, DateInput, Empty, ErrorState, Field, Loading } from './components';
import type { VolunteerTask } from './types';
import { VolunteerPanel, VolunteerPill } from './VolunteerCoordinatorUi';
import {
  coordinationPath,
  rosterSkills,
  useVolunteerSearch,
  useVolunteerWrite,
  volunteerName,
} from './volunteerWorkspace';
import type { EligibleVolunteerCase, VolunteerWorkspaceData } from './volunteerWorkspace';

const steps = ['Select case', 'Match volunteer', 'Schedule', 'Confirm assignment'];
const calendarDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
const dueDateError = 'Choose a due date of today or later, on or after the start date.';
type Candidate = { id: string; explanation: string; skills: string; availability: string };
type AssignmentInput = {
  requestId: string;
  volunteerId: string;
  title: string;
  requiredSkill: string;
  startsAt: string | null;
  dueAt: string;
  instructions: string;
  caseDispatchId?: string;
};

export default function VolunteerAssignment({
  data,
  initialCase,
  initialDispatch,
  preferredVolunteer,
}: {
  data: VolunteerWorkspaceData;
  initialCase: string | null;
  initialDispatch: string | null;
  preferredVolunteer: string | null;
}) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [search, setSearch] = useState('');
  const [chosenCase, setChosenCase] = useState<EligibleVolunteerCase>();
  const [dispatchId, setDispatchId] = useState(initialDispatch ?? '');
  const [volunteer, setVolunteer] = useState(preferredVolunteer ?? '');
  const [title, setTitle] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [starts, setStarts] = useState('');
  const [due, setDue] = useState('');
  const [instructions, setInstructions] = useState('');
  const [validation, setValidation] = useState('');
  const activeStep = useRef<HTMLDivElement>(null);
  const criteria = useVolunteerSearch(search);
  const cases = useQuery({
    queryKey: ['volunteer-cases', data.country, criteria.value],
    queryFn: () =>
      get<EligibleVolunteerCase[]>(
        `/volunteer-tasks/cases?search=${encodeURIComponent(criteria.value)}`,
      ),
    enabled: step === 0,
  });
  const linkedCase = useQuery({
    queryKey: ['volunteer-cases', data.country, 'linked', initialCase],
    queryFn: () =>
      get<EligibleVolunteerCase[]>(
        `/volunteer-tasks/cases?requestId=${encodeURIComponent(initialCase ?? '')}`,
      ),
    enabled: !!initialCase && step === 0,
  });
  const selectedCase = chosenCase ?? linkedCase.data?.[0];
  const dispatches = useCaseDispatches(selectedCase?.id, 'volunteer-coordinator', !!selectedCase?.requiresCentreHandover);
  const availableDispatches = dispatches.data?.dispatches.filter(dispatch => dispatch.availableForAssignment) ?? [];
  const selectedDispatch = dispatchId
    ? availableDispatches.find(dispatch => dispatch.id === dispatchId)
    : availableDispatches.length === 1 ? availableDispatches[0] : undefined;
  const deliveryAssignment = !!selectedCase?.requiresCentreHandover;
  const reviewStep = deliveryAssignment ? 2 : 3;
  const assignmentSteps = deliveryAssignment
    ? ['Select case', 'Choose volunteer and deadline', 'Confirm assignment'] : steps;
  const assignmentTitle = title.trim() || (selectedDispatch ? `Deliver aid from ${selectedDispatch.centre} · ${selectedDispatch.reference}` : '');
  const caseOptions =
    selectedCase && !cases.data?.some((c) => c.id === selectedCase.id)
      ? [selectedCase, ...(cases.data ?? [])]
      : (cases.data ?? []);
  const skillText = skills.join(', ');
  const startsAt = starts ? new Date(`${starts}T00:00:00`) : null;
  const dueAt = new Date(`${due}T23:59:59.999`);
  const dateOrderValid =
    dueAt.getTime() > Date.now() && (!startsAt || startsAt.getTime() < dueAt.getTime());
  const eligibleWindow = !!selectedCase && dateOrderValid && skillText.length <= 100;
  const candidates = useQuery({
    queryKey: ['volunteer-candidates', data.country, selectedCase?.id, selectedDispatch?.id, starts, due, skillText],
    queryFn: () =>
      get<Candidate[]>(
        `/volunteer-tasks/candidates?${new URLSearchParams({
          requestId: selectedCase!.id,
          ...(selectedDispatch && { dispatchId: selectedDispatch.id }),
          ...(startsAt && { startsAt: startsAt.toISOString() }),
          dueAt: dueAt.toISOString(),
          skill: skillText,
        })}`,
      ),
    enabled: eligibleWindow && step > 0 && (!deliveryAssignment || !!selectedDispatch),
    staleTime: 0,
  });
  const match = candidates.data?.find((candidate) => candidate.id === volunteer);
  const matchedProfile = match && data.profiles.find((profile) => profile.id === match.id);
  const preferred = data.profiles.find((profile) => profile.id === preferredVolunteer);
  const registerTaskVolunteer = selectedCase && (!selectedCase.requiresCentreHandover || selectedDispatch)
    ? coordinationPath('register-task', { case: selectedCase.id, ...(selectedDispatch && { dispatch: selectedDispatch.id }) })
    : null;
  const availableSkills = rosterSkills(
    data.profiles.filter((p) => selectedCase?.organisationId === p.organisationId),
  );
  const assign = useVolunteerWrite<VolunteerTask, AssignmentInput>('/volunteer-tasks');
  const suggestion = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ draft: { text: string; source: string } | null }>(
          '/volunteer-tasks/skill-suggestion',
          { requestId: selectedCase!.id, title: assignmentTitle },
        )
      ).data,
  });
  useEffect(() => {
    if (step > 0) activeStep.current?.focus();
  }, [step]);

  function changeStep(value: number) {
    setValidation('');
    setStep(value);
  }

  const scheduling = (
    <div className="vc-form-grid">
      <Field label="Start date" hint="Leave blank for an immediate assignment.">
        <DateInput type="date" value={starts} onChange={(e) => setStarts(e.target.value)} />
      </Field>
      <Field
        label="Due date"
        hint="Due by the end of the selected day."
        error={due && !dateOrderValid ? dueDateError : undefined}
      >
        <DateInput
          type="date"
          required
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </Field>
    </div>
  );
  const skillOptions = (
    <fieldset className="vc-fieldset">
      <legend>Required skills</legend>
      {availableSkills.length ? (
        <div className="vc-chips">
          {availableSkills.map((skill) => (
            <label key={skill} className="vc-skill-check">
              <input
                type="checkbox"
                checked={skills.includes(skill)}
                onChange={(event) =>
                  setSkills(
                    event.target.checked ? [...skills, skill] : skills.filter((s) => s !== skill),
                  )
                }
              />{' '}
              {skill}
            </label>
          ))}
        </div>
      ) : (
        <p className="muted">No skills are recorded for this organisation.</p>
      )}
      {skillText.length > 100 && (
        <p className="field-error" role="alert">
          Select a shorter set of skills. The combined names can contain up to 100 characters.
        </p>
      )}
    </fieldset>
  );
  const selection = selectedCase && (
    <div className="vc-inset">
      <div className="vc-panel-heading">
        <div>
          <strong>
            {selectedCase.reference} · {selectedCase.locationText}
          </strong>
          <p className="muted">{selectedCase.crisis}</p>
        </div>
        <Badge value={selectedCase.priority} />
      </div>
      <dl className="vc-data-list">
        <div>
          <dt>Category</dt>
          <dd>
            <Badge value={selectedCase.category} />
          </dd>
        </div>
        <div>
          <dt>Outstanding assistance</dt>
          <dd>
            {selectedCase.requiresCentreHandover
              ? selectedDispatch ? `${selectedDispatch.reference} · Collect from ${selectedDispatch.centre}` : 'Select a dispatch received at the centre.'
              : `${selectedCase.outstandingQuantity} ${selectedCase.unit ?? ''}`}
          </dd>
        </div>
      </dl>
      {selectedCase.description && <p className="vc-preserve-lines">{selectedCase.description}</p>}
    </div>
  );
  return (
    <div className="vc-page">
      <ol className="vc-steps" aria-label="Assignment steps">
        {assignmentSteps.map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? 'step' : undefined}
            data-state={index < step ? 'complete' : index === step ? 'active' : 'upcoming'}
          >
            <span>{index < step ? <Check size={16} aria-label="Complete" /> : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <div ref={activeStep} tabIndex={-1} className="vc-stage">
        <VolunteerPanel title={assignmentSteps[step]}>
          <form
            className="vc-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (assign.isPending) return;
              if (!selectedCase) {
                setValidation('Choose an eligible case.');
                return;
              }
              if (selectedCase.requiresCentreHandover && !selectedDispatch) {
                setValidation('Select a dispatch available for volunteer handover.');
                return;
              }
              if (step === 0) {
                changeStep(1);
                return;
              }
              if (!eligibleWindow) {
                setValidation(dateOrderValid ? 'Check the required skills.' : dueDateError);
                return;
              }
              if (!matchedProfile || candidates.isFetching || candidates.error) {
                setValidation('Choose a volunteer eligible for this case and schedule.');
                return;
              }
              if (step >= 2 && !assignmentTitle) {
                setValidation('Enter a task title.');
                return;
              }
              if (step < reviewStep) {
                changeStep(step + 1);
                return;
              }
              assign.mutate(
                {
                  requestId: selectedCase.id,
                  volunteerId: matchedProfile.id,
                  title: assignmentTitle,
                  requiredSkill: skillText,
                  startsAt: startsAt?.toISOString() ?? null,
                  dueAt: dueAt.toISOString(),
                  instructions: instructions.trim(),
                  caseDispatchId: selectedDispatch?.id,
                },
                {
                  onSuccess: (task) =>
                    navigate(coordinationPath('deployments', { status: 'open', task: task.id }), {
                      state: { success: 'Assignment created.' },
                    }),
                },
              );
            }}
          >
            {step === 0 && (
              <>
                <div className="vc-form-grid">
                  <Field label="Search cases">
                    <input
                      type="search"
                      placeholder="Reference, category, location, crisis or description"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Case"
                    hint={
                      criteria.pending || cases.isFetching
                        ? 'Searching cases…'
                        : cases.data?.length === 20
                          ? 'Showing up to 20 cases. Narrow your search to find more.'
                          : undefined
                    }
                  >
                    <select
                      value={selectedCase?.id ?? ''}
                      disabled={criteria.pending || cases.isFetching || !!cases.error}
                      onChange={(e) => {
                        setChosenCase(caseOptions.find((c) => c.id === e.target.value));
                        setDispatchId('');
                        setVolunteer(preferredVolunteer ?? '');
                        setSkills([]);
                        setValidation('');
                      }}
                    >
                      {!selectedCase && <option value="">Select a case</option>}
                      {caseOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.reference} · {c.locationText}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                {selectedCase?.requiresCentreHandover && <>
                  {dispatches.isPending ? <Loading /> : dispatches.error
                    ? <ErrorState error={dispatches.error} retry={() => void dispatches.refetch()} />
                    : <Field label="Centre dispatch">
                      <select value={selectedDispatch?.id ?? ''} required onChange={event => {
                        setDispatchId(event.target.value);
                      }}>
                        <option value="">Choose a dispatch</option>
                        {availableDispatches.map(dispatch => <option key={dispatch.id} value={dispatch.id}>
                          {dispatch.reference} · {dispatch.centre}
                        </option>)}
                      </select>
                    </Field>}
                  {dispatches.isSuccess && !availableDispatches.length && <p role="status" className="muted">
                    {dispatches.data.dispatches.some(dispatch => dispatch.volunteerStatus)
                      ? 'A volunteer is already handling this delivery. Check its progress under Active Deployments or Report Verification.'
                      : 'No dispatch is ready for a volunteer. The receiving centre must record the items it received first.'}
                  </p>}
                  {dispatchId && !selectedDispatch && availableDispatches.length > 0 && <p role="status" className="muted">
                    The linked dispatch is no longer available. Choose a received dispatch to continue.
                  </p>}
                </>}
                {cases.error && (
                  <ErrorState error={cases.error} retry={() => void cases.refetch()} />
                )}
                {linkedCase.error && (
                  <ErrorState error={linkedCase.error} retry={() => void linkedCase.refetch()} />
                )}
                {initialCase && linkedCase.data?.length === 0 && !chosenCase && (
                  <p className="field-error" role="status">
                    The linked case is no longer eligible. You can select another case.
                  </p>
                )}
                {cases.isSuccess && !caseOptions.length && (
                  <p className="muted">No selectable cases in these results.</p>
                )}
                {selection}
              </>
            )}
            {step === 1 && (
              <>
                <p className="muted">
                  {deliveryAssignment ? 'Set the delivery deadline, then choose an eligible volunteer.'
                    : 'Set the skills and dates to match verified volunteers in the case’s organisation and service area.'}
                </p>
                {registerTaskVolunteer && <Link className="vc-text-link" to={registerTaskVolunteer}>
                  Register a volunteer for this task
                </Link>}
                {scheduling}
                {skillOptions}
                {deliveryAssignment && <Field label="Delivery instructions (optional)">
                  <textarea value={instructions} maxLength={2000} onChange={e => setInstructions(e.target.value)}
                    placeholder="Pickup contact, meeting point or delivery instructions" />
                </Field>}
                {preferred && (
                  <p className="muted">Requested volunteer · {volunteerName(data, preferred)}</p>
                )}
                {candidates.isFetching && <Loading />}
                {candidates.error && (
                  <ErrorState error={candidates.error} retry={() => void candidates.refetch()} />
                )}
                {candidates.isSuccess && !candidates.data.length && (
                  <Empty
                    title="No eligible volunteers"
                    description="Try a different skill or date range, or register someone for this task."
                  />
                )}
                {!!candidates.data?.length && (
                  <fieldset className="vc-fieldset">
                    <legend>{deliveryAssignment ? 'Choose an eligible volunteer' : 'Eligible volunteers'}</legend>
                    {candidates.data.map((candidate) => {
                      const profile = data.profiles.find((p) => p.id === candidate.id);
                      if (!profile) return null;
                      return (
                        <label
                          className="vc-candidate"
                          key={candidate.id}
                          data-selected={candidate.id === volunteer}
                        >
                          <input
                            type="radio"
                            name="volunteer"
                            value={candidate.id}
                            checked={candidate.id === volunteer}
                            onChange={(e) => {
                              setVolunteer(e.target.value);
                              setValidation('');
                            }}
                          />
                          <span>
                            <strong>{volunteerName(data, profile)}</strong>
                            <small>
                              {candidate.skills} · {candidate.availability}
                            </small>
                            <small>{candidate.explanation}</small>
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                )}
              </>
            )}
            {step === 2 && !deliveryAssignment && (
              <>
                <div className="vc-inset">
                  <strong>{selectedCase?.reference}</strong> ·{' '}
                  {matchedProfile
                    ? volunteerName(data, matchedProfile)
                    : 'Volunteer match needs review'}
                </div>
                <Field label="Task title">
                  <input
                    required
                    value={title || assignmentTitle}
                    maxLength={200}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      suggestion.reset();
                    }}
                  />
                </Field>
                {skillOptions}
                <div className="vc-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    busy={suggestion.isPending}
                    disabled={!assignmentTitle || !selectedCase}
                    onClick={() => suggestion.mutate()}
                  >
                    Suggest a skill
                  </Button>
                  {suggestion.data?.draft && (
                    <>
                      <span className="muted">
                        {suggestion.data.draft.text} · {suggestion.data.draft.source}
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          const skill = suggestion.data?.draft?.text;
                          if (skill && !skills.some((s) => s.toLowerCase() === skill.toLowerCase()))
                            setSkills([...skills, skill]);
                          suggestion.reset();
                        }}
                      >
                        Use suggestion
                      </Button>
                    </>
                  )}
                  {suggestion.isSuccess && !suggestion.data.draft && (
                    <span role="status">No roster skill suggestion found.</span>
                  )}
                </div>
                {suggestion.error && (
                  <p className="field-error" role="alert">
                    {errorMessage(suggestion.error)}
                  </p>
                )}
                {scheduling}
                {candidates.isFetching && <Loading />}
                {candidates.error && (
                  <ErrorState error={candidates.error} retry={() => void candidates.refetch()} />
                )}
                {eligibleWindow && candidates.isSuccess && !match && (
                  <p role="status" className="field-error">
                    The volunteer no longer matches this window or skills. Go back to choose an
                    eligible volunteer.
                  </p>
                )}
                <Field label="Instructions">
                  <textarea
                    value={instructions}
                    maxLength={2000}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="Work to perform, meeting point and safety instructions"
                  />
                </Field>
              </>
            )}
            {step === reviewStep && (
              <>
                {selection}
                <dl className="vc-data-list">
                  <div>
                    <dt>Task title</dt>
                    <dd>{assignmentTitle}</dd>
                  </div>
                  <div>
                    <dt>Volunteer</dt>
                    <dd>{volunteerName(data, matchedProfile)}</dd>
                  </div>
                  <div>
                    <dt>Required skills</dt>
                    <dd>{skillText || 'Any skill'}</dd>
                  </div>
                  <div>
                    <dt>Start</dt>
                    <dd>{starts ? calendarDate.format(new Date(starts)) : 'Immediately'}</dd>
                  </div>
                  <div>
                    <dt>Due</dt>
                    <dd>{calendarDate.format(new Date(due))}</dd>
                  </div>
                  {instructions.trim() && (
                    <div>
                      <dt>Instructions</dt>
                      <dd className="vc-preserve-lines">{instructions.trim()}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Initial status</dt>
                    <dd>
                      <VolunteerPill>Assigned</VolunteerPill>
                    </dd>
                  </div>
                </dl>
                {assign.error && (
                  <p className="field-error" role="alert">
                    {errorMessage(assign.error)}
                  </p>
                )}
              </>
            )}
            {validation && (
              <p className="field-error" role="alert">
                {validation}
              </p>
            )}
            <div className="vc-actions vc-form-footer">
              {step > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={assign.isPending}
                  onClick={() => changeStep(step - 1)}
                >
                  <ArrowLeft size={17} /> Back
                </Button>
              )}
              <Link className="button secondary" to={coordinationPath('directory')}>
                Cancel
              </Link>
              <Button
                busy={assign.isPending}
                disabled={
                  step === 0
                    ? !selectedCase || deliveryAssignment && !selectedDispatch || criteria.pending || cases.isFetching || !!cases.error
                    : !eligibleWindow ||
                      !matchedProfile ||
                      candidates.isFetching ||
                      !!candidates.error
                }
              >
                {step === reviewStep ? 'Confirm assignment' : 'Continue'}{' '}
                {step < reviewStep && <ArrowRight size={17} aria-hidden="true" />}
              </Button>
            </div>
          </form>
        </VolunteerPanel>
      </div>
    </div>
  );
}
