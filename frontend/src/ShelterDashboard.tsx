import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Accessibility,
  Activity,
  ArrowDownUp,
  ArrowRight,
  CheckCircle2,
  Clock,
  Droplet,
  House,
  Layers,
  MapPin,
  Search,
  SquarePlus,
  Tent,
  TriangleAlert,
  Users,
  UsersRound,
} from 'lucide-react';
import { api, get } from './api';
import { Button, Card, Empty, ErrorState, Field, formatDate, IconTile } from './components';
import { useDivisions } from './geography';
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
  | 'stale';
type Warning = { kind: WarningKind; severity: 'critical' | 'warning' };
type Entry = {
  shelter: Shelter;
  eligible: boolean;
  crises: { id: string; name: string }[];
  warnings: Warning[];
};
type Snapshot = {
  entries: Entry[];
  statistics: Record<'total' | 'available' | 'occupied' | 'households' | 'attention', number>;
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

const metrics = [
  ['total', 'Total shelters', Tent, 'blue'],
  ['available', 'Available spaces', UsersRound, 'green'],
  ['occupied', 'Occupied spaces', Users, 'blue'],
  ['households', 'Households accommodated', House, 'purple'],
  ['attention', 'Attention needed', TriangleAlert, 'coral'],
] as const;

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
      return [`${s.name} needs an operational update`, `Last updated ${date(s.updatedAt)}.`];
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

function Capacity({ shelter: s }: { shelter: Shelter }) {
  return (
    <dl className="shelter-breakdown">
      {(
        [
          ['Total capacity', s.capacity > 0 ? s.capacity : '—'],
          ['Available', s.available],
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

function OperationalStatus({ shelter }: { shelter: Shelter }) {
  return (
    <span className="shelter-state" data-state={shelter.open ? 'open' : 'closed'}>
      {shelter.open ? 'Open' : 'Closed'}
    </span>
  );
}

function ShelterCard({
  entry,
  location,
  onView,
  onEdit,
  onAllocate,
}: {
  entry: Entry;
  location: string;
  onView: () => void;
  onEdit: () => void;
  onAllocate: () => void;
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
        <OperationalStatus shelter={s} />
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
      <Capacity shelter={s} />
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
          <Clock size={14} aria-hidden="true" /> Updated {date(s.updatedAt)}
        </span>
      </div>
      <div className="shelter-actions">
        <Button variant="secondary" className="button secondary shelter-view" onClick={onView}>
          View details
        </Button>
        <Button variant="secondary" onClick={onEdit}>
          Edit capacity
        </Button>
        <Button variant="secondary" onClick={onAllocate} disabled={!entry.eligible}>
          <UsersRound size={16} aria-hidden="true" /> Allocate household
        </Button>
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
}: {
  entry: Entry;
  location: string;
  country: string;
  mode: 'detail' | 'allocate';
  onDismiss: () => void;
  onEdit: () => void;
}) {
  const s = entry.shelter;
  const allocating = mode === 'allocate';
  const [request, setRequest] = useState('');
  const [confirmation, setConfirmation] = useState(false);
  const client = useQueryClient();
  const scope = `countryCode=${encodeURIComponent(country)}`;
  const path = `/staff/shelters/${s.id}?${scope}`;
  const detail = useQuery({
    queryKey: ['shelter-detail', country, s.id],
    queryFn: () => get<Details>(path),
    enabled: !allocating,
  });
  const candidates = useQuery({
    queryKey: ['shelter-candidates', country, s.id],
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
          <section>
            <div className="inline spread">
              <h3>Capacity &amp; facilities</h3>
              <OperationalStatus shelter={s} />
            </div>
            <Capacity shelter={s} />
            <div className="shelter-facilities">
              <Facilities shelter={s} />
            </div>
            <Button variant="secondary" onClick={onEdit} disabled={write.isPending}>
              Edit facilities &amp; capacity
            </Button>
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
                    {h.status === 'Reserved' && (
                      <div className="shelter-actions">
                        <Button
                          variant="secondary"
                          disabled={write.isPending}
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
                    {h.status === 'CheckedIn' && (
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
          <section>
            <h3>Resources &amp; shortages</h3>
            <p className="muted">
              Inventory is tracked by depot. There is no shelter-specific stock or shortage record
              for this shelter.
            </p>
            <Link className="text-link" to="/admin/resources">
              Open resources <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </section>
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
}: {
  country: string;
  onEdit: (shelter: Shelter) => void;
}) {
  const snapshot = useQuery({
    queryKey: ['shelter-dashboard', country],
    queryFn: async () => {
      const data = await get<Snapshot>(
        `/staff/shelters?countryCode=${encodeURIComponent(country)}&dashboard=true`,
      );
      if (!data?.statistics || !Array.isArray(data.entries))
        throw new Error(
          'The current API does not provide shelter dashboard data. Restart the API with the updated build.',
        );
      return data;
    },
  });
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
      ({ shelter: s, crises }) =>
        (!status || (status === 'open') === s.open) &&
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
          .includes(search.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => {
      const x = a.shelter,
        y = b.shelter;
      const order =
        sort === 'recent'
          ? Date.parse(y.updatedAt) - Date.parse(x.updatedAt)
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
  const active = entries.find((e) => e.shelter.id === selected?.id);
  const filtered = Boolean(search.trim() || region || crisis || status);
  const clear = () => {
    setSearch('');
    setRegion('');
    setCrisis('');
    setStatus('');
  };
  return (
    <>
      <section
        className="shelter-metrics"
        aria-label="Shelter statistics"
        aria-busy={snapshot.isPending}
      >
        {metrics.map(([key, label, Icon, tone]) => (
          <Card key={key} className={`shelter-stat shelter-stat-${tone}`}>
            <IconTile icon={Icon} tone={tone} />
            <div>
              <span>{label}</span>
              <strong>
                {snapshot.data?.statistics[key].toLocaleString() ??
                  (snapshot.isPending ? <span className="shelter-skeleton" /> : '—')}
              </strong>
            </div>
          </Card>
        ))}
      </section>
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
                <option value="available">Most available capacity</option>
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
          <section className="shelter-attention" aria-labelledby="shelter-attention-title">
            <h2 id="shelter-attention-title">
              <TriangleAlert size={21} aria-hidden="true" /> Shelters requiring attention{' '}
              <span>{warningCount}</span>
            </h2>
            {warnings.length ? (
              <div className="shelter-grid-v2">
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
          </section>
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
                      : 'Add a shelter to start monitoring capacity.'
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
      {selected && active && (
        <ShelterDialog
          key={`${selected.id}-${selected.mode}`}
          entry={active}
          location={locationLabel(active.shelter)}
          country={country}
          mode={selected.mode}
          onDismiss={() => setSelected(undefined)}
          onEdit={() => {
            setSelected(undefined);
            onEdit(active.shelter);
          }}
        />
      )}
    </>
  );
}
