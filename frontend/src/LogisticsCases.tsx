import CaseItems from './LogisticsCaseItems';
import { allocationLimit, allocationPath, groupAllocationSources, type AllocationSource } from './allocationSources';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  CalendarCheck,
  CircleCheck,
  ClipboardList,
  Info,
  PackageCheck,
  Search,
  TriangleAlert,
  Truck,
} from 'lucide-react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, errorMessage, get } from './api';
import {
  Badge,
  Button,
  Card,
  categories,
  ErrorState,
  Field,
  formatDate,
  Loading,
} from './components';
import { useCountry } from './geography';
import { LogisticsDialogs, ReleaseReservationButton } from './LogisticsDialogs';
import { CaseDispatches } from './CaseDispatches';
import {
  inventoryForCase,
  shipmentCode,
  shipmentStatus,
  type Shipment,
  type ShipmentAction,
} from './logistics';
import {
  casesHref,
  fulfillmentStage,
  inventoryHref,
  LogisticsHeader,
  LogisticsHeading,
  quantityText,
  remainingNeed,
  stages,
  supplyHref,
  useFulfillmentCases,
  useLogisticsData,
  type FulfillmentCase,
} from './LogisticsUi';
import { convertCompatibleQuantity, isMeasuredUnit, unitSymbol } from './quantity';
import './admin-logistics.css';

const stageIcons = [Box, CalendarCheck, PackageCheck, Truck, PackageCheck, CircleCheck];
const caseAction = {
  'Pending allocation': 'Review stock',
  Reserved: 'Review reservation',
  'Ready to dispatch': 'Prepare dispatch',
  'In transit': 'Review shipment',
  'At centre': 'Review centre handover',
  Completed: 'View case',
};
const priorities = ['Critical', 'Urgent', 'High', 'Medium', 'Normal', 'Low'];
const awaitingStock = 'Awaiting stock';

export default function LogisticsCases() {
  const { id } = useParams();
  return id ? <CaseFulfillmentDetail key={id} id={id} /> : <CaseFulfillmentQueue />;
}

function CaseFulfillmentQueue() {
  const { t } = useTranslation();
  const cases = useFulfillmentCases();
  const stock = useLogisticsData();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const search = params.get('q') ?? '';
  const priority = params.get('priority') ?? '';
  const category = params.get('category') ?? '';
  const requestedPage = Math.max(1, Math.floor(Number(params.get('page')) || 1));
  const setFilter = (key: string, value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (key !== 'page') next.delete('page');
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const rows = cases.data ?? [];
  const term = search.trim().toLowerCase();
  const staged = rows.filter((row) => (
      (!priority || row.priority === priority) &&
      (!category ||
        row.category === category ||
        !!row.items?.some((item) => item.category === category)) &&
      [
        row.reference,
        row.legacyReference,
        row.region,
        t(`category.${row.category}`),
        ...(row.items?.map((item) => item.name) ?? []),
      ].some((value) => value?.toLowerCase().includes(term))
  )).map(row => ({ row, stage: fulfillmentStage(row) }));
  const filtered = staged.filter(({ stage }) => !status || stage === status ||
    (status === awaitingStock && (stage === 'Pending allocation' || stage === 'Reserved')));
  const releasedCases = new Set(stock.data?.orders.filter(order => order.status === 'Cancelled').map(order => order.requestId));
  const pages = Math.max(1, Math.ceil(filtered.length / 12));
  const page = Math.min(requestedPage, pages);
  const start = (page - 1) * 12;
  const queue = casesHref(undefined, Object.fromEntries(params.entries()));
  return (
    <div className="logistics-page">
      <LogisticsHeader
        title="Case fulfillment queue"
        description="Reserve, dispatch and confirm delivery for approved cases assigned to your organisation."
      />
      {cases.error ? (
        <ErrorState error={cases.error} retry={() => void cases.refetch()} />
      ) : cases.isPending ? (
        <Loading />
      ) : (
        <>
          <div className="logistics-kpis" role="group" aria-label="Case fulfillment stages">
            {stages.map((stage, index) => {
              const Icon = stageIcons[index];
              return (
                <button
                  type="button"
                  className="logistics-stage logistics-kpi"
                  aria-pressed={stage === status}
                  key={stage}
                  onClick={() => setFilter('status', stage === status ? '' : stage)}
                >
                  <span
                    className="logistics-icon"
                    data-tone={stage === 'Completed' ? 'green' : 'blue'}
                  >
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <span className="logistics-stage-content">
                    <span>{stage}</span>
                    <strong>{staged.filter(entry => entry.stage === stage).length}</strong>
                  </span>
                </button>
              );
            })}
          </div>
          <Card className="logistics-filters">
            <Field label="Urgency">
              <select value={priority} onChange={(e) => setFilter('priority', e.target.value)}>
                <option value="">All priorities</option>
                {priorities.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </Field>
            <Field label="Fulfillment status">
              <select value={status} onChange={(e) => setFilter('status', e.target.value)}>
                <option value="">All statuses</option>
                {[awaitingStock, ...stages].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </Field>
            <Field label="Aid category">
              <select value={category} onChange={(e) => setFilter('category', e.target.value)}>
                <option value="">All categories</option>
                {categories
                  .filter((value) => value !== 'Shelter')
                  .map((value) => (
                    <option key={value} value={value}>
                      {t(`category.${value}`)}
                    </option>
                  ))}
              </select>
            </Field>
            <Field
              label="Search cases"
              endAdornment={
                <Search className="logistics-filter-icon" size={16} aria-hidden="true" />
              }
            >
              <input
                type="search"
                placeholder="Case ID, region or aid category"
                value={search}
                onChange={(e) => setFilter('q', e.target.value)}
              />
            </Field>
          </Card>
          <div className="logistics-columns logistics-queue-columns">
            <Card className="logistics-table-card">
              {stock.error && <ErrorState error={stock.error} retry={() => void stock.refetch()} />}
              {filtered.length > 0 ? (
                <div
                  className="logistics-table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label="Case results"
                >
                  <table className="logistics-table" aria-label="Case fulfillment queue">
                    <thead>
                      <tr>
                        {[
                          'Case ID',
                          'Approved need',
                          'Urgency',
                          'Stock match',
                          'Fulfillment',
                          'Delivery region',
                          'Action',
                        ].map((label) => (
                          <th scope="col" key={label}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice(start, start + 12).map(({ row, stage }) => {
                        const remaining = remainingNeed(row);
                        const unit = row.unit;
                        const match =
                          !row.needCount && unit && stock.data
                            ? inventoryForCase(stock.data, row.crisisId)
                                .filter(
                                  (item) =>
                                    item.transportAvailable &&
                                    item.canShip !== false &&
                                    item.category === row.category,
                                )
                                .reduce(
                                  (sum, item) =>
                                    sum +
                                    convertCompatibleQuantity(item.available, item.unit, unit),
                                  0,
                                )
                            : undefined;
                        return (
                          <tr key={row.id}>
                            <th scope="row">
                              {row.reference}
                              {row.synthetic && <small>Test request</small>}
                            </th>
                            <td className="logistics-need">
                              {row.items?.length ? (
                                row.items.map((item) => (
                                  <span key={item.id}>
                                    {item.name}
                                    <small>
                                      Required {quantityText(item.requiredQuantity, item.unit)} ·
                                      Approved {quantityText(item.approvedQuantity, item.unit)}
                                    </small>
                                  </span>
                                ))
                              ) : (
                                <>
                                  {t(`category.${row.category}`)}
                                  <small>
                                    {row.needCount
                                      ? `${row.needCount} approved items`
                                      : quantityText(row.quantity, row.unit)}
                                    {!row.unit && ' · Unit unconfirmed'}
                                  </small>
                                </>
                              )}
                            </td>
                            <td>
                              <Badge value={row.priority} />
                            </td>
                            <td>
                              {row.needCount
                                ? 'Review item stock'
                                : remaining === 0
                                  ? stage === 'Completed'
                                    ? 'Delivered'
                                    : 'Committed'
                                  : !row.unit
                                    ? 'Unit needed'
                                    : match == null
                                      ? 'Unavailable'
                                      : match >= remaining
                                        ? 'Potential full match'
                                        : match > 0
                                          ? 'Partial match'
                                          : 'No available match'}
                              {remaining > 0 && match != null && (
                                <small>{quantityText(match, row.unit)} in depot stock</small>
                              )}
                            </td>
                            <td>
                              {stage}
                              {stage === 'Pending allocation' && releasedCases.has(row.id) && <small>Stock released to depot</small>}
                            </td>
                            <td>{row.region ?? 'Region unavailable'}</td>
                            <td>
                              <Link
                                className="logistics-link"
                                to={casesHref(row.id)}
                                state={{ caseQueue: queue }}
                              >
                                {caseAction[stage]}
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="logistics-empty">
                  {rows.length
                    ? 'No approved cases match these filters.'
                    : 'There are no approved stock fulfillment cases in your scope.'}
                </p>
              )}
              {pages > 1 && (
                <div className="logistics-pagination">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={page === 1}
                    onClick={() => setFilter('page', String(page - 1))}
                  >
                    Previous
                  </Button>
                  <span>
                    Page {page} of {pages}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={page === pages}
                    onClick={() => setFilter('page', String(page + 1))}
                  >
                    Next
                  </Button>
                </div>
              )}
            </Card>
            <Card>
              <LogisticsHeading icon={Info}>Fulfillment handoff</LogisticsHeading>
              <ul className="logistics-list">
                <li>
                  <strong>Pending allocation</strong>
                  <small>Review compatible depot stock for approved demand.</small>
                </li>
                <li>
                  <strong>Reserved</strong>
                  <small>Part of the remaining requirement is held.</small>
                </li>
                <li>
                  <strong>Ready to dispatch</strong>
                  <small>
                    Send packed items to the receiving centre. Outstanding items can go in a later dispatch.
                  </small>
                </li>
                <li>
                  <strong>In transit</strong>
                  <small>Record what reached the centre, including any shortages.</small>
                </li>
                <li><strong>At centre</strong><small>The Volunteer Coordinator can assign the collected items for citizen handover.</small></li>
              </ul>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

interface CaseAllocation {
  id: string;
  caseDispatchId?: string | null;
  reference?: string;
  resourceId: string;
  name: string;
  depot: string;
  unit: string;
  quantity: number;
  requestQuantity: number | null;
  status: Shipment['status'];
  createdAt: string;
  updatedAt: string;
  confirmedQuantity: number | null;
  hasException: boolean;
  packedAt: string | null;
  scheduledArrivalAt: string | null;
}
interface CaseDetail {
  case: FulfillmentCase;
  allocations: CaseAllocation[];
  history: { id: string; status: string; createdAt: string }[];
}
interface Recommendations {
  outstanding: number;
  candidates: {
    resourceId: string;
    name: string;
    unit: string;
    available: number;
    suggestedQuantity: number;
    transportAvailable: boolean;
    score?: number;
    reason?: string;
  }[];
  shortageExplanation: string;
  evidence?: import('./types').FulfilmentEvidence;
}

function CaseFulfillmentDetail({ id }: { id: string }) {
  const country = useCountry();
  const { t } = useTranslation();
  const client = useQueryClient();
  const { state, search } = useLocation();
  const selectedDispatchId = new URLSearchParams(search).get('dispatch');
  const queue =
    typeof state?.caseQueue === 'string' && state.caseQueue.startsWith('/staff/cases?')
      ? state.caseQueue
      : casesHref();
  const detail = useQuery({
    queryKey: ['logistics-case', country, id],
    queryFn: () => get<CaseDetail>(`/logistics/cases/${id}`),
  });
  const stock = useLogisticsData();
  const row = detail.data?.case;
  const canReserve =
    !row?.needCount &&
    (!row?.requiresCoordinatorAuthorization || !!row.authorizedAt) &&
    !!row?.unit &&
    fulfillmentStage(row) !== 'Completed' &&
    remainingNeed(row) > 0;
  const rec = useQuery({
    queryKey: ['logistics-case-recommendations', country, id],
    queryFn: () => get<Recommendations>(`/requests/${id}/allocation-recommendations`),
    enabled: canReserve,
    refetchInterval: query => ['Queued', 'Processing'].includes(query.state.data?.evidence?.processingState ?? '') ? 2000 : false,
  });
  const [resourceId, setResource] = useState('');
  const [operationId, setOperation] = useState(() => crypto.randomUUID());
  const [transition, setTransition] = useState<{ order: Shipment; action: ShipmentAction } | null>(
    null,
  );
  const [notice, setNotice] = useState('');
  const reserve = useMutation({
    mutationFn: ({ quantity, source }: { quantity: number; source: AllocationSource }) =>
      api.post(allocationPath(source), { requestId: id, resourceId: source.id, quantity, operationId }),
    onSuccess: async () => {
      setOperation(crypto.randomUUID());
      setResource('');
      setNotice('Stock reserved for this case.');
      await client.invalidateQueries();
    },
  });
  if (detail.isError)
    return (
      <div className="logistics-page">
        <Link to={queue}>Back to fulfillment queue</Link>
        <ErrorState error={detail.error} retry={() => void detail.refetch()} />
      </div>
    );
  if (!row || !detail.data) return <Loading />;
  const candidates = rec.data?.candidates.filter((candidate) => candidate.transportAvailable) ?? [];
  const inventory = new Map((stock.data ? inventoryForCase(stock.data, row.crisisId) : []).map(item => [item.id, item]));
  const depots = stock.data?.resourceRegistration?.depots ?? stock.data?.depots;
  const sources = groupAllocationSources(candidates.map(candidate => ({
    ...inventory.get(candidate.resourceId), id: candidate.resourceId, name: candidate.name,
    unit: candidate.unit, available: candidate.available,
  })));
  const selected = sources.find(source => source.resourceIds.includes(resourceId));
  const limit = selected && row.unit ? allocationLimit(selected, remainingNeed(row), row.unit) : 0;
  const shortageLink = supplyHref({
    case: row.id,
    organisation: row.organisationId,
    category: row.category,
    unit: row.unit ?? '',
    quantity: String(remainingNeed(row)),
  });
  const startAction = (allocation: CaseAllocation, action: ShipmentAction) => {
    setNotice('');
    setTransition({
      action,
      order: {
        id: allocation.id,
        kind: 'Dispatch',
        resourceId: allocation.resourceId,
        destinationResourceId: null,
        crisisId: row.crisisId,
        requestId: id,
        origin: allocation.depot,
        destination: row.region ?? row.reference,
        quantity: allocation.quantity,
        status: allocation.status,
        actorId: '',
        reason: '',
        createdAt: allocation.createdAt,
        updatedAt: allocation.updatedAt,
        resourceUnit: allocation.unit,
        packedAt: allocation.packedAt,
      },
    });
  };
  const stage = fulfillmentStage(row);
  const approvedNeed = (
    <Card>
      <LogisticsHeading icon={Box}>Approved need</LogisticsHeading>
      <p>
        {t(`category.${row.category}`)} ·{' '}
        <strong>{row.needCount ? `${row.needCount} approved items` : quantityText(row.quantity, row.unit)}</strong>
      </p>
      {!row.needCount && (
        <p className="muted">
          {quantityText(row.deliveredQuantity, row.unit)} delivered ·{' '}
          {quantityText(row.reservedQuantity, row.unit)} held ·{' '}
          {quantityText(row.inTransitQuantity, row.unit)} {row.requiresCentreHandover ? 'committed to a dispatch' : 'in transit'}
        </p>
      )}
      {!row.needCount && !row.unit && (
        <p role="status">
          The case team needs to confirm the requested unit before dispatch or further reservations.
        </p>
      )}
    </Card>
  );
  return (
    <div className={`logistics-page${row.needCount ? ' logistics-item-case' : ''}`}>
      <LogisticsHeader
        title={row.reference}
        description={
          <span className="logistics-case-summary">
            <span>{row.region ?? 'Delivery region unavailable'}{row.synthetic && ' · Test request'}</span>
            <span className="logistics-status logistics-case-pill" data-status={
              stage === 'Pending allocation' ? 'Low stock' : stage === 'Completed' ? 'Delivered' : stage
            }>
              {stage === 'Pending allocation' && <TriangleAlert size={17} aria-hidden="true" />}{stage}
            </span>
          </span>
        }
        actions={<Link to={queue}>Back to fulfillment queue</Link>}
      />
      {notice && (
        <p className="organisation-notice" role="status">
          {notice}
        </p>
      )}
      {row.requiresCoordinatorAuthorization && !row.authorizedAt && (
        <p className="organisation-notice" role="status">Awaiting Coordinator authorization before reserving stock.</p>
      )}
      {row.requiresCentreHandover && <CaseDispatches id={id} mode="logistics" authorized={!!row.authorizedAt}
        selectedDispatchId={selectedDispatchId}
        packed={detail.data.allocations.filter(item => item.status === 'Reserved' && !!item.packedAt && item.requestQuantity != null)} />}
      {row.needCount ? (
        <CaseItems
          id={id}
          crisisId={row.crisisId}
          needs={row.items ?? []}
          authorized={!row.requiresCoordinatorAuthorization || !!row.authorizedAt}
          centreHandover={row.requiresCentreHandover}
          onNotice={setNotice}
        />
      ) : null}
      <div className="logistics-columns">
        <div className="stack">
          {!row.needCount && approvedNeed}
          {canReserve && (
            <Card>
              <LogisticsHeading
                icon={PackageCheck}
                href={inventoryHref({ tab: 'inventory' })}
                linkText="View inventory"
              >
                Reserve inventory
              </LogisticsHeading>
              {rec.isPending ? (
                <Loading />
              ) : rec.error ? (
                <ErrorState error={rec.error} retry={() => void rec.refetch()} />
              ) : (
                <>
                  <p>Awaiting allocation · {quantityText(remainingNeed(row), row.unit)}</p>
                  {rec.data?.shortageExplanation && (
                    <p className="logistics-freshness">{rec.data.shortageExplanation}</p>
                  )}
                  {rec.data?.evidence && <p className="logistics-freshness">
                    {rec.data.evidence.algorithm} · {rec.data.evidence.source} · {rec.data.evidence.processingState} · {rec.data.evidence.reviewState}
                  </p>}
                  {candidates.length > 0 && <details className="stack">
                    <summary>Compare resource matches</summary>
                    {candidates.map(candidate => <p key={candidate.resourceId}>
                      <strong>{candidate.name}{candidate.score != null && ` · Score ${candidate.score}`}</strong> {candidate.reason}
                    </p>)}
                  </details>}
                  {sources.length > 0 ? (
                    <form
                      className="form-grid"
                      onSubmit={(event: FormEvent<HTMLFormElement>) => {
                        event.preventDefault();
                        const value = Number(new FormData(event.currentTarget).get('quantity'));
                        if (
                          !reserve.isPending &&
                          selected &&
                          value > 0 &&
                          value <= limit
                        )
                          reserve.mutate({ quantity: value, source: selected });
                      }}
                    >
                      <Field label="Stock source">
                        <select
                          required
                          value={selected?.id ?? ''}
                          disabled={reserve.isPending}
                          onChange={(event) => {
                            setResource(event.target.value);
                            setOperation(crypto.randomUUID());
                            reserve.reset();
                            setNotice('');
                          }}
                        >
                          <option value="">Choose compatible inventory</option>
                          {sources.map(source => {
                            const depot = depots?.find(item => item.id === source.depotId)?.name ?? source.locationText;
                            return <option value={source.id} key={source.id}>
                              {source.name}{depot ? ` · ${depot}` : ''} · {quantityText(source.available, source.unit)}
                              {source.resourceIds.includes(candidates[0].resourceId) ? ' · Recommended' : ''}
                            </option>;
                          })}
                        </select>
                      </Field>
                      <Field
                        label={selected ? `Quantity (${unitSymbol(selected.unit)})` : 'Quantity'}
                        hint={
                          selected
                            ? `Up to ${quantityText(limit, selected.unit)}`
                            : undefined
                        }
                      >
                        <input
                          key={selected?.id}
                          name="quantity"
                          type="number"
                          required
                          disabled={!selected || limit <= 0 || reserve.isPending}
                          min={selected && isMeasuredUnit(selected.unit) ? 0.01 : 1}
                          max={limit}
                          step={selected && isMeasuredUnit(selected.unit) ? 0.01 : 1}
                          onChange={() => {
                            setOperation(crypto.randomUUID());
                            reserve.reset();
                          }}
                        />
                      </Field>
                      <Button disabled={!selected || limit <= 0} busy={reserve.isPending}>
                        Reserve stock
                      </Button>
                    </form>
                  ) : (
                    <p className="logistics-empty">
                      No compatible transport-ready stock is available for this case.
                    </p>
                  )}
                  {reserve.error && (
                    <p role="alert" className="field-error">
                      {errorMessage(reserve.error)}{' '}
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => void client.invalidateQueries()}
                      >
                        Refresh case and stock
                      </Button>
                    </p>
                  )}
                  <Link className="logistics-link" to={shortageLink}>
                    Request supply support
                  </Link>
                </>
              )}
            </Card>
          )}
          <Card className="logistics-case-shipments">
            <LogisticsHeading icon={Truck}>Reservations and dispatches</LogisticsHeading>
            {stock.error && <ErrorState error={stock.error} retry={() => void stock.refetch()} />}
            {detail.data.allocations.some(allocation => !allocation.caseDispatchId) ? (
              <ul className="logistics-list">
                {detail.data.allocations.filter(allocation => !allocation.caseDispatchId).map((allocation) => (
                  <li key={allocation.id}>
                    <div className="logistics-list-row">
                      <div>
                        <strong>{allocation.name}</strong>
                        <small>
                          {quantityText(allocation.quantity, allocation.unit)} · {allocation.depot}{' '}
                          ·{' '}
                          {allocation.status === 'Reserved'
                            ? 'Reserved'
                            : shipmentStatus[allocation.status]}
                        </small>
                        {allocation.confirmedQuantity != null && (
                          <small>
                            Confirmed {quantityText(allocation.confirmedQuantity, allocation.unit)}
                            {allocation.hasException && ' · Exception recorded'}
                          </small>
                        )}
                      </div>
                      <Link
                        to={inventoryHref({
                          tab: allocation.status === 'Reserved' ? 'reservations' : 'dispatches',
                          record: allocation.id,
                        })}
                      >
                        {shipmentCode({ ...allocation, kind: 'Dispatch' })}
                      </Link>
                    </div>
                    <div className="logistics-header-actions">
                      {stock.data && allocation.status === 'Reserved' && (
                        <>
                          {(row.unit || row.needCount) && allocation.requestQuantity != null &&
                            (!row.requiresCentreHandover || !allocation.packedAt) && (
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() =>
                                startAction(
                                  allocation,
                                  allocation.packedAt ? 'dispatch' : 'prepare',
                                )
                              }
                            >
                              {allocation.packedAt
                                ? 'Dispatch packed stock'
                                : 'Confirm packing & schedule'}
                            </Button>
                          )}
                          {row.requiresCentreHandover && allocation.packedAt && <small>Packed for the next dispatch</small>}
                          <ReleaseReservationButton id={allocation.id} caseAllocation onNotice={setNotice} />
                        </>
                      )}
                      {stock.data &&
                        allocation.status === 'Dispatched' &&
                        (row.unit || row.needCount) &&
                        allocation.requestQuantity != null && (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => startAction(allocation, 'deliver')}
                          >
                            Confirm delivery or exception
                          </Button>
                        )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="logistics-empty">
                No reservation or dispatch records are available to you for this case.
              </p>
            )}
          </Card>
          {!!row.needCount && approvedNeed}
        </div>
        <Card>
          <LogisticsHeading icon={ClipboardList}>Status history</LogisticsHeading>
          {detail.data.history.length ? (
            <ol className="logistics-list">
              {detail.data.history.map((event) => (
                <li key={event.id}>
                  <strong>{t(`status.${event.status}`, { defaultValue: event.status.replace(/([a-z])([A-Z])/g, '$1 $2') })}</strong>
                  <small>{formatDate(event.createdAt)}</small>
                </li>
              ))}
            </ol>
          ) : (
            <p className="logistics-empty">No status history has been recorded.</p>
          )}
        </Card>
      </div>
      {transition && stock.data && (
        <LogisticsDialogs
          state={{ kind: 'transition', ...transition }}
          data={stock.data}
          defaultCountry={country}
          change={() => undefined}
          close={() => setTransition(null)}
          saved={(message) => {
            setNotice(message);
            setTransition(null);
          }}
        />
      )}
    </div>
  );
}
