import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Boxes, ClipboardList } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, errorMessage, get } from './api';
import { Button, Card, categories, ErrorState, Field, formatDate, Loading } from './components';
import { useCountry } from './geography';
import {
  hasStockAlert,
  inventoryStatus,
  resourceCode,
  stockGap,
  type InventoryItem,
  type LogisticsData,
} from './logistics';
import {
  casesHref,
  inventoryHref,
  LogisticsHeader,
  LogisticsHeading,
  quantityText,
  useLogisticsData,
} from './LogisticsUi';
import { WorkspaceDialog } from './OrganisationDialog';
import { compatibleUnits, convertCompatibleQuantity, isMeasuredUnit } from './quantity';
import { ContributionReceipt, SupplyReferenceSearch } from './SupplySupport';
import type { Category } from './types';
import './admin-logistics.css';

interface Organisation {
  id: string;
  name: string;
}
interface SupplyRow {
  id: string;
  reference: string;
  requestingOrganisationId: string;
  targetOrganisationId: string;
  category: Category;
  unit: string;
  quantity: number;
  receivedQuantity: number;
  reason: string;
  cancelled: boolean;
  createdAt: string;
  updatedAt: string;
  resourceName: string | null;
  destination: string | null;
}
interface Commitment {
  id: string;
  supportRequestId: string;
  title: string;
  quantity: number;
  unit: string;
  status: 'Offered' | 'Accepted' | 'InProgress' | 'Fulfilled' | 'Declined' | 'Withdrawn';
  createdAt: string;
  updatedAt: string;
}
interface SupportData {
  requests: SupplyRow[];
  organisations: Organisation[];
  requestingOrganisations: Organisation[];
  receivableCommitments: Commitment[];
  commitments: Commitment[];
  receipts: {
    id: string;
    contributionId: string;
    quantity: number;
    reference: string;
    createdAt: string;
  }[];
  events: { id: string; contributionId: string; status: Commitment['status']; createdAt: string }[];
}
const offerLabel = {
  Offered: 'Offer awaiting review',
  Accepted: 'Accepted offer',
  InProgress: 'Partner fulfillment in progress',
  Fulfilled: 'Fulfilled by partner',
  Declined: 'Offer declined',
  Withdrawn: 'Offer withdrawn',
};
const requestStates = [
  'Submitted',
  ...Object.values(offerLabel),
  'Partially received',
  'Received',
  'Cancelled',
];
function requestState(row: SupplyRow, offers: Commitment[]) {
  if (row.cancelled) return 'Cancelled';
  if (row.receivedQuantity >= row.quantity) return 'Received';
  if (row.receivedQuantity > 0) return 'Partially received';
  const state = (['Fulfilled', 'InProgress', 'Accepted', 'Offered'] as const).find((status) =>
    offers.some((offer) => offer.status === status),
  );
  const latest = [...offers].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return state ? offerLabel[state] : latest ? offerLabel[latest.status] : 'Submitted';
}

export default function LogisticsSupplySupport() {
  const country = useCountry();
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const inventory = useLogisticsData();
  const supply = useQuery({
    queryKey: ['logistics-supply', country, search],
    queryFn: () => get<SupportData>(`/supply-support/${country}${search ? '?search=' + encodeURIComponent(search) : ''}`),
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === country ? previous : undefined,
  });
  const failure = supply.error ?? inventory.error;
  return (
    <div className="logistics-page">
      <LogisticsHeader
        title="Supply support"
        description="Request supplies from verified organisations and reconcile receipts at your depots."
      />
      {failure ? (
        <ErrorState
          error={failure}
          retry={() => {
            void supply.refetch();
            void inventory.refetch();
          }}
        />
      ) : supply.data && inventory.data ? (
        <SupplyWorkspace
          key={params.toString()}
          data={supply.data}
          stock={inventory.data}
          params={params}
          search={search}
          onSearch={setSearch}
        />
      ) : (
        <Loading />
      )}
    </div>
  );
}

function SupplyWorkspace({
  data,
  stock,
  params,
  search,
  onSearch,
}: {
  data: SupportData;
  stock: LogisticsData;
  params: URLSearchParams;
  search: string;
  onSearch: (search: string) => void;
}) {
  const country = useCountry();
  const { t } = useTranslation();
  const client = useQueryClient();
  const caseId = params.get('case');
  const caseUnit = params.get('unit');
  const caseQuantity = Number(params.get('quantity'));
  const initialResource = stock.inventory.find(
    (row) => row.id === params.get('resource') && row.depotId && row.canShip !== false,
  );
  const [orgId, setOrg] = useState(
    initialResource?.organisationId ??
      params.get('organisation') ??
      data.requestingOrganisations[0]?.id ??
      '',
  );
  const [category, setCategory] = useState(
    initialResource?.category ?? params.get('category') ?? '',
  );
  const [name, setName] = useState(initialResource?.name ?? '');
  const [resourceId, setResource] = useState(initialResource?.id ?? '');
  const [target, setTarget] = useState('');
  const [quantity, setQuantity] = useState('');
  const [operation, setOperation] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const org = data.requestingOrganisations.find((row) => row.id === orgId);
  const orgName = (id: string) =>
    data.organisations.find((row) => row.id === id)?.name ?? 'Organisation unavailable';
  const depotName = (row: InventoryItem) =>
    stock.depots.find((depot) => depot.id === row.depotId)?.name ?? row.locationText;
  const partners = data.organisations.filter((row) => row.id !== org?.id);
  const compatible = stock.inventory.filter(
    (item) =>
      item.organisationId === org?.id &&
      item.depotId &&
      item.canShip !== false &&
      (!caseId ||
        (item.category === params.get('category') && compatibleUnits(item.unit, caseUnit))),
  );
  const hasCaseStock = !!stock.caseInventory?.some(item => !org || item.organisationId === org.id);
  const types = categories.filter((value) => compatible.some((item) => item.category === value));
  const names = [
    ...new Set(compatible.filter((item) => item.category === category).map((item) => item.name)),
  ];
  const destinations = compatible.filter(
    (item) => item.category === category && item.name === name,
  );
  const item = destinations.find((item) => item.id === resourceId);
  const gaps = stock.inventory.filter(hasStockAlert);
  const detail = data.requests.find((row) => row.id === selectedId);
  const offersFor = (id: string) =>
    data.commitments.filter((offer) => offer.supportRequestId === id);
  const rows = data.requests.filter(
    (row) => !status || status === requestState(row, offersFor(row.id)),
  );
  const maxPage = Math.max(1, Math.ceil(rows.length / 8));
  const current = Math.min(page, maxPage);
  const start = (current - 1) * 8;
  const write = useMutation({
    mutationFn: (reason: string) =>
      api.post(`/supply-support/${country}`, {
        operationId: operation,
        requestingOrganisationId: org?.id,
        targetOrganisationId: target,
        caseId,
        category: item?.category,
        unit: item?.unit,
        quantity: Number(quantity),
        reason,
        destinationResourceId: item?.id,
      }),
    onSuccess: async (result) => {
      setOperation(crypto.randomUUID());
      setQuantity('');
      setPage(1);
      setStatus('');
      await client.invalidateQueries();
      setSelectedId(result.data.id);
    },
  });
  const resetOperation = () => {
    setOperation(crypto.randomUUID());
    write.reset();
  };
  const fillGap = (gap: InventoryItem) => {
    setOrg(gap.organisationId);
    setCategory(gap.category);
    setName(gap.name);
    setResource(gap.id);
    setTarget('');
    setQuantity(stockGap(gap) ? String(stockGap(gap)) : '');
    resetOperation();
    document.getElementById('new-supply-request')?.focus();
  };
  const maxQuantity =
    item && caseId && caseUnit && caseQuantity > 0
      ? Math.min(
          1e7,
          Math.floor(
            convertCompatibleQuantity(caseQuantity, caseUnit, item.unit) *
              (isMeasuredUnit(item.unit) ? 100 : 1),
          ) / (isMeasuredUnit(item.unit) ? 100 : 1),
        )
      : 1e7;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!item || !org || !partners.some((partner) => partner.id === target) || write.isPending)
      return;
    write.mutate(String(new FormData(event.currentTarget).get('reason') ?? '').trim());
  };
  return (
    <>
      <div className="logistics-columns">
        <div tabIndex={-1} id="new-supply-request">
          <Card>
            <LogisticsHeading icon={Boxes}>New supply request</LogisticsHeading>
            {caseId && (
              <p className="logistics-section-note">
                Request stock for this approved <Link to={casesHref(caseId)}>fulfillment case</Link>
                . The current outstanding need limits the quantity.
              </p>
            )}
            {(!org || !compatible.length) && hasCaseStock ? (
              <p className="logistics-empty">
                You can reserve crisis-assigned stock in <Link to={casesHref()}>Case Fulfillment</Link>.
                Receiving supplies requires access to manage stock at the receiving depot.
                Ask a logistics officer with that access to record the receipt.
              </p>
            ) : !org ? (
              <p className="logistics-empty">
                A verified organisation assignment is required to request supplies.
              </p>
            ) : !compatible.length ? (
              <p className="logistics-empty">
                No compatible receiving inventory is registered for this organisation.{' '}
                <Link to={inventoryHref()}>Manage depot inventory</Link>.
              </p>
            ) : !partners.length ? (
              <p className="logistics-empty">
                No other verified supplying organisations are available in this country.
              </p>
            ) : (
              <form className="stack" onSubmit={submit} onChange={resetOperation}>
                <fieldset className="form-grid logistics-supply-fields" disabled={write.isPending}>
                  <Field label="Requesting organisation">
                    {data.requestingOrganisations.length === 1 || caseId ? (
                      <input readOnly value={org.name} />
                    ) : (
                      <select
                        value={org.id}
                        onChange={(event) => {
                          setOrg(event.target.value);
                          setCategory('');
                          setName('');
                          setResource('');
                          setTarget('');
                          setQuantity('');
                        }}
                      >
                        {data.requestingOrganisations.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field label="Supplying organisation">
                    <select required value={target} onChange={(e) => setTarget(e.target.value)}>
                      <option value="">Choose a verified organisation</option>
                      {partners.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Aid category">
                    <select
                      required
                      value={category}
                      onChange={(e) => {
                        setCategory(e.target.value);
                        setName('');
                        setResource('');
                        setQuantity('');
                      }}
                    >
                      <option value="">Choose a category</option>
                      {types.map((value) => (
                        <option key={value} value={value}>
                          {t(`category.${value}`)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Item">
                    <select
                      required
                      value={name}
                      disabled={!names.length}
                      onChange={(e) => {
                        setName(e.target.value);
                        setResource('');
                        setQuantity('');
                      }}
                    >
                      <option value="">Choose an inventory item</option>
                      {names.map((label) => (
                        <option key={label}>{label}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Unit">
                    <input readOnly value={item?.unit ?? ''} placeholder="Set by depot item" />
                  </Field>
                  <Field label="Delivery depot">
                    <select
                      required
                      value={resourceId}
                      disabled={!destinations.length}
                      onChange={(e) => {
                        setResource(e.target.value);
                        setQuantity('');
                      }}
                    >
                      <option value="">Choose a receiving inventory record</option>
                      {destinations.map((row) => (
                        <option key={row.id} value={row.id}>
                          {depotName(row)} · {row.unit}
                          {' · '}{resourceCode(row)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Quantity">
                    <input
                      required
                      type="number"
                      disabled={!item}
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      min={item && isMeasuredUnit(item.unit) ? 0.01 : 1}
                      max={maxQuantity}
                      step={item && isMeasuredUnit(item.unit) ? 0.01 : 1}
                    />
                  </Field>
                  <div className="logistics-wide">
                    <Field
                      label="Operational justification"
                      hint="Use stock and depot information only. The supplying organisation can read this."
                    >
                      <textarea name="reason" rows={3} maxLength={1000} required />
                    </Field>
                  </div>
                </fieldset>
                <Button busy={write.isPending} disabled={!item || !target}>
                  Submit supply request
                </Button>
              </form>
            )}
            {write.error && (
              <p role="alert" className="field-error">
                {errorMessage(write.error)}
              </p>
            )}
            {write.isSuccess && (
              <p role="status" className="organisation-notice">
                Supply request submitted.
              </p>
            )}
          </Card>
        </div>
        <Card>
          <LogisticsHeading icon={AlertTriangle} href={inventoryHref({ status: 'Stock alerts' })}>
            Current stock gaps
          </LogisticsHeading>
          {gaps.length ? (
            <ul className="logistics-list">
              {gaps.slice(0, 6).map((gap) => (
                <li className="logistics-list-row" key={gap.id}>
                  <div>
                    {!caseId &&
                    gap.depotId &&
                    gap.canShip !== false &&
                    data.requestingOrganisations.some((o) => o.id === gap.organisationId) ? (
                      <button className="logistics-link" type="button" onClick={() => fillGap(gap)}>
                        {gap.name}
                      </button>
                    ) : (
                      <Link to={inventoryHref({ record: gap.id })}>{gap.name}</Link>
                    )}
                    <small>
                      {depotName(gap)} · {inventoryStatus(gap)}
                    </small>
                    <small>
                      {quantityText(gap.available, gap.unit)} available ·{' '}
                      {quantityText(gap.reserved, gap.unit)} reserved
                    </small>
                  </div>
                  {stockGap(gap) > 0 && (
                    <span>{quantityText(stockGap(gap), gap.unit)} below threshold</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="logistics-empty">
              No threshold breaches or out-of-stock records at your locations.
            </p>
          )}
        </Card>
      </div>
      <Card>
        <LogisticsHeading icon={ClipboardList}>Supply requests</LogisticsHeading>
        <SupplyReferenceSearch search={search} onSearch={(value) => {
          setPage(1);
          onSearch(value);
        }} />
        <div className="logistics-history-filter">
          <Field label="Request status">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {requestStates.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
        </div>
        {rows.length ? (
          <div
            className="logistics-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Supply request history"
          >
            <table className="logistics-table" aria-label="Supply requests">
              <thead>
                <tr>
                  {[
                    'Reference',
                    'Supplying organisation',
                    'Item / quantity',
                    'Requested',
                    'Status',
                    'Action',
                  ].map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(start, start + 8).map((row) => (
                  <tr key={row.id}>
                    <th scope="row">{row.reference}</th>
                    <td>{orgName(row.targetOrganisationId)}</td>
                    <td>
                      {row.resourceName ?? t(`category.${row.category}`)}
                      <small>{quantityText(row.quantity, row.unit)}</small>
                    </td>
                    <td>{formatDate(row.createdAt)}</td>
                    <td>{requestState(row, offersFor(row.id))}</td>
                    <td>
                      <button
                        className="logistics-link"
                        type="button"
                        onClick={() => setSelectedId(row.id)}
                        aria-label={`View ${row.reference}`}
                      >
                        View details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="logistics-empty">
            {status || search
              ? 'No supply requests match your filters.'
              : 'No supply requests have been recorded in your scope.'}
          </p>
        )}
        {maxPage > 1 && (
          <div className="logistics-pagination">
            <Button
              type="button"
              variant="secondary"
              disabled={current === 1}
              onClick={() => setPage(current - 1)}
            >
              Previous
            </Button>
            <span>
              Page {current} of {maxPage}
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={current === maxPage}
              onClick={() => setPage(current + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </Card>
      {detail && (
        <SupplyDetail
          row={detail}
          supplier={orgName(detail.targetOrganisationId)}
          offers={offersFor(detail.id)}
          data={data}
          close={() => setSelectedId(null)}
        />
      )}
    </>
  );
}

function SupplyDetail({
  row,
  supplier,
  offers,
  data,
  close,
}: {
  row: SupplyRow;
  supplier: string;
  offers: Commitment[];
  data: SupportData;
  close: () => void;
}) {
  const country = useCountry();
  const { t } = useTranslation();
  const client = useQueryClient();
  const cancel = useMutation({
    mutationFn: (reason: string) =>
      api.post(`/supply-support/${country}/${row.id}/cancel`, { reason }),
    onSuccess: () => client.invalidateQueries(),
  });
  const receipts = data.receipts.filter((receipt) =>
    offers.some((offer) => offer.id === receipt.contributionId),
  );
  const receivable = data.receivableCommitments.filter(
    (offer) => offer.supportRequestId === row.id,
  );
  const offerEvents = data.events ?? [];
  const timeline = [
    { key: row.id, date: row.createdAt, text: 'Supply request submitted' },
    ...offers.flatMap((offer) => [
      {
        key: `${offer.id}-submitted`,
        date: offer.createdAt,
        text: `Offer submitted · ${offer.title}`,
      },
      ...offerEvents
        .filter((event) => event.contributionId === offer.id)
        .map((event) => ({
          key: event.id,
          date: event.createdAt,
          text: `${offerLabel[event.status]} · ${offer.title}`,
        })),
      ...(offer.status === 'Offered' ||
      offerEvents.some(
        (event) => event.contributionId === offer.id && event.status === offer.status,
      )
        ? []
        : [
            {
              key: offer.id,
              date: offer.updatedAt,
              text: `${offerLabel[offer.status]} · ${offer.title}`,
            },
          ]),
    ]),
    ...receipts.map((receipt) => ({
      key: receipt.id,
      date: receipt.createdAt,
      text: `Received ${quantityText(receipt.quantity, offers.find((offer) => offer.id === receipt.contributionId)?.unit)} · ${receipt.reference}`,
    })),
    ...(row.cancelled
      ? [{ key: 'cancelled', date: row.updatedAt, text: 'Request cancelled' }]
      : []),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <WorkspaceDialog
      title={row.reference}
      context={requestState(row, offers)}
      onDismiss={close}
      busy={cancel.isPending}
    >
      <div className="stack">
        <dl className="logistics-detail-grid">
          <div>
            <dt>Supplying organisation</dt>
            <dd>{supplier}</dd>
          </div>
          <div>
            <dt>Requested item</dt>
            <dd>
              {row.resourceName ?? t(`category.${row.category}`)} ·{' '}
              {quantityText(row.quantity, row.unit)}
            </dd>
          </div>
          <div>
            <dt>Destination</dt>
            <dd>{row.destination ?? 'Determined at receipt'}</dd>
          </div>
          <div>
            <dt>Received</dt>
            <dd>{quantityText(row.receivedQuantity, row.unit)}</dd>
          </div>
          <div>
            <dt>Operational justification</dt>
            <dd>{row.reason}</dd>
          </div>
        </dl>
        <LogisticsHeading icon={ClipboardList}>Status timeline</LogisticsHeading>
        <ol className="logistics-list">
          {timeline.map((event) => (
            <li key={event.key}>
              <strong>{event.text}</strong>
              <small>{formatDate(event.date)}</small>
            </li>
          ))}
        </ol>
        {!row.cancelled &&
          row.receivedQuantity < row.quantity &&
          receivable.map((offer) => (
            <details key={offer.id}>
              <summary>Record receipt · {offer.title}</summary>
              <ContributionReceipt id={offer.id} country={country} />
            </details>
          ))}
        {!row.cancelled &&
          !row.receivedQuantity &&
          !receivable.length &&
          data.requestingOrganisations.some((org) => org.id === row.requestingOrganisationId) && (
            <details>
              <summary>Cancel supply request</summary>
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  cancel.mutate(
                    String(new FormData(event.currentTarget).get('reason') ?? '').trim(),
                  );
                }}
              >
                <Field label="Cancellation reason">
                  <input name="reason" required maxLength={1000} />
                </Field>
                <Button busy={cancel.isPending}>Cancel request</Button>
                {cancel.error && (
                  <p role="alert" className="field-error">
                    {errorMessage(cancel.error)}
                  </p>
                )}
              </form>
            </details>
          )}
        {cancel.isSuccess && <p role="status">Supply request cancelled.</p>}
      </div>
    </WorkspaceDialog>
  );
}
