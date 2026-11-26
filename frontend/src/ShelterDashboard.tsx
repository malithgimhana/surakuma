import { useState, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Accessibility,
  Activity,
  ArrowDownUp,
  ArrowRight,
  CheckCircle2,
  ChartNoAxesColumn,
  ClipboardCheck,
  Clock,
  Droplet,
  House,
  Layers,
  MapPin,
  Package,
  Pencil,
  Plus,
  Search,
  SquarePlus,
  Tent,
  TriangleAlert,
  Users,
  UsersRound,
} from 'lucide-react';
import { api, get } from './api';
import { Button, Card, Empty, ErrorState, Field, formatDate, IconTile, PageHeader } from './components';
import { AssignedCountry, useDivisions } from './geography';
import { shelterPath } from './countryScope';
import { WorkspaceDialog } from './OrganisationDialog';
import type { Placement, Shelter } from './types';
import './shelter-dashboard.css';

type WarningKind =
  | 'overcapacity'
  | 'unknownCapacity'
  | 'full'
  | 'criticalCapacity'
  | 'nearCapacity'
  | 'closedWithPlacements'
  | 'stale'
  | 'closed'
  | 'pendingVerification'
  | 'partnerVerification'
  | 'facilitiesUnknown';
type Warning = { kind: WarningKind; severity: 'critical' | 'warning' };
type Entry = {
  shelter: Shelter;
  eligible: boolean;
  reportedAvailable?: number;
  crises: { id: string; name: string }[];
  warnings: Warning[];
};
export type ShelterSnapshot = {
  entries: Entry[];
  statistics: Record<'total' | 'available' | 'occupied' | 'households' | 'attention', number> &
    Partial<Record<'pendingArrivals' | 'reserved' | 'capacity' | 'reportedAvailable', number>>;
};
type Details = {
  households: (Pick<Placement, 'id' | 'people' | 'status' | 'createdAt'> & {
    reference: string;
    checkInAt?: string;
  })[];
  activity: { entityId: string; action: string; detail: string; createdAt: string }[];
};
type Candidate = { id: string; reference: string; people: number; crisis: string };
type Division = NonNullable<ReturnType<typeof useDivisions>['data']>[number];

const standardMetrics = [
  ['total', 'Total shelters', Tent, 'blue'],
  ['available', 'Available spaces', UsersRound, 'green'],
  ['occupied', 'Occupied spaces', Users, 'blue'],
  ['households', 'Households accommodated', House, 'purple'],
  ['attention', 'Attention needed', TriangleAlert, 'coral'],
] as const;

const overviewMetrics = [
  ['total', 'Authorized shelters', Tent, 'blue'],
  ['capacity', 'Total shelter capacity', ChartNoAxesColumn, 'blue'],
  ['reportedAvailable', 'Reported available spaces', UsersRound, 'green'],
  ['reserved', 'Reserved spaces', ClipboardCheck, 'purple'],
  ['attention', 'Shelters requiring attention', TriangleAlert, 'coral'],
] as const;
const managementMetrics = [
  standardMetrics[0],
  overviewMetrics[2],
  standardMetrics[2],
  ['pendingArrivals', 'Pending arrivals (households)', House, 'purple'],
  ['attention', 'Shelters requiring review', TriangleAlert, 'coral'],
] as const;

export function useShelterSnapshot(country: string, workspace = false, enabled = true, coordinator = false) {
  return useQuery({
    queryKey: ['shelter-dashboard', country, coordinator ? 'Coordinator' : workspace ? 'ShelterAdmin' : 'standard'],
    queryFn: async () => {
      const data = await get<ShelterSnapshot>(`/staff/shelters?countryCode=${encodeURIComponent(country)}&dashboard=true`);
      if (!data?.statistics || !Array.isArray(data.entries))
        throw new Error('The current API does not provide shelter dashboard data. Restart the API with the updated build.');
      return data;
    },
    enabled,
  });
}

function ShelterMetrics({ rows, statistics, pending }: {
  rows: readonly (readonly [keyof ShelterSnapshot['statistics'], string, typeof Tent, 'blue' | 'green' | 'purple' | 'coral'])[];
  statistics?: ShelterSnapshot['statistics'];
  pending: boolean;
}) {
  return <section className="shelter-metrics" aria-label="Shelter statistics" aria-busy={pending}>
    {rows.map(([key, label, Icon, tone]) => <Card key={key} className={`shelter-stat shelter-stat-${tone}`}>
      <IconTile icon={Icon} tone={tone} />
      <div><span>{label}</span><strong>{statistics?.[key]?.toLocaleString() ??
        (pending ? <span className="shelter-skeleton" /> : '—')}</strong></div>
    </Card>)}
  </section>;
}

const occupancy = (s: Shelter) => (s.capacity > 0 ? (100 * s.occupancy) / s.capacity : null);
const date = (value?: string) => (value ? formatDate(value) : '—');
const stayLabels: Record<Placement['status'], string> = {
  Reserved: 'Reserved · awaiting arrival',
  CheckedIn: 'Checked in',
  Departed: 'Checked out',
  Cancelled: 'Cancelled',
};
const activityLabels: Record<string, string> = {
  ShelterSaved: 'Shelter saved',
  ShelterCreated: 'Shelter created',
  ShelterUpdated: 'Shelter updated',
  ShelterCapacityChanged: 'Capacity updated',
  ShelterOperationsVerified: 'Operational assessment verified',
  ShelterStatusChanged: 'Operational status changed',
  ShelterReserved: 'Household reserved',
  ShelterCheckIn: 'Household checked in',
  ShelterDepart: 'Household checked out',
  ShelterCancel: 'Reservation cancelled',
};

function warningCopy({ kind }: Warning, s: Shelter): [string, string] {
  const people = `${s.occupancy} of ${s.capacity} safe spaces occupied.`;
  switch (kind) {
    case 'nearCapacity':
      return [
        `${s.name} is near capacity`,
        `${people} Consider other shelters.`,
      ];
    case 'criticalCapacity':
      return [`${s.name} is at critical occupancy`, people];
    case 'full':
      return [`${s.name} is full`, people];
    case 'overcapacity':
      return [
        `${s.name} is over capacity`,
        `${s.occupancy} checked in and ${s.reserved} reserved for ${s.capacity} safe spaces.`,
      ];
    case 'unknownCapacity':
      return [
        `${s.name} has no safe capacity recorded`,
        'Confirm the safe capacity before making new reservations.',
      ];
    case 'closedWithPlacements':
      return [
        `${s.name} is closed with active placements`,
        `${s.occupancy} checked in · ${s.reserved} spaces reserved.`,
      ];
    case 'stale':
      return [`${s.name} needs an operational update`, `Operational report overdue · ${date(s.operationalUpdatedAt ?? s.updatedAt)}`];
    case 'pendingVerification':
      return [`${s.name} awaits verification`, 'Confirm capacity, facilities and operating readiness.'];
    case 'closed':
      return [`${s.name} is temporarily closed`, 'Review readiness before reopening.'];
    case 'facilitiesUnknown':
      return [`${s.name} has no facilities recorded`, 'Check drinking water, sanitation and accessibility on site.'];
    case 'partnerVerification':
      return [`${s.name} requires organisation verification`, 'Contact an administrator to confirm the operating organisation.'];
  }
}

function Facilities({ shelter }: { shelter: Shelter }) {
  const entries = shelter.facilities
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const icons = [
    [/^(drinking )?water$/i, Droplet],
    [/^(toilets?|sanitation)$/i, House],
    [/^first aid$/i, SquarePlus],
    [/^family spaces?$/i, UsersRound],
    [/^(accessibility|step.free access|wheelchair access)$/i, Accessibility],
  ] as const;
  if (shelter.accessible && !entries.some((entry) => icons[4][0].test(entry)))
    entries.push('Accessibility');
  if (!entries.length) return <span className="muted">No facilities recorded</span>;
  return (
    <>
      {[...new Set(entries)].map((entry) => {
        const Icon = icons.find(([test]) => test.test(entry))?.[1];
        return (
          <span className="shelter-chip" key={entry}>
            {Icon && <Icon size={14} aria-hidden="true" />}
            {entry}
          </span>
        );
      })}
    </>
  );
}

function Capacity({ shelter: s, reported }: { shelter: Shelter; reported?: number }) {
  return (
    <dl className="shelter-breakdown">
      {(
        [
          ['Total capacity', s.capacity > 0 ? s.capacity : '—'],
          [reported === undefined ? 'Available' : 'Reported free', reported ?? s.available],
          ['Reserved', s.reserved],
          ['Checked in', s.occupancy],
        ] as const
      ).map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className={typeof value === 'number' && value < 0 ? 'shelter-negative' : undefined}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function operationalState(entry: Entry) {
  if (entry.shelter.pendingVerification) return 'pending';
  if (entry.warnings.some(w => w.kind === 'stale' || w.kind === 'partnerVerification')) return 'review';
  return entry.shelter.open ? 'open' : 'closed';
}
const stateLabel = { open: 'Open', closed: 'Closed', pending: 'Pending verification', review: 'Update required' };
function OperationalStatus({ entry }: { entry: Entry }) {
  const state = operationalState(entry);
  return <span className="shelter-state" data-state={state}>{stateLabel[state]}</span>;
}

function ShelterCard({
  entry,
  location,
  onView,
  onEdit,
  onAllocate,
  workspace,
  onReview,
  readOnly,
}: {
  entry: Entry;
  location: string;
  onView: () => void;
  onEdit: () => void;
  onAllocate: () => void;
  workspace: boolean;
  onReview: () => void;
  readOnly: boolean;
}) {
  const s = entry.shelter;
  const percent = occupancy(s);
  const capacityWarning = entry.warnings.find(({ kind }) =>
    ['overcapacity', 'full', 'criticalCapacity', 'nearCapacity', 'unknownCapacity'].includes(kind),
  );
  return (
    <Card className="shelter-directory-card">
      <div className="shelter-card-header">
        <IconTile icon={Tent} tone="yellow" />
        <div>
          <h3>{s.name}</h3>
          <p className="shelter-location">
            <MapPin size={14} aria-hidden="true" />{' '}
            {[s.address, location].filter(Boolean).join(' · ') || 'Location not recorded'}
          </p>
        </div>
        <OperationalStatus entry={entry} />
      </div>
      <div className="shelter-occupancy" data-severity={capacityWarning?.severity}>
        <span>Occupancy</span>
        <progress
          max={100}
          value={Math.min(percent ?? 0, 100)}
          aria-label={`Occupancy at ${s.name}`}
          aria-valuetext={
            percent === null ? 'Capacity unknown' : `${Math.round(percent)}% occupied`
          }
        />
        <strong>
          {percent === null ? '—' : `${Math.round(percent)}%`}{' '}
          <span>
            ({s.occupancy} / {s.capacity > 0 ? s.capacity : '—'})
          </span>
        </strong>
      </div>
      <Capacity shelter={s} reported={workspace ? entry.reportedAvailable ?? Math.max(0, s.available) : undefined} />
      {workspace && <p className={entry.eligible ? 'shelter-confirmed' : 'shelter-unavailable'}>
        {entry.eligible ? `${s.available} spaces confirmed for placement` : 'Unavailable for new placements'}
      </p>}
      <div className="shelter-facilities">
        <strong>Facilities:</strong> <Facilities shelter={s} />
      </div>
      <div className="shelter-meta">
        <span>
          <Layers size={14} aria-hidden="true" />{' '}
          {entry.crises.length
            ? `Crisis: ${entry.crises.map((c) => c.name).join(', ')}`
            : 'No crisis linked by active placements'}
        </span>
        <span>
          <Clock size={14} aria-hidden="true" /> Updated {date(s.operationalUpdatedAt ?? s.updatedAt)}
        </span>
      </div>
      {workspace && entry.warnings.length > 0 && <ul className="shelter-card-warnings">
        {entry.warnings.map(warning => <li key={warning.kind}>{warningCopy(warning, s)[1]}</li>)}
      </ul>}
      <div className="shelter-actions">
        <Button variant="secondary" className="button secondary shelter-view" onClick={onView}
          aria-label={readOnly ? `View details for ${s.name}` : undefined}>
          View details
        </Button>
        {!readOnly && <Button variant="secondary" onClick={onEdit}>
          Edit capacity
        </Button>}
        {!readOnly && <Button variant="secondary" onClick={onAllocate} disabled={!entry.eligible}>
          <UsersRound size={16} aria-hidden="true" /> Allocate household
        </Button>}
        {!readOnly && workspace && <Button variant="secondary" onClick={onReview}>Review operational status</Button>}
      </div>
    </Card>
  );
}

function ShelterDialog({
  entry,
  location,
  country,
  mode,
  onDismiss,
  onEdit,
  workspace,
  readOnly,
}: {
  entry: Entry;
  location: string;
  country: string;
  mode: 'detail' | 'allocate';
  onDismiss: () => void;
  onEdit: () => void;
  workspace: boolean;
  readOnly: boolean;
}) {
  const s = entry.shelter;
  const allocating = mode === 'allocate';
  const [request, setRequest] = useState('');
  const [confirmation, setConfirmation] = useState(false);
  const locationState = useLocation().state as { registeredShelter?: string } | null;
  const client = useQueryClient();
  const scope = `countryCode=${encodeURIComponent(country)}`;
  const path = `/staff/shelters/${s.id}?${scope}`;
  const detail = useQuery({
    queryKey: ['shelter-detail', country, s.id, workspace],
    queryFn: () => get<Details>(path),
    enabled: !allocating,
  });
  const candidates = useQuery({
    queryKey: ['shelter-candidates', country, s.id, workspace],
    queryFn: () => get<Candidate[]>(`${path}&allocation=true`),
    enabled: allocating && !confirmation,
  });
  const write = useMutation({
    mutationFn: async ({
      path,
      data,
    }: {
      path: string;
      data?: { requestId: string; shelterId: string };
    }) => api.post(`${path}?${scope}`, data),
    onSuccess: async () => {
      if (allocating) setConfirmation(true);
      await client.invalidateQueries();
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: ['shelter-dashboard', country] });
      if (allocating)
        void client.invalidateQueries({ queryKey: ['shelter-candidates', country, s.id] });
      else void client.invalidateQueries({ queryKey: ['shelter-detail', country, s.id] });
    },
  });
  return (
    <WorkspaceDialog
      title={allocating ? 'Allocate household' : s.name}
      context={allocating ? s.name : [s.address, location].filter(Boolean).join(' · ')}
      busy={write.isPending}
      className="shelter-dialog"
      onDismiss={onDismiss}
    >
      {write.error && <ErrorState error={write.error} />}
      {allocating ? (
        confirmation ? (
          <p role="status" className="success-text">
            Household reserved. Check-in is still required.
          </p>
        ) : candidates.isPending ? (
          <p role="status">Finding eligible shelter requests…</p>
        ) : candidates.error ? (
          <ErrorState error={candidates.error} retry={() => void candidates.refetch()} />
        ) : !candidates.data?.length ? (
          <Empty
            title="No eligible household requests"
            description="Approved shelter requests that fit the available capacity appear here."
          />
        ) : (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (candidates.data.some((candidate) => candidate.id === request))
                write.mutate({
                  path: '/shelter-allocations',
                  data: { requestId: request, shelterId: s.id },
                });
            }}
          >
            <Field label="Approved shelter request">
              <select value={request} onChange={(e) => setRequest(e.target.value)} required>
                <option value="">Select a household</option>
                {candidates.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.reference} · {c.people} people · {c.crisis}
                  </option>
                ))}
              </select>
            </Field>
            <Button busy={write.isPending} disabled={!request}>
              Reserve spaces
            </Button>
          </form>
        )
      ) : (
        <div className="shelter-detail-sections">
          {workspace && locationState?.registeredShelter === s.id && <p role="status" className="success-text">
            Shelter registered. Complete operational verification before opening it for placements.
          </p>}
          <section>
            <div className="inline spread">
              <h3>Capacity &amp; facilities</h3>
              <OperationalStatus entry={entry} />
            </div>
            <Capacity shelter={s} reported={workspace ? entry.reportedAvailable ?? Math.max(0, s.available) : undefined} />
            {workspace && <p className="muted">{entry.eligible ? s.available : 0} spaces confirmed for placement</p>}
            <div className="shelter-facilities">
              <Facilities shelter={s} />
            </div>
            {!readOnly && <Button variant="secondary" onClick={onEdit} disabled={write.isPending}>
              {workspace ? 'Review status, facilities & capacity' : 'Edit facilities & capacity'}
            </Button>}
          </section>
          <section>
            <h3>Households &amp; check-ins</h3>
            {detail.isPending ? (
              <p role="status">Loading stays and activity…</p>
            ) : detail.error ? (
              <ErrorState error={detail.error} retry={() => void detail.refetch()} />
            ) : !detail.data?.households.length ? (
              <p className="muted">No household stays recorded.</p>
            ) : (
              <ul className="shelter-detail-list">
                {detail.data.households.map((h) => (
                  <li key={h.id}>
                    <div>
                      <strong>
                        {h.reference} · {h.people} people
                      </strong>
                      <small>
                        {stayLabels[h.status]} · Reserved {date(h.createdAt)}
                        {h.checkInAt && ` · Arrival ${date(h.checkInAt)}`}
                      </small>
                    </div>
                    {!readOnly && h.status === 'Reserved' && (
                      <div className="shelter-actions">
                        <Button
                          variant="secondary"
                          disabled={write.isPending || !s.open}
                          onClick={() =>
                            write.mutate({ path: `/shelter-allocations/${h.id}/CheckIn` })
                          }
                        >
                          Check in
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={write.isPending}
                          onClick={() =>
                            write.mutate({ path: `/shelter-allocations/${h.id}/Cancel` })
                          }
                        >
                          Cancel reservation
                        </Button>
                      </div>
                    )}
                    {!readOnly && h.status === 'CheckedIn' && (
                      <Button
                        variant="secondary"
                        disabled={write.isPending}
                        onClick={() =>
                          write.mutate({ path: `/shelter-allocations/${h.id}/Depart` })
                        }
                      >
                        Check out
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {!readOnly && <section>
            <h3>Resources &amp; shortages</h3>
            <p className="muted">
              Use supply support to request essentials from a verified organisation. Confirmed receipts are recorded in depot inventory.
            </p>
            <Link className="text-link" to={workspace ? shelterPath('/supply-support', { shelter: s.id, organisation: s.organisationId }) :
              `${window.location.pathname.startsWith('/admin') ? '/admin' : '/staff'}/supply-support?${new URLSearchParams({
                shelter: s.id, organisation: s.organisationId,
              })}`}>
              Report a supply shortage <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </section>}
          <section>
            <h3>Activity &amp; history</h3>
            {detail.data &&
              (detail.data.activity.length ? (
                <ul className="shelter-detail-list">
                  {detail.data.activity.map((a) => (
                    <li key={`${a.entityId}-${a.action}-${a.createdAt}`}>
                      <div>
                        <strong>{activityLabels[a.action] ?? a.action}</strong>
                        <small>
                          {date(a.createdAt)}
                          {a.detail && ` · ${a.detail}`}
                        </small>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No activity recorded.</p>
              ))}
            {detail.error && <p className="muted">Activity could not be loaded.</p>}
          </section>
        </div>
      )}
    </WorkspaceDialog>
  );
}

export function ShelterDashboard({
  country,
  onEdit,
  specialist = false,
  workspace = false,
  readOnly = false,
}: {
  country: string;
  onEdit: (shelter: Shelter) => void;
  specialist?: boolean;
  workspace?: boolean;
  readOnly?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const view = params.get('view');
  const snapshot = useShelterSnapshot(country, workspace, true, readOnly);
  const action = workspace && !readOnly ? params.get('action') : null;
  const detailId = workspace ? params.get('shelter') : null;
  const regions = useDivisions(country);
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('');
  const [crisis, setCrisis] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('highest');
  const [selected, setSelected] = useState<{ id: string; mode: 'detail' | 'allocate' }>();
  const divisions = new Map(
    (Array.isArray(regions.data) ? regions.data : []).map((d) => [d.id, d]),
  );
  const location = (s: Shelter) => {
    const trail: Division[] = [];
    let division = divisions.get(s.administrativeDivisionId ?? '');
    while (division && !trail.some((d) => d.id === division?.id)) {
      trail.unshift(division);
      division = divisions.get(division.parentId ?? '');
    }
    return trail;
  };
  const locationLabel = (s: Shelter) =>
    location(s)
      .filter((d) => /state|province|district/i.test(d.levelName))
      .map((d) => d.name)
      .join(' · ');
  const entries = snapshot.data?.entries ?? [];
  const crises = [...new Map(entries.flatMap((e) => e.crises).map((c) => [c.id, c])).values()].sort(
    (a, b) => a.name.localeCompare(b.name),
  );
  const visible = entries
    .filter(
      (entry) => {
        const { shelter: s, crises, warnings } = entry;
        return (action !== 'allocate' || entry.eligible) &&
        (view !== 'arrivals' || s.reserved > 0) &&
        (view !== 'occupied' || s.occupancy > 0) &&
        (view !== 'accessible' || (s.open && s.accessible)) &&
        (view !== 'attention' || warnings.length > 0) &&
        (!status || (workspace ? operationalState(entry) === status : (status === 'open') === s.open)) &&
        (!crisis || crises.some((c) => c.id === crisis)) &&
        (!region || location(s).some((d) => d.id === region)) &&
        [
          s.name,
          s.address,
          location(s)
            .map((d) => d.name)
            .join(' '),
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase());
      },
    )
    .sort((a, b) => {
      const x = a.shelter,
        y = b.shelter;
      const order =
        sort === 'recent'
          ? Date.parse(y.updatedAt) - Date.parse(x.updatedAt)
          : sort === 'capacity'
            ? y.capacity - x.capacity
            : sort === 'available'
            ? (b.eligible ? y.available : 0) - (a.eligible ? x.available : 0)
            : sort === 'lowest'
              ? (occupancy(x) ?? Infinity) - (occupancy(y) ?? Infinity)
              : sort === 'highest'
                ? (occupancy(y) ?? -1) - (occupancy(x) ?? -1)
                : 0;
      return order || x.name.localeCompare(y.name);
    });
  const warnings = visible
    .flatMap((entry) => entry.warnings.map((warning) => ({ entry, warning })))
    .sort(
      (a, b) =>
        Number(b.warning.severity === 'critical') - Number(a.warning.severity === 'critical'),
    );
  const warningCount = new Set(warnings.map(({ entry }) => entry.shelter.id)).size;
  const current = selected ?? (detailId ? { id: detailId, mode: 'detail' as const } : undefined);
  const active = entries.find(e => e.shelter.id === current?.id);
  const closeDetail = () => {
    setSelected(undefined);
    if (detailId) setParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete('shelter');
      return next;
    }, { replace: true, state: null });
  };
  const filtered = Boolean(search.trim() || region || crisis || status || view || action);
  const clear = () => {
    setSearch('');
    setRegion('');
    setCrisis('');
    setStatus('');
    if (view || action) setParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete('view');
      next.delete('action');
      return next;
    });
  };
  return (
    <>
      <ShelterMetrics rows={workspace ? managementMetrics : specialist ? [
        ...standardMetrics, ['reserved', 'Reserved spaces', Users, 'blue'], ['pendingArrivals', 'Pending arrivals', House, 'purple'],
      ] : standardMetrics} statistics={snapshot.data?.statistics} pending={snapshot.isPending} />
      {action === 'allocate' && <p className="shelter-hint">Select an eligible shelter to reserve spaces for an approved household request.</p>}
      {action === 'capacity' && <p className="shelter-hint">Choose Edit capacity on the shelter you want to update.</p>}
      {snapshot.isPending ? (
        <p className="sr-only" role="status">
          Loading shelter management…
        </p>
      ) : snapshot.error ? (
        <ErrorState error={snapshot.error} retry={() => void snapshot.refetch()} />
      ) : (
        <>
          <div className="shelter-filters" role="group" aria-label="Shelter filters">
            <label className="shelter-filter">
              <Search size={17} aria-hidden="true" />
              <input
                aria-label="Search shelters"
                placeholder="Search shelters by name or location"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="shelter-filter">
              <MapPin size={17} aria-hidden="true" />
              <select
                aria-label="Filter by district or region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                disabled={regions.isPending || !!regions.error}
              >
                <option value="">{country === 'LK' ? 'All districts' : 'All regions'}</option>
                {[...divisions.values()]
                  .filter((d) => /state|province|district/i.test(d.levelName))
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} · {d.levelName}
                      {d.parentId && divisions.get(d.parentId)
                        ? ` (${divisions.get(d.parentId)?.name})`
                        : ''}
                    </option>
                  ))}
              </select>
            </label>
            <label className="shelter-filter">
              <Layers size={17} aria-hidden="true" />
              <select
                aria-label="Filter by crisis"
                value={crisis}
                onChange={(e) => setCrisis(e.target.value)}
              >
                <option value="">All crises</option>
                {crises.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="shelter-filter">
              <Activity size={17} aria-hidden="true" />
              <select
                aria-label="Filter by operational status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All statuses</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
                {workspace && <><option value="pending">Pending verification</option>
                  <option value="review">Update required</option></>}
              </select>
            </label>
            <label className="shelter-filter">
              <ArrowDownUp size={17} aria-hidden="true" />
              <select
                aria-label="Sort shelters"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="highest">Occupancy (high to low)</option>
                <option value="lowest">Occupancy (low to high)</option>
                <option value="capacity">Highest total capacity</option>
                <option value="available">Most confirmed availability</option>
                <option value="recent">Recently updated</option>
                <option value="name">Alphabetical</option>
              </select>
            </label>
          </div>
          {regions.error && (
            <p className="muted">
              Location filters could not be loaded.{' '}
              <button className="text-link" onClick={() => void regions.refetch()}>
                Retry
              </button>
            </p>
          )}
          {(!readOnly || entries.length > 0) && <section className="shelter-attention" aria-labelledby="shelter-attention-title">
            <h2 id="shelter-attention-title">
              <TriangleAlert size={21} aria-hidden="true" /> Shelters requiring attention{' '}
              <span>{warningCount}</span>
            </h2>
            {workspace && warnings.length > 0 && view !== 'attention' ? (
              <Link className="text-link" to={shelterPath('/shelters', { view: 'attention' })}>Review warnings <ArrowRight size={15} /></Link>
            ) : warnings.length ? (
              <div className={workspace ? 'shelter-warning-list' : 'shelter-grid-v2'}>
                {warnings.map(({ entry, warning }) => {
                  const [title, explanation] = warningCopy(warning, entry.shelter);
                  return (
                    <article
                      className="shelter-alert"
                      data-severity={warning.severity}
                      key={`${entry.shelter.id}-${warning.kind}`}
                    >
                      <IconTile
                        icon={TriangleAlert}
                        tone={warning.severity === 'critical' ? 'coral' : 'yellow'}
                      />
                      <div>
                        <strong>{title}</strong>
                        <p>
                          <b>{warning.severity === 'critical' ? 'Critical' : 'Warning'}:</b>{' '}
                          {explanation}
                        </p>
                      </div>
                      <Button
                        onClick={() => setSelected({ id: entry.shelter.id, mode: 'detail' })}
                        variant="secondary"
                        aria-label={`Review: ${title}`}
                      >
                        Review <ArrowRight size={15} aria-hidden="true" />
                      </Button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="shelter-all-clear">
                <CheckCircle2 size={18} aria-hidden="true" />
                {filtered
                  ? 'No warnings for the matching shelters.'
                  : entries.length
                    ? 'No shelters currently require attention.'
                    : 'No shelters registered in this country.'}
              </p>
            )}
          </section>}
          <section aria-label="Shelter directory">
            {visible.length ? (
              <div className="shelter-grid-v2">
                {visible.map((entry) => (
                  <ShelterCard
                    key={entry.shelter.id}
                    entry={entry}
                    location={locationLabel(entry.shelter)}
                    onView={() => setSelected({ id: entry.shelter.id, mode: 'detail' })}
                    onEdit={() => onEdit(entry.shelter)}
                    onAllocate={() => setSelected({ id: entry.shelter.id, mode: 'allocate' })}
                    workspace={workspace}
                    onReview={() => onEdit(entry.shelter)}
                    readOnly={readOnly}
                  />
                ))}
              </div>
            ) : (
              <Card>
                <Empty
                  title={filtered ? 'No matching shelters' : 'No shelters to display'}
                  description={
                    filtered
                      ? 'Try a different search or clear the filters.'
                      : readOnly ? 'Shelters in your operating scope will appear here.' : 'Add a shelter to start monitoring capacity.'
                  }
                />
                {filtered && (
                  <Button variant="secondary" onClick={clear}>
                    Clear filters
                  </Button>
                )}
              </Card>
            )}
          </section>
        </>
      )}
      {detailId && !active && snapshot.isSuccess && <Card>
        <Empty title="Shelter details unavailable" description="Check that this shelter is within your current assignment." />
        <Button variant="secondary" onClick={closeDetail}>Return to shelters</Button>
      </Card>}
      {current && active && (
        <ShelterDialog
          key={`${current.id}-${current.mode}`}
          entry={active}
          location={locationLabel(active.shelter)}
          country={country}
          mode={current.mode}
          workspace={workspace}
          readOnly={readOnly}
          onDismiss={closeDetail}
          onEdit={() => {
            closeDetail();
            onEdit(active.shelter);
          }}
        />
      )}
    </>
  );
}

export function ShelterOverview({ country, roleControl }: { country: string; roleControl?: ReactNode }) {
  const snapshot = useShelterSnapshot(country, true);
  const data = snapshot.data;
  const stats = data?.statistics;
  const attention = [...(data?.entries ?? [])].filter(entry => entry.warnings.length)
    .sort((a, b) => Number(b.warnings.some(w => w.severity === 'critical')) -
      Number(a.warnings.some(w => w.severity === 'critical')));
  const details = (id: string) => shelterPath('/shelters', { shelter: id });
  const actions = [
    ['Manage shelters', Tent, shelterPath('/shelters')],
    ['Allocate household', UsersRound, shelterPath('/shelters', { action: 'allocate' })],
    ['Update capacity', Pencil, shelterPath('/shelters', { action: 'capacity' })],
    ['Request supplies', Package, shelterPath('/supply-support')],
    ['Register shelter', Plus, shelterPath('/shelters/new')],
  ] as const;
  return <div className="shelter-management shelter-page">
    <div className="shelter-eyebrow"><AssignedCountry code={country} /> · Shelter operations</div>
    <PageHeader title="Shelter Administrator Overview"
      description="Monitor safe accommodation, expected arrivals and operational needs."
      action={<div className="inline shelter-header-actions">{roleControl}
        <Link to={actions[0][2]} className="button secondary"><Tent size={17} />Manage shelters</Link>
        <Link to={actions[4][2]} className="button"><Plus size={17} />Add shelter</Link>
      </div>} />
    <ShelterMetrics rows={overviewMetrics} statistics={stats} pending={snapshot.isPending} />
    {snapshot.isPending && <p role="status" className="sr-only">Loading your shelter overview…</p>}
    {snapshot.error && <ErrorState error={snapshot.error} retry={() => void snapshot.refetch()} />}
    <div className="shelter-overview-grid">
      <Card>
        <h2><ChartNoAxesColumn size={19} /> Capacity &amp; occupancy</h2>
        <dl className="shelter-overview-counts">
          {[
            ['Occupied spaces', stats?.occupied],
            ['Total capacity', stats?.capacity],
            ['Confirmed available', stats?.available],
            ['Reserved spaces', stats?.reserved],
            ['Expected arrivals (households)', stats?.pendingArrivals],
            ['Households checked in', stats?.households],
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value?.toLocaleString() ?? '—'}</dd></div>)}
        </dl>
        {data && (data.entries.length ? <div className="shelter-overview-bars">
          {data.entries.map(entry => {
            const s = entry.shelter;
            const percent = occupancy(s);
            return <div key={s.id}>
              <div className="inline spread"><Link to={details(s.id)}>{s.name}</Link>
                <small>{s.occupancy} occupied · {entry.eligible ? s.available : 0} confirmed free</small></div>
              <progress max={100} value={Math.min(percent ?? 0, 100)} aria-label={`Occupancy at ${s.name}`}
                aria-valuetext={percent === null ? 'Capacity unknown' : `${Math.round(percent)}% occupied`} />
            </div>;
          })}
        </div> : <Empty title="No shelters registered in your assignment" />)}
      </Card>
      <Card>
        <div className="inline spread shelter-card-heading">
          <h2><TriangleAlert size={19} /> Operational warnings</h2>
          <Link className="text-link" to={shelterPath('/shelters', { view: 'attention' })}>View all <ArrowRight size={15} /></Link>
        </div>
        {data && (attention.length ? <div className="shelter-warning-list">
          {attention.slice(0, 5).map(entry => <article key={entry.shelter.id} className="shelter-alert"
            data-severity={entry.warnings.some(warning => warning.severity === 'critical') ? 'critical' : 'warning'}>
            <TriangleAlert size={20} aria-hidden="true" />
            <div><strong>{entry.shelter.name}</strong><p>{warningCopy(entry.warnings.find(w => w.severity === 'critical') ?? entry.warnings[0], entry.shelter)[1]}</p></div>
            <Link className="button secondary" to={details(entry.shelter.id)} aria-label={`Review ${entry.shelter.name}`}>Review <ArrowRight size={15} /></Link>
          </article>)}
        </div> : <p className="shelter-all-clear"><CheckCircle2 size={18} />No shelters currently require attention.</p>)}
      </Card>
      <Card>
        <div className="inline spread shelter-card-heading">
          <h2><Tent size={19} /> Assigned shelter snapshot</h2>
          <Link className="text-link" to={actions[0][2]}>Open management <ArrowRight size={15} /></Link>
        </div>
        {data && (data.entries.length ? <div className="shelter-table-scroll" tabIndex={0} role="region" aria-label="Scrollable shelter snapshot">
          <table className="shelter-table" aria-label="Assigned shelters"><thead><tr>
            <th scope="col">Shelter &amp; location</th><th scope="col">Capacity</th><th scope="col">Occupied</th>
            <th scope="col">Confirmed available</th><th scope="col">Operational status</th>
          </tr></thead><tbody>{data.entries.map(entry => <tr key={entry.shelter.id}>
            <th scope="row"><Link to={details(entry.shelter.id)}>{entry.shelter.name}</Link><small>{entry.shelter.address}</small></th>
            <td>{entry.shelter.capacity}</td><td>{entry.shelter.occupancy}</td>
            <td>{entry.eligible ? entry.shelter.available : 0}</td><td><OperationalStatus entry={entry} /></td>
          </tr>)}</tbody></table>
        </div> : <Empty title="No assigned shelters yet" />)}
      </Card>
      <Card>
        <h2>Quick actions</h2>
        <div className="shelter-quick-actions">{actions.map(([label, Icon, to]) =>
          <Link key={label} to={to}><Icon size={19} aria-hidden="true" />{label}</Link>)}</div>
      </Card>
    </div>
  </div>;
}
