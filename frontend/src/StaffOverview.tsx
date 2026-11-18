import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Boxes, ClipboardList, Siren, Tent, Users } from 'lucide-react';
import { get } from './api';
import { useAuth } from './auth';
import { Card, Empty, ErrorState, Field, formatDate, IconTile, Loading, PageHeader } from './components';
import { useCountry } from './geography';

const cases = (role: string, filter = '') => `/staff/cases?role=${role}${filter ? '&' + filter : ''}`;
const manager = (filter = '') => cases('CaseManager', `assignedToMe=true&${filter || 'view=open'}`);
const coordinator = (view: string) => cases('Coordinator', `view=${view}`);
const logistics = (view = '', status = '') => `/staff/resources?tab=${view || 'inventory'}&status=${encodeURIComponent(status)}`;
const shelters = (view = '') => `/staff/shelters${view && '?view=' + view}`;
const volunteers = (view = '') => `/staff/volunteers${view && '?view=' + view}`;

const dashboards = {
  Coordinator: {
    label: 'Crisis Coordinator', icon: Siren,
    cards: [
      ['crises', 'Assigned crises', '/staff/crises'],
      ['unassigned', 'Unassigned cases', coordinator('unassigned')],
      ['critical', 'Critical cases', coordinator('critical')],
      ['overdue', 'Overdue cases', coordinator('overdue')],
      ['escalated', 'Pending escalations', coordinator('escalated')],
      ['shortages', 'Cases short on suitable stock', coordinator('shortages')],
      ['pressure', 'Shelter capacity warnings', shelters('attention')],
      ['assignments', 'Open cases with a case manager', coordinator('assigned')],
    ],
  },
  CaseManager: {
    label: 'Case Manager', icon: ClipboardList,
    cards: [
      ['assigned', 'My assigned cases', manager()],
      ['verification', 'Awaiting verification', manager('status=UnderReview')],
      ['critical', 'Critical requests', manager('view=critical')],
      ['overdue', 'Overdue cases', manager('view=overdue')],
      ['ai', 'Cases with pending AI reviews', manager('view=pending-ai')],
      ['escalated', 'Escalated cases', manager('view=escalated')],
    ],
  },
  Logistics: {
    label: 'Logistics Staff', icon: Boxes,
    cards: [
      ['inventory', 'Authorized inventory records', logistics()],
      ['low', 'Low-stock items', logistics('inventory', 'Low stock')],
      ['reservations', 'Pending case reservations', logistics('reservations', 'Reserved')],
      ['dispatch', 'Dispatch queue', logistics('dispatches', 'PendingDispatch')],
      ['transit', 'Shipments in transit', logistics('dispatches', 'InTransit')],
      ['receipts', 'Case deliveries awaiting confirmation', logistics('reservations', 'Dispatched')],
      ['exceptions', 'Delivery exceptions', logistics('dispatches', 'Exception')],
    ],
  },
  ShelterAdmin: {
    label: 'Shelter Administrator', icon: Tent,
    cards: [
      ['shelters', 'Authorized shelters', shelters()],
      ['capacity', 'Total capacity', shelters()],
      ['occupancy', 'Occupied spaces', shelters('occupied')],
      ['reserved', 'Reserved spaces', shelters('arrivals')],
      ['arrivals', 'Households awaiting arrival', shelters('arrivals')],
      ['checkins', 'Households checked in', shelters('occupied')],
      ['accessible', 'Open accessible shelters', shelters('accessible')],
      ['pressure', 'Shelter warnings', shelters('attention')],
    ],
  },
  VolunteerCoordinator: {
    label: 'Volunteer Coordinator', icon: Users,
    cards: [
      ['verified', 'Verified volunteers', volunteers('verified')],
      ['available', 'Available verified volunteers', volunteers('available')],
      ['open', 'Open assignments', volunteers('open')],
      ['deployments', 'Active deployments', volunteers('deployments')],
      ['reports', 'Reports awaiting verification', volunteers('reports')],
      ['overdue', 'Overdue tasks', volunteers('overdue')],
    ],
  },
};
type StaffRole = keyof typeof dashboards;
type Overview = {
  hasAccess: boolean;
  metrics?: Record<string, number>;
  crises?: { id: string; name: string; active: boolean }[];
  decisions?: { id: string; reference: string; action: string; createdAt: string }[];
};

export default function StaffOverview() {
  const { user } = useAuth();
  const country = useCountry();
  const [params, setParams] = useSearchParams();
  const roles = (Object.keys(dashboards) as StaffRole[]).filter((role) => user?.roles.includes(role));
  const selected = params.get('role') as StaffRole;
  const role = roles.includes(selected) ? selected : roles.find((r) => user?.memberships.some((m) => m.role === r && m.countryCode === country)) ?? roles[0];
  const config = role ? dashboards[role] : undefined;
  const query = useQuery({
    queryKey: ['staff-overview', country, role],
    queryFn: () => get<Overview>(`/staff/overview/${role}?countryCode=${encodeURIComponent(country)}`),
    enabled: !!role,
  });
  if (!config) return <Empty title="No specialist workspace available" />;
  return <div className="stack">
    <PageHeader title={`${config.label} overview`} description={country}
      action={roles.length > 1 && <Field label="Workspace role"><select value={role} onChange={(event) => setParams({ role: event.target.value })}>
        {roles.map((entry) => <option key={entry} value={entry}>{dashboards[entry].label}</option>)}
      </select></Field>} />
    {query.isPending ? <Loading /> : query.error ? <ErrorState error={query.error} retry={() => void query.refetch()} /> :
      !query.data.hasAccess ? <Empty title="No role assignment in this country" description="Select a country where you have this role." /> : <>
        <div className="resource-grid">{config.cards.map(([key, label, url]) => <Card key={key}>
          <IconTile icon={config.icon} tone="blue" />
          <h2><Link to={url}>{label}</Link></h2>
          <strong>{query.data.metrics?.[key]?.toLocaleString() ?? '—'}</strong>
        </Card>)}</div>
        {query.data.crises && <Card><h2>Assigned crises</h2>
          {query.data.crises.length ? <ul>{query.data.crises.map((crisis) => <li key={crisis.id}>
            <Link to={`/staff/crises?crisisId=${crisis.id}`}>{crisis.name}</Link> · {crisis.active ? 'Active' : 'Ended'}
          </li>)}</ul> : <p className="muted">You have no assigned crises in this country.</p>}
        </Card>}
        {query.data.decisions && <Card><h2>Recent case decisions</h2>
          {query.data.decisions.length ? <ul>{query.data.decisions.map((decision) => <li key={`${decision.id}-${decision.createdAt}`}>
            <Link to={`/staff/cases/${decision.id}`}>{decision.reference}</Link> · {decision.action} · {formatDate(decision.createdAt)}
          </li>)}</ul> : <p className="muted">There are no recorded AI decisions on your cases.</p>}
        </Card>}
      </>}
  </div>;
}
