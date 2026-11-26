import { ChevronRight, FileCheck2, Radio } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from './auth';
import { errorMessage } from './api';
import { Button, Empty, ErrorState, Field, formatDate, Loading } from './components';
import type { VolunteerData, VolunteerTask } from './types';
import { useVolunteerDispatch } from './CaseDispatches';
import { unitSymbol } from './quantity';
import {
  useVolunteerPagination,
  VolunteerMetrics,
  VolunteerPanel,
  VolunteerPill,
  VolunteerTable,
} from './VolunteerCoordinatorUi';
import {
  coordinationPath,
  taskReference,
  useVolunteerWrite,
  volunteerEventLabels,
  volunteerName,
} from './volunteerWorkspace';
import type { VolunteerWorkspaceData } from './volunteerWorkspace';

type TaskEvent = NonNullable<VolunteerData['history']>[number];

const statusLabels: Record<VolunteerTask['status'], string> = {
  Assigned: 'Assigned',
  Accepted: 'Accepted',
  InProgress: 'In progress',
  AwaitingVerification: 'Awaiting verification',
  Completed: 'Completed',
  Declined: 'Declined',
  Returned: 'Returned for correction',
};

function TaskStatus({ status }: { status: VolunteerTask['status'] }) {
  return (
    <VolunteerPill
      tone={
        status === 'Completed'
          ? 'green'
          : status === 'AwaitingVerification' || status === 'Returned'
            ? 'amber'
            : status === 'Declined'
              ? 'neutral'
              : 'blue'
      }
    >
      {statusLabels[status]}
    </VolunteerPill>
  );
}

export function VolunteerDeployments({ data }: { data: VolunteerWorkspaceData }) {
  const [params, setParams] = useSearchParams();
  const rawStatus =
    params.get('status') ??
    ({ open: 'open', overdue: 'overdue' } as Record<string, string>)[params.get('view') ?? ''];
  const status = rawStatus ?? 'InProgress';
  const search = params.get('search') ?? '';
  const volunteer = data.profiles.find((p) => p.id === params.get('volunteer'));
  const taskId = params.get('task');
  const detail = data.tasks.find((t) => t.id === taskId);
  const rows = data.tasks.filter((task) => {
    const linkedCase = data.cases[task.requestId];
    return (
      (status === 'all' ||
        (status === 'overdue' && data.overdue.includes(task.id)) ||
        (status === 'open' && !['Completed', 'Declined'].includes(task.status)) ||
        task.status === status) &&
      (!volunteer || task.volunteerId === volunteer.id) &&
      [
        task.id,
        task.title,
        linkedCase?.reference,
        linkedCase?.locationText,
        linkedCase?.crisis,
        volunteerName(
          data,
          data.profiles.find((p) => p.id === task.volunteerId),
        ),
      ].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase()))
    );
  });
  const page = useVolunteerPagination(rows);
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set('view', 'deployments');
    next.set('status', status);
    next.delete('task');
    if (value) next.set(key, value);
    else next.delete(key);
    page.reset();
    setParams(next, { replace: true });
  }
  function taskLink(id?: string) {
    return coordinationPath('deployments', {
      status,
      ...(search ? { search } : {}),
      ...(volunteer ? { volunteer: volunteer.id } : {}),
      ...(id ? { task: id } : {}),
    });
  }
  return (
    <>
      <VolunteerMetrics data={data} keys={['deployments', 'open', 'overdue', 'reports']} />
      {detail && (
        <VolunteerPanel
          title={detail.title}
          description={`Assignment ${taskReference(detail.id)}`}
          action={
            <Link className="button secondary" to={taskLink()}>
              Back to deployment list
            </Link>
          }
        >
          <VolunteerTaskDetails data={data} task={detail} />
          <div className="vc-actions">
            {detail.status === 'AwaitingVerification' && (
              <Link
                className="button primary"
                to={coordinationPath('reports', { task: detail.id })}
              >
                Review report
              </Link>
            )}
            <Link
              className="button secondary"
              to={coordinationPath('manage', { volunteer: detail.volunteerId, mode: 'view' })}
            >
              View volunteer
            </Link>
          </div>
        </VolunteerPanel>
      )}
      {taskId && !detail && (
        <Empty
          title="Assignment unavailable"
          action={<Link to={taskLink()}>Return to the list</Link>}
        />
      )}
      {!detail && (
        <VolunteerPanel
          title="Deployment tracker"
          description={
            volunteer
              ? `Assignments for ${volunteerName(data, volunteer)}`
              : 'Track assignments, milestones and due dates.'
          }
          action={
            volunteer && (
              <Link className="button secondary" to={coordinationPath('deployments', { status })}>
                Clear volunteer filter
              </Link>
            )
          }
        >
          <div className="vc-filters vc-task-filters">
            <Field label="Search deployments">
              <input
                type="search"
                placeholder="Task, case, location or volunteer"
                value={search}
                onChange={(e) => update('search', e.target.value)}
              />
            </Field>
            <Field label="Deployment status">
              <select value={status} onChange={(e) => update('status', e.target.value)}>
                <option value="all">All assignments</option>
                <option value="open">Open assignments</option>
                <option value="overdue">Overdue tasks</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {page.rows.length ? (
            <VolunteerTable label="Deployment tracker results">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Case / location</th>
                  <th>Volunteer</th>
                  <th>Start</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((task) => {
                  const linkedCase = data.cases[task.requestId];
                  return (
                    <tr key={task.id}>
                      <td>
                        <strong>{task.title}</strong>
                        <small>{taskReference(task.id)}</small>
                      </td>
                      <td>
                        {linkedCase?.reference ?? 'Case unavailable'}
                        <small>{linkedCase?.crisis}</small>
                        <small>{linkedCase?.locationText}</small>
                      </td>
                      <td>
                        {volunteerName(
                          data,
                          data.profiles.find((p) => p.id === task.volunteerId),
                        )}
                      </td>
                      <td>{task.startsAt ? formatDate(task.startsAt) : 'Unscheduled'}</td>
                      <td>{formatDate(task.dueAt)}</td>
                      <td>
                        <div className="vc-chips">
                          <TaskStatus status={task.status} />
                          {data.overdue.includes(task.id) && (
                            <VolunteerPill tone="red">Overdue</VolunteerPill>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="vc-row-actions">
                          <Link to={taskLink(task.id)}>View details</Link>
                          {task.status === 'AwaitingVerification' && (
                            <Link to={coordinationPath('reports', { task: task.id })}>
                              Review report
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
              title={
                status === 'InProgress' && !search && !volunteer
                  ? 'No active deployments'
                  : 'No assignments match these filters'
              }
              action={
                status === 'InProgress' ? (
                  <Link
                    className="button secondary"
                    to={coordinationPath('deployments', {
                      status: 'open',
                      ...(volunteer && { volunteer: volunteer.id }),
                    })}
                  >
                    View open assignments
                  </Link>
                ) : undefined
              }
            />
          )}
          {page.pagination}
        </VolunteerPanel>
      )}
    </>
  );
}

function AssignmentDetails({ data, task }: { data: VolunteerWorkspaceData; task: VolunteerTask }) {
  const linkedCase = data.cases[task.requestId];
  const profile = data.profiles.find((p) => p.id === task.volunteerId);
  return (
    <dl className="vc-data-list">
      <div>
        <dt>Assignment</dt>
        <dd>{taskReference(task.id)}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>
          <TaskStatus status={task.status} />{' '}
          {data.overdue.includes(task.id) && <VolunteerPill tone="red">Overdue</VolunteerPill>}
        </dd>
      </div>
      <div>
        <dt>Volunteer</dt>
        <dd>
          {profile ? (
            <Link
              className="vc-text-link"
              to={coordinationPath('manage', { volunteer: profile.id, mode: 'view' })}
            >
              {volunteerName(data, profile)}
            </Link>
          ) : (
            'Volunteer unavailable'
          )}
        </dd>
      </div>
      <div>
        <dt>Related case</dt>
        <dd>
          {linkedCase?.reference ?? 'Case unavailable'}
          {linkedCase?.crisis && ` · ${linkedCase.crisis}`}
        </dd>
      </div>
      <div>
        <dt>Location</dt>
        <dd>{linkedCase?.locationText ?? 'Location unavailable'}</dd>
      </div>
      <div>
        <dt>Required skills</dt>
        <dd>{task.requiredSkill || 'Any skill'}</dd>
      </div>
      <div>
        <dt>Scheduled start</dt>
        <dd>{task.startsAt ? formatDate(task.startsAt) : 'Unscheduled'}</dd>
      </div>
      <div>
        <dt>Due</dt>
        <dd>{formatDate(task.dueAt)}</dd>
      </div>
      {task.instructions && (
        <div>
          <dt>Instructions</dt>
          <dd className="vc-preserve-lines">{task.instructions}</dd>
        </div>
      )}
    </dl>
  );
}

function ReportDetails({ report }: { report: TaskEvent }) {
  return (
    <dl className="vc-data-list">
      <div>
        <dt>Submitted</dt>
        <dd>{formatDate(report.createdAt)}</dd>
      </div>
      <div>
        <dt>Work completed</dt>
        <dd className="vc-preserve-lines">{report.workDescription || 'None recorded'}</dd>
      </div>
      {report.outcome !== report.workDescription && <div>
        <dt>Reported outcome</dt>
        <dd className="vc-preserve-lines">{report.outcome || 'None recorded'}</dd>
      </div>}
      {report.peopleAssisted != null && (
        <div>
          <dt>People assisted</dt>
          <dd>{report.peopleAssisted.toLocaleString()}</dd>
        </div>
      )}
      {report.issues && (
        <div>
          <dt>Issues</dt>
          <dd className="vc-preserve-lines">{report.issues}</dd>
        </div>
      )}
      {report.note && (
        <div>
          <dt>Completion notes</dt>
          <dd className="vc-preserve-lines">{report.note}</dd>
        </div>
      )}
    </dl>
  );
}

function taskHistory(data: VolunteerWorkspaceData, task: VolunteerTask) {
  return (data.history ?? [])
    .filter((e) => e.taskId === task.id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function TaskHistory({ data, history }: { data: VolunteerWorkspaceData; history: TaskEvent[] }) {
  return history.length ? (
    <ol className="vc-activity-list">
      {history.map((event) => (
        <li key={event.id}>
          <span className="vc-metric-icon">
            {event.action === 'Complete' ? (
              <FileCheck2 size={17} aria-hidden="true" />
            ) : (
              <Radio size={17} aria-hidden="true" />
            )}
          </span>
          <div>
            <strong>{volunteerEventLabels[event.action] ?? event.action}</strong>
            <small>
              {formatDate(event.createdAt)}
              {event.actorId && data.names[event.actorId] ? ` · ${data.names[event.actorId]}` : ''}
            </small>
            {event.action === 'Complete' ? (
              <details>
                <summary>Read submitted report</summary>
                <ReportDetails report={event} />
              </details>
            ) : (
              event.note && <p className="vc-preserve-lines">{event.note}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  ) : (
    <p className="muted">No task history has been recorded.</p>
  );
}

function VolunteerTaskDetails({
  data,
  task,
}: {
  data: VolunteerWorkspaceData;
  task: VolunteerTask;
}) {
  return (
    <div className="vc-form-grid">
      <div className="vc-inset">
        <h3>Assignment details</h3>
        <AssignmentDetails data={data} task={task} />
      </div>
      <div className="vc-inset">
        <h3>Activity, progress and reports</h3>
        <TaskHistory data={data} history={taskHistory(data, task)} />
      </div>
    </div>
  );
}

export function VolunteerReports({ data }: { data: VolunteerWorkspaceData }) {
  const [params] = useSearchParams();
  const selected = params.get('task');
  const waiting = data.tasks
    .filter((task) => task.status === 'AwaitingVerification')
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  const past = data.tasks
    .filter((task) => task.status === 'Completed' || task.status === 'Returned')
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const task = selected ? [...waiting, ...past].find((t) => t.id === selected) : waiting[0];
  const queue = useVolunteerPagination(waiting);
  const reviews = useVolunteerPagination(past, 6);
  return (
    <>
      <VolunteerMetrics data={data} keys={['reports', 'available', 'deployments', 'overdue']} />
      <div className="vc-report-grid">
        <div className="vc-page">
          <VolunteerPanel title="Reports awaiting verification">
            {queue.rows.length ? (
              <ul className="vc-queue">
                {queue.rows.map((t) => {
                  const report = taskHistory(data, t).find((e) => e.action === 'Complete');
                  return (
                    <li key={t.id}>
                      <Link
                        to={coordinationPath('reports', { task: t.id })}
                        aria-current={t.id === task?.id ? 'true' : undefined}
                      >
                        <span>
                          <strong>{t.title}</strong>
                          <small>
                            {taskReference(t.id)} · {data.cases[t.requestId]?.reference}
                          </small>
                          <small>
                            {volunteerName(
                              data,
                              data.profiles.find((p) => p.id === t.volunteerId),
                            )}
                          </small>
                          <small>
                            {report
                              ? formatDate(report.createdAt)
                              : 'Submission details unavailable'}
                          </small>
                        </span>
                        <ChevronRight size={19} aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty title="No reports awaiting verification" />
            )}
            {queue.pagination}
          </VolunteerPanel>
          {past.length > 0 && (
            <VolunteerPanel title="Previously reviewed">
              <ul className="vc-queue">
                {reviews.rows.map((t) => (
                  <li key={t.id}>
                    <Link
                      to={coordinationPath('reports', { task: t.id })}
                      aria-current={t.id === task?.id ? 'true' : undefined}
                    >
                      <span>
                        <strong>{t.title}</strong>
                        <small>{taskReference(t.id)}</small>
                      </span>
                      <TaskStatus status={t.status} />
                    </Link>
                  </li>
                ))}
              </ul>
              {reviews.pagination}
            </VolunteerPanel>
          )}
        </div>
        {task ? (
          <ReportReview key={task.id} task={task} data={data} />
        ) : (
          <VolunteerPanel title="Report details">
            <Empty
              title={selected ? 'Report unavailable' : 'No report selected'}
              description="Submitted or previously reviewed reports can be opened here."
            />
          </VolunteerPanel>
        )}
      </div>
    </>
  );
}

function ReportReview({ data, task }: { data: VolunteerWorkspaceData; task: VolunteerTask }) {
  const { user } = useAuth();
  const [, setParams] = useSearchParams();
  const history = taskHistory(data, task);
  const report = history.find((e) => e.action === 'Complete');
  const dispatch = useVolunteerDispatch(task.id, !!task.caseDispatchId, true);
  const handoverReport = dispatch.data?.items.filter(item => item.reportedQuantity != null);
  const canVerify = !!report && (!task.caseDispatchId || !!handoverReport?.length);
  const profile = data.profiles.find((p) => p.id === task.volunteerId);
  const linkedCase = data.cases[task.requestId];
  const canReview = task.status === 'AwaitingVerification' && user?.id !== profile?.userId;
  const review = useVolunteerWrite<
    VolunteerTask,
    { id: string; action: 'Verify' | 'Return'; note: string }
  >((input) => `/volunteer-tasks/${input.id}`);
  return (
    <VolunteerPanel
      title={task.title}
      description={`Assignment ${taskReference(task.id)}${linkedCase ? ` · ${linkedCase.reference}` : ''}`}
      action={<TaskStatus status={task.status} />}
    >
      <div className="vc-form">
        <div className="vc-inset">
          <h3>Submitted report</h3>
          <p className="muted">
            {volunteerName(data, profile)}
            {linkedCase && ` · ${linkedCase.locationText}`}
          </p>
          {report ? (
            <ReportDetails report={report} />
          ) : (
            <p className="muted">
              The report details are unavailable. Return it to request a completion report.
            </p>
          )}
          {task.caseDispatchId && (dispatch.isPending ? <Loading /> : dispatch.error
            ? <ErrorState error={dispatch.error} retry={() => void dispatch.refetch()} />
            : dispatch.data && <div>
              <h4>{dispatch.data.reference} · {dispatch.data.centre}</h4>
              <VolunteerTable label="Dispatch and handover quantities">
                <thead><tr><th scope="col">Item</th><th scope="col">Sent</th>
                  <th scope="col">Received at centre</th><th scope="col">Reported handed to citizen</th></tr></thead>
                <tbody>{dispatch.data.items.map(item => {
                  const quantity = (value: number | null | undefined) =>
                    value == null ? '—' : `${value} ${unitSymbol(item.unit)}`;
                  return <tr key={item.id}><th scope="row">{item.name}</th>
                    <td>{quantity(item.sent)}</td><td>{quantity(item.atCentre)}</td>
                    <td>{quantity(item.reportedQuantity)}</td></tr>;
                })}</tbody>
              </VolunteerTable>
              {!handoverReport?.length && <p className="muted">This report has no handover quantities.</p>}
            </div>)}
        </div>
        {canReview && (
          <form
            className="vc-form vc-review-form"
            onSubmit={(event) => {
              event.preventDefault();
              const action = (
                (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
              )?.value;
              if (
                review.isPending ||
                (action !== 'Verify' && action !== 'Return') ||
                (action === 'Verify' && !canVerify)
              )
                return;
              const notes = String(new FormData(event.currentTarget).get('notes') ?? '').trim();
              if (notes.length < 5) {
                const input = event.currentTarget.elements.namedItem(
                  'notes',
                ) as HTMLTextAreaElement;
                input.setCustomValidity('Enter at least five characters describing your decision.');
                input.reportValidity();
                return;
              }
              setParams(
                new URLSearchParams({
                  role: 'VolunteerCoordinator',
                  view: 'reports',
                  task: task.id,
                }),
                { replace: true },
              );
              review.mutate({ id: task.id, action, note: notes });
            }}
          >
            <Field
              label="Verification notes"
              hint="Record what you verified or what the volunteer needs to correct."
            >
              <textarea
                name="notes"
                minLength={5}
                maxLength={2000}
                required
                onChange={(e) => {
                  e.target.setCustomValidity('');
                  if (review.isError) review.reset();
                }}
              />
            </Field>
            <div className="vc-actions">
              <Button value="Verify" busy={review.isPending} disabled={!canVerify}>
                <FileCheck2 size={18} /> Verify report
              </Button>
              <Button value="Return" variant="secondary" busy={review.isPending}>
                Return for correction
              </Button>
            </div>
          </form>
        )}
        <details className="vc-inset">
          <summary>Assignment details</summary>
          <AssignmentDetails data={data} task={task} />
        </details>
        {review.error && (
          <p className="field-error" role="alert">
            {errorMessage(review.error)}
          </p>
        )}
        {review.isSuccess && (
          <p className="success-text" role="status">
            {review.variables.action === 'Verify'
              ? 'Report verified.'
              : 'Report returned for correction.'}
          </p>
        )}
        <details className="vc-inset">
          <summary>Task and review history</summary>
          <TaskHistory data={data} history={history} />
        </details>
      </div>
    </VolunteerPanel>
  );
}
