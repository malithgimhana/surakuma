import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Box,
  CalendarDays,
  CalendarCheck,
  ClipboardList,
  Layers,
  PackageCheck,
  Truck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, ErrorState, formatDate, Loading } from './components';
import { useCountry } from './geography';
import { groupDispatches, isDeliveryException, isLow, isOut, shipmentCode, shipmentGroupStatus, visibleInventory } from './logistics';
import {
  casesHref,
  fulfillmentStage,
  inventoryHref,
  LogisticsAttention,
  LogisticsHeader,
  LogisticsHeading,
  quantityText,
  sameOperationsDay,
  useFulfillmentCases,
  useLogisticsData,
} from './LogisticsUi';
import './admin-logistics.css';

export default function LogisticsOverview({ roleControl }: { roleControl?: ReactNode }) {
  const country = useCountry();
  const stock = useLogisticsData();
  const cases = useFulfillmentCases();
  const { t } = useTranslation();
  const data = stock.data;
  const caseList = cases.data;
  const refreshing = stock.isFetching || cases.isFetching;
  const refresh = () => {
    void stock.refetch();
    void cases.refetch();
  };
  const countryName = data?.countries.find((row) => row.code === country)?.name ?? country;
  const organisations = data?.organisations ?? data?.partners ?? [];
  const freshness = Math.min(stock.dataUpdatedAt, cases.dataUpdatedAt);
  const failure = stock.error ?? cases.error;
  if (!data || !caseList || failure)
    return (
      <div className="logistics-page">
        <LogisticsHeader
          title="Logistics overview"
          description={countryName}
          actions={roleControl}
        />
        {failure ? <ErrorState error={failure} retry={refresh} /> : <Loading />}
      </div>
    );

  const inventory = visibleInventory(data);
  const low = inventory.filter(isLow);
  const out = inventory.filter(isOut);
  const items = new Map(inventory.map((row) => [row.id, row]));
  const casesById = new Map(caseList.map((row) => [row.id, row]));
  const receipts = new Map(
    data.receipts?.map((row) => [row.allocationId ?? row.logisticsOrderId, row]),
  );
  const dispatches = data.orders.filter((row) => row.kind === 'Dispatch');
  const exceptions = groupDispatches(dispatches.filter((row) => isDeliveryException(row, receipts.get(row.id))));
  const ready = dispatches.filter((row) => row.status === 'Reserved');
  const inTransit = groupDispatches(dispatches.filter((row) => row.status === 'Dispatched' && !row.centreReceivedAt));
  const dispatchedToday = groupDispatches(dispatches.filter((row) => sameOperationsDay(row.dispatchedAt, country)));
  const pending = caseList.filter(
    (row) => fulfillmentStage(row) === 'Pending allocation' || fulfillmentStage(row) === 'Reserved',
  ).length;
  const readyCases = caseList.filter((row) => fulfillmentStage(row) === 'Ready to dispatch').length;
  const queue = [...groupDispatches(ready), ...dispatchedToday];
  const upcoming = groupDispatches(dispatches.filter(order =>
    !!order.scheduledArrivalAt && !order.centreReceivedAt && ['Reserved', 'Dispatched'].includes(order.status),
  ).sort((a, b) => a.scheduledArrivalAt!.localeCompare(b.scheduledArrivalAt!)));
  const health = [...new Set(inventory.map((item) => item.category))].map((category) => {
    const records = inventory.filter((item) => item.category === category);
    return {
      category,
      records,
      low: records.filter(isLow).length,
      out: records.filter(isOut).length,
    };
  });
  const summaries = [
    [
      'Inventory records',
      inventory.length,
      `${inventory.filter((row) => row.available > 0).length} with stock available`,
      Box,
      'blue',
      inventoryHref(),
    ],
    [
      'Stock alerts',
      low.length + out.length,
      `${low.length} low · ${out.length} out of stock`,
      AlertTriangle,
      'amber',
      inventoryHref({ status: 'Stock alerts' }),
    ],
    [
      'Pending reservations',
      pending,
      'Cases still awaiting stock',
      ClipboardList,
      'blue',
      casesHref(undefined, { status: 'Awaiting stock' }),
    ],
    [
      'Ready to dispatch',
      readyCases,
      'Cases with full reservations',
      PackageCheck,
      'green',
      casesHref(undefined, { status: 'Ready to dispatch' }),
    ],
    [
      'In transit',
      inTransit.length,
      'Dispatches awaiting receipt',
      Truck,
      'blue',
      inventoryHref({ tab: 'dispatches', status: 'Dispatched' }),
    ],
    [
      'Delivery exceptions',
      exceptions.length,
      'Recorded dispatch issues',
      AlertTriangle,
      'coral',
      inventoryHref({ tab: 'dispatches', status: 'Exception' }),
    ],
  ] as const;

  return (
    <div className="logistics-page">
      <LogisticsHeader
        title="Logistics overview"
        description={
          <>
            {countryName}
            {organisations.length > 0 && ` · ${organisations.map((row) => row.name).join(' · ')}`}
          </>
        }
        actions={
          <>
            {roleControl}
            <span className="logistics-freshness">
              {refreshing
                ? 'Refreshing…'
                : `Updated ${formatDate(new Date(freshness).toISOString())}`}
            </span>
            <Button type="button" variant="secondary" disabled={refreshing} onClick={refresh}>
              Refresh
            </Button>
          </>
        }
      />
      {(low.length > 0 || out.length > 0 || exceptions.length > 0) && (
        <LogisticsAttention>
          {(low.length > 0 || out.length > 0) && (
            <Link to={inventoryHref({ status: 'Stock alerts' })}>
              {low.length} below threshold · {out.length} out of stock
            </Link>
          )}
          {exceptions.length > 0 && (
            <Link to={inventoryHref({ tab: 'dispatches', status: 'Exception' })}>
              Review {exceptions.length} dispatch{' '}
              {exceptions.length === 1 ? 'exception' : 'exceptions'}
            </Link>
          )}
        </LogisticsAttention>
      )}
      <ul className="logistics-kpis" aria-label="Operational summary">
        {summaries.map(([label, count, description, Icon, tone, href]) => (
          <li key={label} className="logistics-kpi">
            <span className="logistics-icon" data-tone={tone}>
              <Icon size={23} aria-hidden="true" />
            </span>
            <div>
              <Link to={href}>{label}</Link>
              <strong>{count.toLocaleString()}</strong>
              <small>{description}</small>
            </div>
          </li>
        ))}
      </ul>
      <div className="logistics-columns">
        <div className="stack">
          <Card>
            <LogisticsHeading icon={Truck} href={inventoryHref({ tab: 'dispatches' })}>
              Today’s dispatch queue
            </LogisticsHeading>
            <p className="logistics-freshness">
              Awaiting dispatch · {dispatchedToday.length} dispatched today in {countryName}
            </p>
            {queue.length ? (
              <div
                className="logistics-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="Dispatch queue records"
              >
                <table className="logistics-table" aria-label="Today’s dispatch queue">
                  <thead>
                    <tr>
                      {['Reference', 'Items / quantity', 'Destination', 'Status', 'Action'].map(
                        (label) => (
                          <th key={label} scope="col">
                            {label}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {queue.slice(0, 8).map(lines => {
                      const [order] = lines;
                      const item = items.get(order.resourceId);
                      const row = order.requestId ? casesById.get(order.requestId) : undefined;
                      const view = inventoryHref({ tab: 'dispatches', record: order.caseDispatchId ?? order.id });
                      const status = order.status === 'Reserved' ? 'Awaiting dispatch' : shipmentGroupStatus(lines);
                      return (
                        <tr key={order.caseDispatchId ?? order.id}>
                          <th scope="row">{row?.reference ?? shipmentCode(order)}</th>
                          <td>
                            {order.caseDispatchId ? lines.map(line => <small key={line.id}>
                              {items.get(line.resourceId)?.name} · {quantityText(line.quantity, items.get(line.resourceId)?.unit)}
                            </small>) : <>{item?.name}<small>{quantityText(order.quantity, item?.unit)}</small></>}
                          </td>
                          <td>{row && !order.caseDispatchId ? (row.region ?? 'Region unavailable') : order.destination}</td>
                          <td>
                            <span
                              className="logistics-status"
                              data-status={status}
                            >
                              {status}
                            </span>
                          </td>
                          <td>
                            <Link
                              className="logistics-link"
                              to={view}
                              aria-label={`Review ${shipmentCode(order)}`}
                            >
                              Review
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="logistics-empty">No dispatches are queued or recorded for today.</p>
            )}
            {queue.length > 8 && (
              <p className="logistics-freshness">
                <Link to={inventoryHref({ tab: 'dispatches', status: 'Ready' })}>
                  All awaiting dispatch
                </Link>{' '}
                ·{' '}
                <Link to={inventoryHref({ tab: 'dispatches', date: 'today' })}>
                  All dispatched today
                </Link>
              </p>
            )}
          </Card>
          <Card>
            <LogisticsHeading icon={CalendarDays}>Upcoming deliveries</LogisticsHeading>
            {upcoming.length ? (
              <ul className="logistics-list">
                {upcoming.slice(0, 5).map(([order]) => (
                    <li key={order.caseDispatchId ?? order.id}>
                      <Link to={inventoryHref({ tab: 'dispatches', record: order.caseDispatchId ?? order.id })}>
                        {shipmentCode(order)}
                      </Link>
                      <small>
                        {order.destination} · {formatDate(order.scheduledArrivalAt!)}
                      </small>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="logistics-empty">
                No arrival schedules recorded for active dispatches.
              </p>
            )}
            {inTransit.length > 0 && (
              <Link
                className="logistics-link"
                to={inventoryHref({ tab: 'dispatches', status: 'Dispatched' })}
              >
                Review {inTransit.length} in-transit dispatches
              </Link>
            )}
          </Card>
        </div>
        <Card>
          <LogisticsHeading icon={Layers} href={inventoryHref()}>
            Inventory health by category
          </LogisticsHeading>
          {health.length ? (
            <ul className="logistics-list">
              {health.map((row) => (
                <li key={row.category} className="logistics-list-row">
                  <span>
                    <strong>{t(`category.${row.category}`)}</strong>
                    <small>
                      {row.records.length}{' '}
                      {row.records.length === 1 ? 'inventory record' : 'inventory records'}
                    </small>
                  </span>
                  <span>
                    {row.low} low · {row.out} out
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="logistics-empty">No inventory records in this scope.</p>
          )}
          <p className="logistics-freshness">
            <CalendarCheck size={14} aria-hidden="true" /> Low stock compares available stock with
            each configured threshold.
          </p>
        </Card>
      </div>
    </div>
  );
}
