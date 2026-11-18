import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  ChartNoAxesColumnIncreasing,
  Check,
  Clock,
  Cloud,
  House,
  HousePlus,
  Languages,
  Layers,
  MapPin,
  Megaphone,
  Plus,
  Radio,
  Users,
  X,
} from 'lucide-react';
import { errorMessage, get } from './api';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  IconTile,
  Loading,
  PageHeader,
} from './components';
import {
  CrisisAlertComposer,
  CrisisPublishedAlerts,
  emptyAlertDraft,
  requiredAlertLanguages,
  useCrisisAlertHistory,
} from './CrisisAlerts';
import type { AlertDraft } from './CrisisAlerts';
import { CrisisCreationForm } from './CrisisCreationForm';
import {
  countryPath,
  dashboardRefreshInterval,
  useCrisisOperationsWrite,
  useOperationalAreas,
} from './crisisOperationsApi';
import { useCountries, useCountry } from './geography';
import { WorkspaceDialog } from './OrganisationDialog';
import type { Crisis, Lookups } from './types';
import './crisis-operations.css';

interface ResponseSnapshot {
  activeShelters: number;
  shelteredPeople: number;
  lastUpdated: string;
}

export default function CrisisOperationsPage() {
  const country = useCountry();
  const [drafts, setDrafts] = useState<Record<string, AlertDraft>>({});
  return (
    <CountryCrisisDashboard
      key={country}
      country={country}
      draft={drafts[country] ?? emptyAlertDraft}
      setDraft={(draft) => setDrafts((current) => ({ ...current, [country]: draft }))}
    />
  );
}

function CountryCrisisDashboard({
  country,
  draft,
  setDraft,
}: {
  country: string;
  draft: AlertDraft;
  setDraft: (draft: AlertDraft) => void;
}) {
  const [searchParams] = useSearchParams();
  const requestedCentre = searchParams.get('centre');
  const requestedCrisis = searchParams.get('crisisId');
  const countries = useCountries();
  const policy = countries.data?.find((entry) => entry.code === country);
  const crisesQuery = useQuery({
    queryKey: ['crises', country],
    queryFn: () => get<Crisis[]>(countryPath('/crises', country)),
    refetchInterval: dashboardRefreshInterval,
  });
  const lookups = useQuery({
    queryKey: ['lookups', country],
    queryFn: () => get<Lookups>(countryPath('/public/lookups', country)),
    refetchInterval: dashboardRefreshInterval,
  });
  const history = useCrisisAlertHistory(country);
  const write = useCrisisOperationsWrite(country);
  const [create, setCreate] = useState(false);
  const [confirmation, setConfirmation] = useState<Crisis>();
  const [notice, setNotice] = useState('');
  const [selection, setSelection] = useState<{ id: string; requested: string | null }>();
  const [showAllEnded, setShowAllEnded] = useState<boolean>();
  const [endedSearch, setEndedSearch] = useState('');
  const crises = crisesQuery.data ?? [];
  const active = crises.filter((crisis) => crisis.active);
  const ended = crises
    .filter((crisis) => !crisis.active)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const activeCrisis =
    active.find(
      (crisis) =>
        crisis.id === (selection?.requested === requestedCrisis ? selection.id : requestedCrisis),
    ) ?? active[0];
  const preferredCentre = lookups.data?.organisations.find(
    (centre) => centre.id === requestedCentre,
  );
  const requestedEnded = ended.findIndex((crisis) => crisis.id === requestedCrisis);
  const endedExpanded = showAllEnded ?? requestedEnded >= 3;
  const visibleEnded = endedExpanded
    ? ended.filter((crisis) =>
        [crisis.name, crisis.type, crisis.district]
          .join(' ')
          .toLowerCase()
          .includes(endedSearch.trim().toLowerCase()),
      )
    : ended.slice(0, 3);

  useEffect(() => {
    if (requestedCrisis) document.getElementById(`crisis-${requestedCrisis}`)?.focus();
  }, [requestedCrisis, activeCrisis?.id, requestedEnded]);

  function initiateResponseChange(crisis: Crisis) {
    write.reset();
    setNotice('');
    setConfirmation(crisis);
  }

  const translationCount = policy && requiredAlertLanguages(policy).length;
  const metrics = [
    {
      label: 'Active responses',
      icon: Radio,
      tone: 'green',
      value: crisesQuery.data ? active.length : undefined,
      loading: crisesQuery.isPending,
    },
    {
      label: 'Published alerts',
      icon: Megaphone,
      tone: 'blue',
      value: history.query.data?.publishedCount,
      loading: history.query.isPending,
    },
    {
      label: 'Required alert languages',
      icon: Languages,
      tone: 'purple',
      value: translationCount,
      loading: countries.isPending,
    },
    {
      label: 'Ended responses',
      icon: Check,
      tone: 'green',
      value: crisesQuery.data ? ended.length : undefined,
      loading: crisesQuery.isPending,
    },
  ];
  const countryError =
    countries.error ??
    (!countries.isPending && !policy ? new Error('Country settings are unavailable.') : null);
  return (
    <div className="crisis-dashboard">
      <PageHeader
        title="Crises & public information"
        description="Manage response areas and publish verified, translated public alerts."
        action={
          <Button
            type="button"
            onClick={() => {
              write.reset();
              setCreate(true);
            }}
          >
            <Plus size={18} aria-hidden="true" />
            Create crisis
          </Button>
        }
      />
      {notice && (
        <p className="success-text" role="status">
          {notice}
        </p>
      )}
      {countryError && <ErrorState error={countryError} retry={() => void countries.refetch()} />}
      <dl className="crisis-kpis" aria-label="Crisis operations figures">
        {metrics.map(({ label, tone, icon, value, loading }) => (
          <div className="card crisis-kpi" key={label}>
            <IconTile icon={icon} tone={tone} />
            <div>
              <dt>{label}</dt>
              <dd>
                {value?.toLocaleString() ??
                  (loading ? (
                    <span className="crisis-metric-loading" aria-label="Loading">
                      …
                    </span>
                  ) : (
                    <span aria-label="Unavailable">—</span>
                  ))}
              </dd>
            </div>
          </div>
        ))}
      </dl>
      <div className="crisis-main-grid">
        <Card className="crisis-active-card">
          <h2 className="crisis-panel-heading">
            <HousePlus aria-hidden="true" />
            Active crisis response
          </h2>
          {crisesQuery.isPending ? (
            <Loading />
          ) : crisesQuery.error ? (
            <ErrorState error={crisesQuery.error} retry={() => void crisesQuery.refetch()} />
          ) : activeCrisis ? (
            <>
              {active.length > 1 && (
                <Field label="Active response">
                  <select
                    value={activeCrisis.id}
                    onChange={(event) =>
                      setSelection({ id: event.target.value, requested: requestedCrisis })
                    }
                  >
                    {active.map((crisis) => (
                      <option key={crisis.id} value={crisis.id}>
                        {crisis.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <ActiveResponse
                key={activeCrisis.id}
                country={country}
                countryName={policy?.name ?? country}
                crisis={activeCrisis}
                lookups={lookups}
                preferredCentre={preferredCentre}
                onEnd={() => initiateResponseChange(activeCrisis)}
              />
            </>
          ) : (
            <p className="muted crisis-empty">
              No active responses in this country. Create a crisis or reopen an ended response.
            </p>
          )}
        </Card>
        <CrisisAlertComposer
          country={country}
          policy={policy}
          crises={active}
          draft={draft}
          setDraft={setDraft}
          loading={crisesQuery.isPending || countries.isPending}
          failed={!!(crisesQuery.error || countryError)}
        />
      </div>
      <div className="crisis-bottom-grid">
        <CrisisPublishedAlerts country={country} crises={crises} history={history} policy={policy} />
        <Card className="crisis-ended-card">
          <div className="crisis-panel-bar">
            <h2 className="crisis-panel-heading">
              <Layers aria-hidden="true" />
              Ended responses
            </h2>
            {ended.length > 0 && (
              <button
                type="button"
                className="crisis-panel-link"
                aria-expanded={endedExpanded}
                onClick={() => setShowAllEnded(!endedExpanded)}
              >
                {endedExpanded ? 'Show recent' : 'View all'}{' '}
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            )}
          </div>
          {crisesQuery.isPending ? (
            <Loading />
          ) : crisesQuery.error ? (
            <ErrorState error={crisesQuery.error} retry={() => void crisesQuery.refetch()} />
          ) : ended.length ? (
            <>
              {endedExpanded && (
                <div className="crisis-ended-search">
                  <Field label="Search ended responses">
                    <input
                      type="search"
                      value={endedSearch}
                      onChange={(event) => setEndedSearch(event.target.value)}
                    />
                  </Field>
                </div>
              )}
              {visibleEnded.length ? (
                <ul className="crisis-ended-list" aria-label="Ended responses">
                  {visibleEnded.map((crisis) => (
                    <li key={crisis.id}>
                      <div>
                        <strong id={`crisis-${crisis.id}`} tabIndex={-1}>
                          {crisis.name}
                        </strong>
                        <small className="muted">
                          {[crisis.type, crisis.district].filter(Boolean).join(' · ')}
                        </small>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        aria-label={`Reopen response for ${crisis.name}`}
                        onClick={() => initiateResponseChange(crisis)}
                      >
                        Reopen response
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted crisis-empty">No ended responses match this search.</p>
              )}
            </>
          ) : (
            <p className="muted crisis-empty">No ended responses in this country.</p>
          )}
        </Card>
      </div>
      {create && (
        <WorkspaceDialog
          title="New crisis"
          context={policy?.name ?? country}
          className="crisis-dialog"
          busy={write.isPending}
          onDismiss={() => setCreate(false)}
        >
          {write.error && (
            <p className="field-error" role="alert">
              {errorMessage(write.error)}
            </p>
          )}
          <CrisisCreationForm
            busy={write.isPending}
            onCreate={(data) =>
              write.mutate(
                {
                  path: '/crises',
                  data: { ...data, countryCode: country },
                },
                {
                  onSuccess: (crisis: Crisis) => {
                    setSelection({ id: crisis.id, requested: requestedCrisis });
                    setCreate(false);
                    setNotice('Crisis response created.');
                  },
                },
              )
            }
          />
        </WorkspaceDialog>
      )}
      {confirmation && (
        <WorkspaceDialog
          title={confirmation.active ? 'End crisis response?' : 'Reopen crisis response?'}
          context={confirmation.name}
          className="crisis-dialog"
          busy={write.isPending}
          onDismiss={() => setConfirmation(undefined)}
        >
          <p>
            {confirmation.active
              ? 'This response moves to Ended responses. New requests and alerts can no longer select it. Existing cases, published alerts and response history are retained.'
              : 'This response returns to the active list and becomes available for new requests and public alerts. Existing cases and response history are retained.'}
          </p>
          {write.error && (
            <p className="field-error" role="alert">
              {errorMessage(write.error)}
            </p>
          )}
          <div className="organisation-dialog-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={write.isPending}
              onClick={() => setConfirmation(undefined)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={confirmation.active ? 'danger' : 'primary'}
              busy={write.isPending}
              onClick={() =>
                write.mutate(
                  {
                    path: `/crises/${confirmation.id}/response-status`,
                    method: 'put',
                    data: { active: !confirmation.active },
                  },
                  {
                    onSuccess: () => {
                      if (!confirmation.active)
                        setSelection({ id: confirmation.id, requested: requestedCrisis });
                      setNotice(
                        confirmation.active
                          ? 'Crisis response ended.'
                          : 'Crisis response reopened.',
                      );
                      setConfirmation(undefined);
                    },
                  },
                )
              }
            >
              {confirmation.active ? 'End response' : 'Reopen response'}
            </Button>
          </div>
        </WorkspaceDialog>
      )}
    </div>
  );
}

function ActiveResponse({
  country,
  countryName,
  crisis,
  lookups,
  preferredCentre,
  onEnd,
}: {
  country: string;
  countryName: string;
  crisis: Crisis;
  lookups: ReturnType<typeof useQuery<Lookups>>;
  preferredCentre?: Lookups['organisations'][number];
  onEnd: () => void;
}) {
  const areas = useOperationalAreas(country, crisis.id);
  const snapshot = useQuery({
    queryKey: ['crisis-operations', country, crisis.id, 'snapshot'],
    queryFn: () =>
      get<ResponseSnapshot>(
        countryPath(`/admin/crisis-operations/crises/${crisis.id}/snapshot`, country),
      ),
    refetchInterval: dashboardRefreshInterval,
  });
  const [centre, setCentre] = useState<string>();
  const [showAreaForm, setShowAreaForm] = useState(false);
  const [removeArea, setRemoveArea] = useState<{ id: string; name: string }>();
  const [centreSaved, setCentreSaved] = useState(false);
  const centreWrite = useCrisisOperationsWrite(country);
  const areaWrite = useCrisisOperationsWrite(country);
  const currentCentre = centre ?? crisis.primaryOrganisationId ?? '';
  const unavailableCentre =
    currentCentre &&
    lookups.data &&
    !lookups.data.organisations.some((org) => org.id === currentCentre);
  const lastUpdate = [
    snapshot.data?.lastUpdated,
    crisis.updatedAt,
    ...(areas.data?.map((area) => area.updatedAt) ?? []),
  ]
    .filter((date): date is string => !!date)
    .map((date) => Date.parse(date))
    .sort((a, b) => b - a)[0];
  const lastUpdated = Number.isFinite(lastUpdate) ? new Date(lastUpdate) : null;
  const lastUpdatedText =
    lastUpdated?.toDateString() === new Date().toDateString()
      ? `Today, ${lastUpdated.toLocaleTimeString('en-GB', { timeStyle: 'short' })}`
      : lastUpdated?.toLocaleString('en-GB', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

  return (
    <div className="crisis-active-body">
      <div className="crisis-active-details">
        <Badge value="Open" />
        <h3 id={`crisis-${crisis.id}`} tabIndex={-1}>
          {crisis.name}
        </h3>
        <p className="crisis-location">
          <Cloud size={16} aria-hidden="true" />
          {[crisis.type, crisis.district, countryName].filter(Boolean).join(' · ')}
        </p>
        <form
          className="crisis-centre-form"
          onSubmit={(event) => {
            event.preventDefault();
            setCentreSaved(false);
            centreWrite.mutate(
              {
                path: `/crises/${crisis.id}/centre`,
                method: 'put',
                data: { organisationId: currentCentre || null },
              },
              {
                onSuccess: () => {
                  setCentre(undefined);
                  setCentreSaved(true);
                },
              },
            );
          }}
        >
          <Field label="Primary response centre">
            <select
              value={currentCentre}
              disabled={!lookups.data || centreWrite.isPending}
              onChange={(event) => {
                setCentre(event.target.value);
                setCentreSaved(false);
              }}
            >
              <option value="">No centre configured</option>
              {unavailableCentre && (
                <option value={currentCentre} disabled>
                  Current centre is unavailable
                </option>
              )}
              {lookups.data?.organisations.map((organisation) => (
                <option key={organisation.id} value={organisation.id}>
                  {organisation.name}
                </option>
              ))}
            </select>
          </Field>
          {preferredCentre && preferredCentre.id !== currentCentre && (
            <button
              type="button"
              className="crisis-panel-link"
              onClick={() => {
                setCentre(preferredCentre.id);
                setCentreSaved(false);
              }}
            >
              Choose {preferredCentre.name}
            </button>
          )}
          {lookups.isPending && (
            <small className="muted" role="status">
              Loading response centres…
            </small>
          )}
          {lookups.error && (
            <ErrorState error={lookups.error} retry={() => void lookups.refetch()} />
          )}
          {centreWrite.error && (
            <p className="field-error" role="alert">
              {errorMessage(centreWrite.error)}
            </p>
          )}
          {centreSaved && (
            <p className="success-text" role="status">
              Response centre saved.
            </p>
          )}
          <div className="crisis-response-actions">
            <Button
              variant="secondary"
              busy={centreWrite.isPending}
              disabled={!lookups.data || !!unavailableCentre}
            >
              Save response centre
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                areaWrite.reset();
                setShowAreaForm(true);
              }}
            >
              Operational areas
            </Button>
            <Button type="button" variant="secondary" onClick={onEnd}>
              End response
            </Button>
          </div>
        </form>
        <div className="crisis-areas">
          <h4>
            <MapPin size={16} aria-hidden="true" />
            Operational areas{areas.data ? ` (${areas.data.length})` : ''}
          </h4>
          {areas.isPending && (
            <small className="muted" role="status">
              Loading areas…
            </small>
          )}
          {areas.error && <ErrorState error={areas.error} retry={() => void areas.refetch()} />}
          <div className="crisis-area-chips">
            {areas.data?.map((area) => (
              <span className="crisis-area-chip" key={area.id}>
                {area.name}
                <button
                  type="button"
                  aria-label={`Remove operational area ${area.name}`}
                  onClick={() => {
                    areaWrite.reset();
                    setRemoveArea(area);
                  }}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </span>
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                areaWrite.reset();
                setShowAreaForm(true);
              }}
            >
              <Plus size={14} aria-hidden="true" />
              Add area
            </Button>
          </div>
        </div>
      </div>
      <aside className="crisis-snapshot" aria-label="Response snapshot">
        <h3>
          <ChartNoAxesColumnIncreasing size={17} aria-hidden="true" />
          Response snapshot
        </h3>
        <dl>
          <div>
            <dt>
              <MapPin size={15} aria-hidden="true" />
              Operational areas
            </dt>
            <dd>{areas.data?.length ?? '—'}</dd>
          </div>
          <div>
            <dt>
              <House size={15} aria-hidden="true" />
              Active shelters
            </dt>
            <dd>{snapshot.data?.activeShelters.toLocaleString() ?? '—'}</dd>
          </div>
          <div>
            <dt>
              <Users size={15} aria-hidden="true" />
              People sheltered
            </dt>
            <dd>{snapshot.data?.shelteredPeople.toLocaleString() ?? '—'}</dd>
          </div>
          <div>
            <dt>
              <Clock size={15} aria-hidden="true" />
              Last updated
            </dt>
            <dd>
              {lastUpdated ? (
                <time
                  dateTime={lastUpdated.toISOString()}
                  title={lastUpdated.toLocaleString('en-GB')}
                >
                  {lastUpdatedText}
                </time>
              ) : (
                'Unavailable'
              )}
            </dd>
          </div>
        </dl>
        {snapshot.isPending && (
          <small className="muted" role="status">
            Loading shelter figures…
          </small>
        )}
        {snapshot.error && (
          <button
            type="button"
            className="crisis-panel-link"
            onClick={() => void snapshot.refetch()}
          >
            Retry shelter figures
          </button>
        )}
      </aside>
      {showAreaForm && (
        <WorkspaceDialog
          title="Operational areas"
          context={crisis.name}
          className="crisis-dialog"
          busy={areaWrite.isPending}
          onDismiss={() => setShowAreaForm(false)}
        >
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              areaWrite.mutate(
                {
                  path: `/crises/${crisis.id}/areas`,
                  data: Object.fromEntries(new FormData(event.currentTarget)),
                },
                { onSuccess: () => setShowAreaForm(false) },
              );
            }}
          >
            <Field label="Area name">
              <input name="name" maxLength={150} required />
            </Field>
            <Field label="GeoJSON Polygon or MultiPolygon">
              <textarea name="geoJson" rows={4} maxLength={4000} required />
            </Field>
            {areaWrite.error && (
              <p className="field-error" role="alert">
                {errorMessage(areaWrite.error)}
              </p>
            )}
            <div className="organisation-dialog-actions">
              <Button busy={areaWrite.isPending}>Add operational area</Button>
            </div>
          </form>
        </WorkspaceDialog>
      )}
      {removeArea && (
        <WorkspaceDialog
          title="Remove operational area?"
          context={`${crisis.name} · ${removeArea.name}`}
          className="crisis-dialog"
          busy={areaWrite.isPending}
          onDismiss={() => setRemoveArea(undefined)}
        >
          <p>
            This removes the area from the response. Areas linked to a logistics order are kept for
            its history.
          </p>
          {areaWrite.error && (
            <p className="field-error" role="alert">
              {errorMessage(areaWrite.error)}
            </p>
          )}
          <div className="organisation-dialog-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={areaWrite.isPending}
              onClick={() => setRemoveArea(undefined)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              busy={areaWrite.isPending}
              onClick={() =>
                areaWrite.mutate(
                  {
                    path: `/crises/${crisis.id}/areas/${removeArea.id}`,
                    method: 'delete',
                  },
                  { onSuccess: () => setRemoveArea(undefined) },
                )
              }
            >
              Remove area
            </Button>
          </div>
        </WorkspaceDialog>
      )}
    </div>
  );
}
