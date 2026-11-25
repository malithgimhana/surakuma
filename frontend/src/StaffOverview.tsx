import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './auth';
import { Empty, Field } from './components';
import { useCountry } from './geography';
import CaseManagerOverview from './CaseManagerOverview';
import LogisticsOverview from './LogisticsOverview';
import { coordinatorCountries, isLogisticsWorkspace, isShelterWorkspace, isVolunteerCoordinatorWorkspace, shelterPath } from './countryScope';
import { ShelterOverview } from './ShelterDashboard';
import VolunteerCoordinatorOverview from './VolunteerCoordinatorOverview';
import CoordinatorOverview from './CoordinatorOverview';

const labels = {
  Coordinator: 'Crisis Coordinator',
  CaseManager: 'Case Manager',
  Logistics: 'Logistics Staff',
  ShelterAdmin: 'Shelter Administrator',
  VolunteerCoordinator: 'Volunteer Coordinator',
};
type StaffRole = keyof typeof labels;

export default function StaffOverview() {
  const { user } = useAuth();
  const country = useCountry();
  const [params, setParams] = useSearchParams();
  const roles = (Object.keys(labels) as StaffRole[]).filter((role) => user?.roles.includes(role));
  const selected = params.get('role') as StaffRole;
  const role = roles.includes(selected) ? selected : roles.includes('CaseManager') ? 'CaseManager' :
    roles.find((r) => user?.memberships.some((m) => m.role === r && m.countryCode === country)) ?? roles[0];
  const roleControl = roles.length > 1 && <Field label="Workspace role"><select value={role} onChange={(event) => setParams({ role: event.target.value })}>
    {roles.map((entry) => <option key={entry} value={entry}>{labels[entry]}</option>)}
  </select></Field>;
  if (!role) return <Empty title="No specialist workspace available" />;
  if (role === 'VolunteerCoordinator') return isVolunteerCoordinatorWorkspace(user, '/staff', params.toString())
    ? <VolunteerCoordinatorOverview roleControl={roleControl} /> : <Navigate to="/staff?role=VolunteerCoordinator" replace />;
  if (role === 'CaseManager') return <CaseManagerOverview roleControl={roleControl} />;
  if (role === 'ShelterAdmin') return isShelterWorkspace(user, '/staff', params.toString())
    ? <ShelterOverview country={country} roleControl={roleControl} /> : <Navigate to={shelterPath()} replace />;
  if (role === 'Logistics') return isLogisticsWorkspace(user, '/staff', params.toString())
    ? <LogisticsOverview roleControl={roleControl} /> : <Navigate to="/staff?role=Logistics" replace />;
  return <CoordinatorOverview roleControl={roleControl} assigned={coordinatorCountries(user).includes(country)} />;
}
