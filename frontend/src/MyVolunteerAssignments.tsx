import { useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import {
  Accessibility,
  ArrowRight,
  CalendarDays,
  Check,
  CircleCheck,
  ClipboardList,
  Cross,
  HeartHandshake,
  Hourglass,
  MapPin,
  Package,
  Tent,
  Truck,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, get } from './api';
import { useAuth } from './auth';
import {
  Button,
  Card,
  Empty,
  ErrorState,
  Field,
  formatDate,
  IconTile,
  Loading,
} from './components';
import { WorkspaceDialog } from './OrganisationDialog';
import { volunteerEventLabels, volunteerTaskLabels } from './volunteerWorkspace';
import type { Category, VolunteerData, VolunteerTask } from './types';
import { useVolunteerDispatch } from './CaseDispatches';
import { isMeasuredUnit, unitSymbol } from './quantity';

interface Assignment {
  task: VolunteerTask;
  category: Category;
  locationText: string;
  crisis: string;
}

interface VolunteerAssignments {
  assignments: Assignment[];
  verified: boolean;
  hasProfile: boolean;
  history: NonNullable<VolunteerData['history']>;
}

type Status = VolunteerTask['status'];
type Filter = 'All' | 'InProgress' | 'Completed' | 'AwaitingVerification';
type Sort = 'earliest' | 'latest' | 'recent' | 'status';
type TaskAction = 'Accept' | 'Decline' | 'Start' | 'Progress' | 'Complete';
type TaskUpdate = {
  action: TaskAction;
  note?: string;
  workDescription?: string;
  outcome?: string;
  peopleAssisted?: number | null;
  issues?: string;
  handoverQuantities?: { allocationId: string; quantity: number }[];
};

const filters: { key: Filter; label: string }[] = [
  { key: 'All', label: 'All' },
  { key: 'InProgress', label: 'In progress' },
  { key: 'Completed', label: 'Completed' },
  { key: 'AwaitingVerification', label: 'Awaiting verification' },
];
const statusOrder: Status[] = [
  'Assigned',
  'Accepted',
  'InProgress',
  'Returned',
  'AwaitingVerification',
  'Completed',
  'Declined',
];
const deliveryActions: Partial<Record<Status, string>> = {
  Assigned: 'Review assignment',
  Accepted: 'Open delivery',
  InProgress: 'Record handover',
  AwaitingVerification: 'View submitted report',
  Returned: 'Correct report',
  Completed: 'View handover',
};
const categoryIcons = {
  FoodWater: Package,
  Medical: Cross,
  Shelter: Tent,
  Transportation: Truck,
  Accessibility,
  Other: HeartHandshake,
};

function compareAssignments(a: Assignment, b: Assignment, sort: Sort) {
  const due = Date.parse(a.task.dueAt) - Date.parse(b.task.dueAt);
  switch (sort) {
    case 'latest':
      return -due;
    case 'recent':
      return Date.parse(b.task.createdAt) - Date.parse(a.task.createdAt) || due;
    case 'status':
      return statusOrder.indexOf(a.task.status) - statusOrder.indexOf(b.task.status) || due;
    default:
      return due;
  }
}

function overdue(task: VolunteerTask) {
  return (
    !['Completed', 'Declined', 'AwaitingVerification'].includes(task.status) &&
    Date.parse(task.dueAt) < Date.now()
  );
}

function statusTone(status: Status) {
  if (status === 'Completed') return 'green';
  if (status === 'InProgress') return 'purple';
  if (status === 'Returned' || status === 'Declined') return 'red';
  return 'blue';
}

function TaskStatus({ task }: { task: VolunteerTask }) {
  const { t } = useTranslation();
  return (
    <div className="volunteer-statuses">
      <span className="volunteer-chip" data-tone={statusTone(task.status)}>
        {task.status === 'Completed' && <Check size={14} aria-hidden="true" />}
        {task.caseDispatchId ? volunteerTaskLabels[task.status] : t('status.' + task.status, {
          defaultValue: task.status.replace(/([a-z])([A-Z])/g, '$1 $2'),
        })}
      </span>
      {overdue(task) && (
        <span className="volunteer-chip" data-tone="red">
          Overdue
        </span>
      )}
    </div>
  );
}

export function VolunteerHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="volunteer-heading">
      <div className="volunteer-heading-title">
        <IconTile icon={Users} tone="purple" />
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </header>
  );
}

export function VolunteerLoadError({
  error,
  retry,
  item,
}: {
  error: unknown;
  retry: () => void;
  item: string;
}) {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status === 401 || status === 403)
    return (
      <div className="error-state" role="alert">
        You do not have access to {item}. Sign in with your volunteer account or contact your
        coordinator.
      </div>
    );
  return <ErrorState error={error} retry={retry} />;
}

export function useMyVolunteerAssignments(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-volunteer-assignments', user?.id],
    queryFn: () => get<VolunteerAssignments>('/volunteer-tasks/mine'),
    enabled: !!user && enabled,
    refetchInterval: 30000,
  });
}

export default function MyVolunteerAssignments({ initialTaskId }: { initialTaskId?: string } = {}) {
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>('All');
  const [sort, setSort] = useState<Sort>('earliest');
  const [selected, setSelected] = useState(initialTaskId);
  const queryKey = ['my-volunteer-assignments', user?.id];
  const query = useMyVolunteerAssignments();
  const assignments = query.data?.assignments ?? [];
  const counts = { All: assignments.length, InProgress: 0, Completed: 0, AwaitingVerification: 0 };
  for (const { task } of assignments) {
    if (
      task.status === 'InProgress' ||
      task.status === 'Completed' ||
      task.status === 'AwaitingVerification'
    )
      counts[task.status]++;
  }
  const visible = assignments
    .filter(({ task }) => filter === 'All' || task.status === filter)
    .sort((a, b) => compareAssignments(a, b, sort));
  const detail = assignments.find(({ task }) => task.id === selected);

  return (
    <div className="volunteer-self-page">
      <VolunteerHeading
        title="My volunteer assignments"
        description="Open an assignment to see what you need to do next."
      >
        {query.data && !query.error && (
          <dl className="volunteer-metrics">
            {[
              {
                label: 'Total assignments',
                value: counts.All,
                icon: ClipboardList,
                tone: 'purple',
              },
              { label: 'In progress', value: counts.InProgress, icon: Hourglass, tone: 'blue' },
              { label: 'Awaiting review', value: counts.AwaitingVerification, icon: Hourglass, tone: 'blue' },
              { label: 'Completed', value: counts.Completed, icon: CircleCheck, tone: 'green' },
            ].map(({ label, value, icon, tone }) => (
              <div className="volunteer-metric" key={label}>
                <dt>
                  <IconTile icon={icon} tone={tone} />
                  {label}
                </dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </VolunteerHeading>
      {query.error ? (
        <VolunteerLoadError
          error={query.error}
          retry={() => void query.refetch()}
          item="volunteer assignments"
        />
      ) : query.isPending ? (
        <Loading />
      ) : (
        <Card className="volunteer-assignment-panel">
          <div className="volunteer-list-controls">
            <div className="volunteer-filters" role="group" aria-label="Filter assignments">
              {filters.map(({ key, label }) => (
                <button
                  type="button"
                  key={key}
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}
                >
                  {label} ({counts[key]})
                </button>
              ))}
            </div>
            <label className="volunteer-sort">
              <span className="sr-only">Sort assignments</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                <option value="earliest">Sort by: Due date (earliest)</option>
                <option value="latest">Due date (latest)</option>
                <option value="recent">Recently assigned</option>
                <option value="status">Status</option>
              </select>
            </label>
          </div>
          <div className="sr-only" role="status">
            {visible.length} {visible.length === 1 ? 'assignment' : 'assignments'} shown
          </div>
          {visible.length ? (
            <ul className="volunteer-assignment-list">
              {visible.map((assignment) => (
                <AssignmentCard
                  key={assignment.task.id}
                  assignment={assignment}
                  onOpen={() => setSelected(assignment.task.id)}
                />
              ))}
            </ul>
          ) : (
            <Empty
              title={assignments.length ? 'No assignments match this filter' : 'No assignments yet'}
              description={
                query.data.hasProfile
                  ? undefined
                  : 'Your coordinator can help set up your volunteer profile.'
              }
            />
          )}
        </Card>
      )}
      {detail && query.data && !query.error && (
        <AssignmentDetails
          key={detail.task.id}
          assignment={detail}
          history={query.data.history.filter((event) => event.taskId === detail.task.id)}
          verified={query.data.verified}
          anotherTaskInProgress={counts.InProgress > 0 && detail.task.status !== 'InProgress'}
          queryKey={queryKey}
          onClose={() => setSelected(undefined)}
        />
      )}
    </div>
  );
}

function AssignmentCard({ assignment, onOpen }: { assignment: Assignment; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const { task, locationText, category } = assignment;
  const action = (task.caseDispatchId && deliveryActions[task.status]) || 'View details';
  return (
    <li
      className="volunteer-assignment"
      data-tone={overdue(task) ? 'red' : statusTone(task.status)}
    >
      <IconTile icon={categoryIcons[category] ?? HeartHandshake} tone="purple" />
      <div className="volunteer-assignment-info">
        <h2>{task.title}</h2>
        <div className="volunteer-assignment-meta">
          <span>
            <CalendarDays size={16} aria-hidden="true" />{' '}
            <time dateTime={task.dueAt}>Due {formatDate(task.dueAt, i18n.language)}</time>
          </span>
          {!!locationText.trim() && (
            <span>
              <MapPin size={16} aria-hidden="true" />
              {locationText}
            </span>
          )}
          <span className="volunteer-chip" data-tone="blue">
            {t('category.' + category)}
          </span>
        </div>
        {task.instructions?.trim() && <p>{task.instructions}</p>}
      </div>
      <div className="volunteer-assignment-actions">
        <TaskStatus task={task} />
        <Button
          type="button"
          variant="secondary"
          onClick={onOpen}
          aria-label={`${action} for ${task.title}`}
        >
          {action} <ArrowRight size={16} aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

const actionFeedback: Record<TaskAction, string> = {
  Accept: 'Assignment accepted.',
  Decline: 'Assignment declined.',
  Start: 'Assignment started.',
  Progress: 'Progress update posted.',
  Complete: 'Report submitted for coordinator verification.',
};

function AssignmentDetails({
  assignment,
  history,
  verified,
  anotherTaskInProgress,
  queryKey,
  onClose,
}: {
  assignment: Assignment;
  history: NonNullable<VolunteerData['history']>;
  verified: boolean;
  anotherTaskInProgress: boolean;
  queryKey: (string | undefined)[];
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const { task, crisis, locationText, category } = assignment;
  const isDelivery = !!task.caseDispatchId;
  const currentStatus = task.status;
  const submitted = currentStatus === 'AwaitingVerification' || currentStatus === 'Completed';
  const dispatch = useVolunteerDispatch(task.id, !!task.caseDispatchId);
  const pickup = dispatch.data;
  const handoverItems = pickup?.items.filter(item => (item.atCentre ?? 0) > (item.givenToCitizen ?? 0)) ?? [];
  const reportedItems = pickup?.items.filter(item => item.reportedQuantity != null) ?? [];
  const previousReport = currentStatus === 'Returned' ? history.filter(event => event.action === 'Complete').at(-1) : undefined;
  const correction = currentStatus === 'Returned' ? history.filter(event => event.action === 'Return').at(-1)?.note : undefined;
  const pendingQuantity = (item: (typeof handoverItems)[number]) =>
    Number(((item.atCentre ?? 0) - (item.givenToCitizen ?? 0)).toFixed(2));
  const write = useMutation({
    mutationFn: async (input: TaskUpdate) =>
      (await api.post<VolunteerTask>(`/volunteer-tasks/${task.id}`, input)).data,
    onSuccess: async (updated) => {
      client.setQueryData<VolunteerAssignments>(
        queryKey,
        (current) =>
          current && {
            ...current,
            assignments: current.assignments.map((item) =>
              item.task.id === updated.id ? { ...item, task: updated } : item,
            ),
          },
      );
      await Promise.all([
        client.invalidateQueries({ queryKey }),
        client.invalidateQueries({ queryKey: ['volunteer-dispatch'] }),
        client.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
    },
  });
  const canReport = verified && (currentStatus === 'InProgress' || currentStatus === 'Returned');
  const date = (value: string) => formatDate(value, i18n.language);
  const scheduled = !!task.startsAt && Date.parse(task.startsAt) > Date.now();
  const progressForm = verified && currentStatus === 'InProgress' && (
    <form className="stack" onSubmit={event => {
      event.preventDefault();
      if (write.isPending) return;
      const form = event.currentTarget;
      const note = String(new FormData(form).get('note') ?? '').trim();
      write.mutate({ action: 'Progress', note }, { onSuccess: () => form.reset() });
    }}>
      <Field label="Progress update">
        <textarea name="note" required minLength={5} maxLength={2000} disabled={write.isPending} />
      </Field>
      <Button variant="secondary" busy={write.isPending}>Post progress update</Button>
    </form>
  );
  return (
    <WorkspaceDialog
      title={task.title}
      onDismiss={onClose}
      busy={write.isPending}
      className="volunteer-task-dialog"
    >
      <div className="stack">
        <TaskStatus task={task} />
        {currentStatus === 'AwaitingVerification' && <p className="muted">
          Your coordinator will review this report. You can check what you submitted below.
        </p>}
        {correction && <section className="volunteer-task-copy">
          <h3>What to correct</h3><p>{correction}</p>
        </section>}
        {task.caseDispatchId && (dispatch.isPending ? <Loading /> : dispatch.error
          ? <ErrorState error={dispatch.error} retry={() => void dispatch.refetch()} />
          : pickup && <section>
            <h3>{submitted ? 'Reported handover' : currentStatus === 'Declined' ? 'Dispatch details'
              : currentStatus === 'Returned' ? 'Items covered by this report' : `Collect aid from ${pickup.centre}`}</h3>
            <p>{pickup.centreLocation} · {pickup.reference}</p>
            {currentStatus !== 'Declined' && ((submitted ? reportedItems : handoverItems).length > 0
              ? <ul>{(submitted ? reportedItems : handoverItems).map(item => <li key={item.id}>
                {item.name} · {submitted ? item.reportedQuantity : pendingQuantity(item)} {unitSymbol(item.unit)}
              </li>)}</ul> : submitted && <p className="muted">No submitted quantities are recorded.</p>)}
          </section>)}
        <dl className="volunteer-task-facts">
          <div>
            <dt>Crisis</dt>
            <dd>{crisis}</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{t('category.' + category)}</dd>
          </div>
          <div>
            <dt>Assigned location</dt>
            <dd>{locationText.trim() || 'Not provided'}</dd>
          </div>
          <div>
            <dt>Assignment deadline</dt>
            <dd>
              <time dateTime={task.dueAt}>{date(task.dueAt)}</time>
            </dd>
          </div>
          {task.startsAt && (
            <div>
              <dt>Scheduled start</dt>
              <dd>
                <time dateTime={task.startsAt}>{date(task.startsAt)}</time>
              </dd>
            </div>
          )}
          {task.requiredSkill?.trim() && (
            <div>
              <dt>Required skills</dt>
              <dd>{task.requiredSkill}</dd>
            </div>
          )}
        </dl>
        {task.instructions?.trim() && <section>
          <h3>Coordinator instructions</h3>
          <p className="volunteer-task-copy">
            {task.instructions}
          </p>
        </section>}
        {task.note?.trim() && !history.some((event) => event.note === task.note) && (
          <section>
            <h3>Assignment note</h3>
            <p className="volunteer-task-copy">{task.note}</p>
          </section>
        )}
        {!!history.length && (
          <details>
            <summary>Task history and reports</summary>
            <ol className="volunteer-task-history">
              {history.map((event) => (
                <li key={event.id}>
                  <strong>{volunteerEventLabels[event.action] ?? event.action}</strong> ·{' '}
                  <time dateTime={event.createdAt}>{date(event.createdAt)}</time>
                  {event.workDescription && <p>Work completed · {event.workDescription}</p>}
                  {event.outcome && (event.outcome !== event.workDescription || !isDelivery) && <p>Outcome · {event.outcome}</p>}
                  {event.peopleAssisted != null && <p>People assisted · {event.peopleAssisted}</p>}
                  {event.issues && <p>Issues · {event.issues}</p>}
                  {event.note && <p className="volunteer-task-copy">{event.note}</p>}
                </li>
              ))}
            </ol>
          </details>
        )}
        {!verified && (
          <p className="muted">
            Your coordinator must verify your volunteer profile before you can update assignments.
          </p>
        )}
        {verified && currentStatus === 'Assigned' && (
          <div className="button-row">
            <Button
              type="button"
              busy={write.isPending}
              onClick={() => write.mutate({ action: 'Accept' })}
            >
              {isDelivery ? 'Accept delivery' : 'Accept'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={write.isPending}
              onClick={() => write.mutate({ action: 'Decline' })}
            >
              Decline
            </Button>
          </div>
        )}
        {verified && currentStatus === 'Accepted' && (
          <div className="stack">
            <Button
              type="button"
              busy={write.isPending}
              disabled={scheduled || anotherTaskInProgress}
              onClick={() => write.mutate({ action: 'Start' })}
            >
              {isDelivery ? 'Start delivery' : 'Start assignment'}
            </Button>
            {scheduled ? (
              <p className="muted">You can start at the scheduled time.</p>
            ) : (
              anotherTaskInProgress && (
                <p className="muted">
                  Submit a report for your current assignment before starting another.
                </p>
              )
            )}
          </div>
        )}
        {!isDelivery && progressForm}
        {canReport && (
          <form
            className="stack volunteer-report"
            onSubmit={(event) => {
              event.preventDefault();
              if (write.isPending || task.caseDispatchId && !handoverItems.length) return;
              const form = new FormData(event.currentTarget);
              const field = (name: string) => String(form.get(name) ?? '').trim();
              const quantities = handoverItems.map(item => ({ allocationId: item.id, quantity: Number(field(item.id)) }));
              write.mutate({
                action: 'Complete',
                workDescription: isDelivery ? 'Reported quantities for the citizen handover.' : field('workDescription'),
                outcome: isDelivery ? (quantities.some(item => item.quantity > 0) ? 'Aid handed to the citizen as reported.'
                  : 'No items were handed to the citizen.') : field('outcome'),
                issues: field('issues'),
                note: field('note'),
                handoverQuantities: isDelivery ? quantities : undefined,
                peopleAssisted: field('peopleAssisted') === '' ? null : Number(field('peopleAssisted')),
              });
            }}
          >
            <fieldset disabled={write.isPending} className="stack">
              <legend>{isDelivery ? 'Record what the citizen received' : 'Completion report'}</legend>
              {!isDelivery && <>
                <Field label="Work completed">
                <textarea name="workDescription" required minLength={10} maxLength={2000} />
              </Field>
              <Field label="Actual outcome">
                <textarea name="outcome" required minLength={10} maxLength={2000} />
              </Field>
              <Field label="People assisted (if applicable)">
                <input name="peopleAssisted" type="number" min={0} max={10000000} step={1} />
              </Field>
              </>}
              {isDelivery && <p className="muted">Enter 0 for any item you could not deliver. Explain any difference below.</p>}
              {handoverItems.map((item, index) => <Field key={item.id}
                label={`${item.name} (${unitSymbol(item.unit)})${handoverItems.some(other => other.id !== item.id && other.name === item.name && other.unit === item.unit) ? ` · line ${index + 1}` : ''}`}
                hint={`${pendingQuantity(item)} ${unitSymbol(item.unit)} available for this handover`}>
                <input name={item.id} type="number" min={0}
                  defaultValue={previousReport && item.reportedQuantity != null ? item.reportedQuantity : undefined}
                  max={pendingQuantity(item)}
                  step={isMeasuredUnit(item.unit) ? 0.01 : 1} required />
              </Field>)}
              <Field label={isDelivery ? 'Delivery issues or missing items' : 'Issues encountered'}
                hint={isDelivery ? 'Return undelivered items to the centre.' : undefined}>
                <textarea name="issues" maxLength={2000} defaultValue={previousReport?.issues} />
              </Field>
              {!isDelivery && <Field label="Completion notes">
                <textarea name="note" maxLength={2000} />
              </Field>}
              <Button busy={write.isPending} disabled={isDelivery && !handoverItems.length}>
                {isDelivery ? 'Submit handover report' : 'Submit for verification'}
              </Button>
            </fieldset>
          </form>
        )}
        {isDelivery && progressForm && <details><summary>Post a progress update</summary>{progressForm}</details>}
        {write.error && <ErrorState error={write.error} />}
        {write.isSuccess && (
          <p role="status" className="success-text">
            {actionFeedback[write.variables.action]}
          </p>
        )}
      </div>
    </WorkspaceDialog>
  );
}
