import { ClipboardList, FileCheck2, Radio, Users } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ErrorState, Loading, PageHeader } from './components';
import VolunteerAssignment from './VolunteerAssignment';
import { VolunteerDeployments, VolunteerReports } from './VolunteerDeployments';
import { ManageVolunteer, VolunteerDirectory } from './VolunteerDirectory';
import TaskVolunteerRegistration from './TaskVolunteerRegistration';
import { coordinationPath, useVolunteerWorkspace } from './volunteerWorkspace';

const tabs = [
  { view: 'directory', label: 'Volunteer Directory', icon: Users },
  { view: 'assign', label: 'Assign Task', icon: ClipboardList },
  { view: 'deployments', label: 'Active Deployments', icon: Radio },
  { view: 'reports', label: 'Report Verification', icon: FileCheck2 },
];

export default function VolunteerCoordinatorWorkspace() {
  const query = useVolunteerWorkspace();
  const [params] = useSearchParams();
  const location = useLocation();
  const success = (location.state as { success?: string } | null)?.success;
  const view = params.get('view') ?? 'directory';
  const tab =
    view === 'open' || view === 'overdue'
      ? 'deployments'
      : tabs.some((t) => t.view === view)
        ? view
        : 'directory';
  const data = query.data;
  return (
    <div className="vc-page">
      {view !== 'manage' && view !== 'register-task' && (
        <>
          <PageHeader
            title="Volunteer Coordination"
          />
          <nav className="vc-tabs" aria-label="Volunteer coordination sections">
            {tabs.map(({ view: value, label, icon: Icon }) => (
              <Link
                key={value}
                to={coordinationPath(value)}
                aria-current={tab === value ? 'page' : undefined}
              >
                <Icon size={18} aria-hidden="true" /> {label}
              </Link>
            ))}
          </nav>
        </>
      )}
      {success && (
        <p className="success-text" role="status">
          {success}
        </p>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        data &&
        (view === 'register-task' ? (
          <TaskVolunteerRegistration key={location.search} data={data} initialCase={params.get('case')}
            initialDispatch={params.get('dispatch')} />
        ) : view === 'manage' ? (
          <ManageVolunteer
            key={params.get('volunteer') ?? 'new'}
            data={data}
            id={params.get('volunteer')}
            viewing={params.get('mode') === 'view'}
          />
        ) : tab === 'assign' ? (
          <VolunteerAssignment
            key={location.search}
            data={data}
            initialCase={params.get('case')}
            initialDispatch={params.get('dispatch')}
            preferredVolunteer={params.get('volunteer')}
          />
        ) : tab === 'deployments' ? (
          <VolunteerDeployments data={data} />
        ) : tab === 'reports' ? (
          <VolunteerReports data={data} />
        ) : (
          <VolunteerDirectory
            data={data}
            initialAvailability={view === 'available' ? 'available' : ''}
            initialVerification={['verified', 'available'].includes(view) ? 'verified' : ''}
          />
        ))
      )}
    </div>
  );
}
