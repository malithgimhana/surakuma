import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  ClipboardList,
  Clock3,
  FileCheck2,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorState, formatDate, Loading, PageHeader } from './components';
import { get } from './api';
import { useCountry } from './geography';
import {
  VolunteerMetrics,
  VolunteerPanel,
  VolunteerPill,
  VolunteerTable,
} from './VolunteerCoordinatorUi';
import {
  coordinationPath,
  operationalVolunteerSkills,
  rosterSkills,
  splitSkills,
  taskReference,
  useVolunteerWorkspace,
  volunteerEventLabels,
  volunteerName,
} from './volunteerWorkspace';
import type { EligibleVolunteerCase } from './volunteerWorkspace';

export default function VolunteerCoordinatorOverview({ roleControl }: { roleControl?: ReactNode }) {
  const dataQuery = useVolunteerWorkspace();
  const country = useCountry();
  const unassigned = useQuery({
    queryKey: ['volunteer-cases', 'unassigned', country],
    queryFn: () => get<EligibleVolunteerCase[]>('/volunteer-tasks/cases?unassigned=true'),
  });
  const data = dataQuery.data;
  const active = data?.tasks.filter((task) => task.status === 'InProgress') ?? [];
  const pendingReport = data?.tasks.find((task) => task.status === 'AwaitingVerification');
  const attention = data && [
    ...data.tasks
      .filter((t) => data.overdue.includes(t.id))
      .slice(0, 3)
      .map((t) => ({
        key: `overdue-${t.id}`,
        label: t.title,
        detail: `Overdue · ${formatDate(t.dueAt)}`,
        icon: Clock3,
        tone: 'red',
        action: 'View task',
        href: coordinationPath('deployments', { status: 'overdue', task: t.id }),
      })),
    ...data.tasks
      .filter((t) => t.status === 'AwaitingVerification')
      .slice(0, 3)
      .map((t) => ({
        key: t.id,
        label: t.title,
        detail: 'Report awaiting verification',
        icon: FileCheck2,
        tone: 'amber',
        action: 'Review report',
        href: coordinationPath('reports', { task: t.id }),
      })),
    ...(unassigned.data ?? []).slice(0, 2).map((c) => ({
      key: c.id,
      label: c.reference,
      detail: `${c.requiresCentreHandover ? 'Aid ready for volunteer handover' : 'Unassigned case'} · ${c.locationText}`,
      icon: ClipboardList,
      tone: 'blue',
      action: c.requiresCentreHandover ? 'Assign volunteer' : 'Assign task',
      href: coordinationPath('assign', { case: c.id }),
    })),
    ...data.profiles
      .filter(
        (p) =>
          !p.verified && (p.taskRequestId || data.organisations.some((o) => o.id === p.organisationId && o.canManage)),
      )
      .slice(0, 2)
      .map((p) => ({
        key: p.id,
        label: volunteerName(data, p),
        detail: 'Volunteer verification pending',
        icon: ShieldCheck,
        tone: 'amber',
        action: 'Review profile',
        href: coordinationPath('manage', { volunteer: p.id, mode: 'view' }),
      })),
  ];
  return (
    <div className="vc-page">
      <PageHeader
        title="Volunteer Coordinator Overview"
        description="Assign ready deliveries and review what volunteers handed over."
        action={
          <div className="vc-actions">
            {roleControl}
            {pendingReport && <Link className="button primary" to={coordinationPath('reports', { task: pendingReport.id })}>
              <FileCheck2 size={18} /> Review report
            </Link>}
            <Link className={`button ${pendingReport ? 'secondary' : 'primary'}`} to={coordinationPath('assign')}>
              <Plus size={18} /> New assignment
            </Link>
          </div>
        }
      />
      {dataQuery.isPending ? (
        <Loading />
      ) : dataQuery.error ? (
        <ErrorState error={dataQuery.error} retry={() => void dataQuery.refetch()} />
      ) : (
        data && (
          <>
            <VolunteerMetrics data={data} />
            <div className="vc-overview-grid">
              <VolunteerPanel title="Needs your attention">
                {unassigned.error && (
                  <ErrorState error={unassigned.error} retry={() => void unassigned.refetch()} />
                )}
                {unassigned.isPending && <Loading />}
                {attention?.length ? (
                  <ul className="vc-activity-list">
                    {attention.map(({ key, label, detail, icon: Icon, tone, href, action }) => (
                      <li key={key}>
                        <span className="vc-metric-icon" data-tone={tone}>
                          <Icon size={18} aria-hidden="true" />
                        </span>
                        <div>
                          <strong>{label}</strong>
                          <small>{detail}</small>
                        </div>
                        <Link className="button secondary" to={href}>
                          {key === pendingReport?.id ? 'Open report' : action}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  unassigned.isSuccess && <p className="muted">No items need your attention.</p>
                )}
              </VolunteerPanel>
              <VolunteerPanel
                title="Active deployments"
                action={
                  <Link className="vc-text-link" to={coordinationPath('deployments')}>
                    View all <ArrowRight size={16} />
                  </Link>
                }
              >
                {active.length ? (
                  <VolunteerTable label="Active deployments">
                    <thead>
                      <tr>
                        <th>Assignment</th>
                        <th>Volunteer</th>
                        <th>Status</th>
                        <th>Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.slice(0, 5).map((task) => (
                        <tr key={task.id}>
                          <td>
                            <Link
                              className="vc-text-link"
                              to={coordinationPath('deployments', { task: task.id })}
                            >
                              {task.title}
                            </Link>
                            <small>
                              {taskReference(task.id)} · {data.cases[task.requestId]?.locationText}
                            </small>
                          </td>
                          <td>
                            {volunteerName(
                              data,
                              data.profiles.find((p) => p.id === task.volunteerId),
                            )}
                          </td>
                          <td>
                            <VolunteerPill>In progress</VolunteerPill>
                          </td>
                          <td>{formatDate(task.dueAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </VolunteerTable>
                ) : (
                  <Empty
                    title="No active deployments"
                    action={
                      <Link
                        className="button secondary"
                        to={coordinationPath('deployments', { status: 'open' })}
                      >
                        View open assignments
                      </Link>
                    }
                  />
                )}
              </VolunteerPanel>
              <VolunteerPanel
                title="Volunteer availability by skill"
                description="Verified volunteers who are free now."
              >
                <ul className="vc-skill-list">
                  {rosterSkills(data.profiles, operationalVolunteerSkills).map((skill) => {
                    const profiles = data.profiles.filter(
                      (p) =>
                        p.verified &&
                        splitSkills(p.skills).some((s) => s.toLowerCase() === skill.toLowerCase()),
                    );
                    const free = profiles.filter((p) => data.available.includes(p.id)).length;
                    return (
                      <li key={skill}>
                        <Link
                          className="vc-text-link"
                          to={coordinationPath('directory', {
                            availability: 'available',
                            verification: 'verified',
                            skill,
                          })}
                        >
                          {skill}
                        </Link>
                        <progress
                          aria-label={`${skill} availability`}
                          value={free}
                          max={Math.max(1, profiles.length)}
                        />
                        <span>
                          {free} of {profiles.length}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </VolunteerPanel>
              <VolunteerPanel title="Recent activity">
                {data.activity.length ? (
                  <ul className="vc-activity-list">
                    {data.activity.map((event) => {
                      const task = data.tasks.find((t) => t.id === event.entityId);
                      const profile = data.profiles.find((p) => p.id === event.entityId);
                      return (
                        <li key={event.id}>
                          <span className="vc-metric-icon">
                            <Activity size={18} aria-hidden="true" />
                          </span>
                          <div>
                            <strong>
                              {volunteerEventLabels[event.action] ??
                                volunteerEventLabels[event.action.replace(/^VolunteerTask/, '')] ??
                                event.action}
                            </strong>
                            <small>
                              {task?.title ?? volunteerName(data, profile)} ·{' '}
                              {formatDate(event.createdAt)}
                            </small>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="muted">No volunteer activity is recorded for this workspace.</p>
                )}
              </VolunteerPanel>
            </div>
          </>
        )
      )}
    </div>
  );
}
