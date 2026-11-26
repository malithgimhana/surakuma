import { useState } from 'react';
import { ArrowRight, CheckCircle2, Clock, ClipboardList, Flag, Radio } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button, Empty, ErrorState, Field, formatDate, Loading, PageHeader } from './components';
import { CoordinatorMetrics, CoordinatorPanel, coordinatorCase, useCoordinatorVolunteers } from './CoordinatorOverview';
import type { CoordinatorVolunteersData } from './CoordinatorOverview';
import { coordinatorPath } from './countryScope';
import { useCountry } from './geography';
import { WorkspaceDialog } from './OrganisationDialog';
import { taskReference, volunteerEventLabels } from './volunteerWorkspace';
import type { VolunteerTask } from './types';

const views = [['assignments', 'Assignments'], ['reports', 'Field reports'], ['progress', 'Progress summary']] as const;
const states: VolunteerTask['status'][] = ['Assigned', 'Accepted', 'Declined', 'InProgress', 'AwaitingVerification', 'Completed', 'Returned'];
const label = (status: string) => status.replace(/([a-z])([A-Z])/g, '$1 $2');

export default function CoordinatorVolunteers() {
  const country = useCountry();
  const [params] = useSearchParams();
  const requested = params.get('view');
  const view = views.some(([key]) => key === requested) ? requested : 'assignments';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string>();
  const query = useCoordinatorVolunteers(country);
  const data = query.data;
  const tasks = data?.tasks;
  const overdue = new Set(data?.overdueTaskIds);
  const profiles = new Map(data?.profiles.map(profile => [profile.id, data.names[profile.userId]]));
  const counts = new Map(states.map(state => [state, tasks?.filter(task => task.status === state).length]));
  const taskById = new Map(tasks?.map(task => [task.id, task]));
  const term = search.trim().toLocaleLowerCase();
  const filtered = tasks?.filter(task => (status === 'Overdue' ? overdue.has(task.id) : !status || task.status === status) &&
    [task.title, profiles.get(task.volunteerId), data?.caseReferences?.[task.requestId], taskReference(task.id)]
      .join(' ').toLocaleLowerCase().includes(term)) ?? [];
  const visibleIds = new Set(filtered.map(task => task.id));
  const reports = (data?.history ?? []).filter(event => visibleIds.has(event.taskId) &&
    (event.workDescription || event.outcome || event.peopleAssisted != null || event.issues))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const detail = selected ? taskById.get(selected) : undefined;
  return <div className="coord-page">
    <PageHeader title="Volunteer progress" description="Follow assignments, field reports and verification across your response scope." />
    <CoordinatorMetrics label="Assignment summary" items={[
      { label: 'Assigned tasks', value: tasks?.length, icon: ClipboardList },
      { label: 'In-progress tasks', value: counts.get('InProgress'), icon: Radio, tone: 'purple' },
      { label: 'Completed tasks', value: counts.get('Completed'), icon: CheckCircle2, tone: 'green' },
      { label: 'Overdue tasks', value: data?.overdueTaskIds?.length, icon: Clock, tone: 'amber' },
    ]} />
    <CoordinatorPanel title={views.find(([key]) => key === view)?.[1] ?? 'Assignments'}>
      <nav className="coord-tabs" aria-label="Volunteer views">{views.map(([key, label]) => (
        <Link key={key} to={coordinatorPath('/volunteers', { view: key })} aria-current={view === key ? 'page' : undefined}>{label}</Link>
      ))}</nav>
      {view !== 'progress' && <div className="coord-filters">
        <Field label={view === 'reports' ? 'Search reports by assignment' : 'Search assignments'}><input type="search" value={search}
          onChange={e => setSearch(e.target.value)} placeholder="Task, volunteer or case reference" /></Field>
        <Field label="Assignment status"><select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>{[...states, 'Overdue'].map(state => <option key={state} value={state}>{label(state)}</option>)}
        </select></Field>
      </div>}
      {query.isPending ? <Loading /> : query.error ? <ErrorState error={query.error} retry={() => void query.refetch()} /> :
        !tasks?.length ? <Empty title="No volunteer assignments" description="Assignments linked to your response will appear here once the volunteer team schedules them." /> :
        view === 'progress' ? <dl className="coord-facts">{states.map(state => <div key={state}><dt>{label(state)}</dt><dd>{counts.get(state)}</dd></div>)}</dl> :
        view === 'reports' ? (reports.length ? <ul className="coord-activity-list">{reports.map(report => <li key={report.id}>
          <div><Button variant="ghost" className="coord-record-link" onClick={() => setSelected(report.taskId)}>
            {taskById.get(report.taskId)?.title}<ArrowRight size={15} /></Button>
            <p>{report.workDescription || report.outcome || report.issues || `People assisted ${report.peopleAssisted}`}</p>
          </div><time dateTime={report.createdAt}>{formatDate(report.createdAt)}</time>
        </li>)}</ul> : <Empty title="No field reports match this view" />) :
        filtered.length ? <div className="table-wrap" tabIndex={0} role="region" aria-label="Volunteer assignments">
          <table className="coord-table">
            <thead><tr><th>Assignment</th><th>Volunteer</th><th>Case</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>{filtered.map(task => <tr key={task.id}>
              <td><Button variant="ghost" className="coord-record-link" onClick={() => setSelected(task.id)}>{task.title}<ArrowRight size={15} /></Button>
                <small>{taskReference(task.id)}</small></td>
              <td>{profiles.get(task.volunteerId) ?? 'Unavailable'}</td>
              <td>{data?.caseReferences?.[task.requestId] ? <Link to={coordinatorCase(task.requestId)}>{data.caseReferences[task.requestId]}</Link> : '—'}</td>
              <td>{formatDate(task.dueAt)}</td><td><Badge value={task.status} />{overdue.has(task.id) && <small className="coord-case-flags">Overdue</small>}</td>
            </tr>)}</tbody>
          </table>
        </div> : <Empty title="No assignments match these filters" />}
    </CoordinatorPanel>
    {detail && data && <VolunteerDetails task={detail} data={data} name={profiles.get(detail.volunteerId)} close={() => setSelected(undefined)} />}
  </div>;
}

function VolunteerDetails({ task, data, name, close }: { task: VolunteerTask; data: CoordinatorVolunteersData; name?: string; close: () => void }) {
  const reference = data.caseReferences?.[task.requestId];
  const events = (data.history ?? []).filter(event => event.taskId === task.id).slice().reverse();
  return <WorkspaceDialog title={task.title} context={taskReference(task.id)} onDismiss={close}>
    <div className="stack">
      <div><Badge value={task.status} /></div>
      <dl className="coord-facts">
        <div><dt>Volunteer</dt><dd>{name ?? 'Unavailable'}</dd></div>
        <div><dt>Start</dt><dd>{task.startsAt ? formatDate(task.startsAt) : 'Not scheduled'}</dd></div>
        <div><dt>Due</dt><dd>{formatDate(task.dueAt)}</dd></div>
        {task.requiredSkill && <div><dt>Required skill</dt><dd>{task.requiredSkill}</dd></div>}
        {reference && <div><dt>Case</dt><dd><Link to={coordinatorCase(task.requestId)}>{reference}</Link></dd></div>}
      </dl>
      {task.instructions && <p>{task.instructions}</p>}
      <h3 className="inline"><Flag size={17} aria-hidden="true" /> Reporting history</h3>
      {events.length ? <ul className="coord-activity-list">{events.map(event => <li key={event.id}>
        <div><strong>{volunteerEventLabels[event.action] ?? label(event.action)}</strong>
          {event.actorId && data.names[event.actorId] && <p>{data.names[event.actorId]}</p>}
          {event.note && <p>{event.note}</p>}
          {event.workDescription && <p>Work completed · {event.workDescription}</p>}
          {event.outcome && <p>Outcome · {event.outcome}</p>}
          {event.peopleAssisted != null && <p>People assisted · {event.peopleAssisted}</p>}
          {event.issues && <p>Issues · {event.issues}</p>}
        </div>
        <time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time>
      </li>)}</ul> : <p className="muted">No activity has been recorded.</p>}
    </div>
  </WorkspaceDialog>;
}
