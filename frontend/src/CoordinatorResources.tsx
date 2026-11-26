import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Boxes, ClipboardList, PackageCheck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { get } from './api';
import { Badge, Button, Empty, ErrorState, Field, formatDate, Loading, PageHeader } from './components';
import { CoordinatorMetrics, CoordinatorPanel, coordinatorCases, useCoordinatorOverview } from './CoordinatorOverview';
import { countryPath, dashboardRefreshInterval } from './crisisOperationsApi';
import { useCountry } from './geography';
import { WorkspaceDialog } from './OrganisationDialog';
import { unitSymbol } from './quantity';
import type { Resource } from './types';

type InventoryRow = {
  resource: Resource & { reference?: string; lowStockThreshold?: number | null };
  organisation?: string;
  warehouse?: string;
  matchesApprovedNeed: boolean;
};
type Movement = { id: string; kind: string; quantity: number; note: string; createdAt: string };
const emptyInventory: InventoryRow[] = [];

function stockState({ resource: stock }: InventoryRow) {
  if (stock.available <= 0) return 'Out of stock';
  return stock.lowStockThreshold != null && stock.available < stock.lowStockThreshold ? 'Low stock' : 'Available';
}

const quantity = (value: number, unit: string) =>
  `${value.toLocaleString(undefined, { maximumFractionDigits: 5 })} ${unitSymbol(unit)}`;

export default function CoordinatorResources() {
  const country = useCountry();
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const category = params.get('category') ?? '';
  const organisation = params.get('organisation') ?? '';
  const [state, setState] = useState('');
  const [matchNeeds, setMatchNeeds] = useState(false);
  const [selected, setSelected] = useState<string>();
  const summary = useCoordinatorOverview(country);
  const query = useQuery({
    queryKey: ['coordinator-inventory', country],
    queryFn: () => get<InventoryRow[]>(countryPath('/staff/coordinator/inventory', country)),
    refetchInterval: dashboardRefreshInterval,
  });
  const rows = query.data ?? emptyInventory;
  const organisations = useMemo(() => [...new Map(rows.map(row => [
    row.resource.organisationId, row.organisation ?? 'Organisation name unavailable',
  ])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const categories = [...new Set(rows.map(row => row.resource.category))].sort();
  const term = search.trim().toLocaleLowerCase();
  const filtered = rows.filter(row => (!category || row.resource.category === category) &&
    (!organisation || row.resource.organisationId === organisation) && (!state || stockState(row) === state) &&
    (!matchNeeds || row.matchesApprovedNeed) &&
    [row.resource.name, row.resource.reference, row.resource.locationText, row.organisation, row.warehouse]
      .join(' ').toLocaleLowerCase().includes(term));
  const details = rows.find(row => row.resource.id === selected);
  function filter(name: 'category' | 'organisation', value: string) {
    setParams(current => {
      const next = new URLSearchParams(current);
      if (value) next.set(name, value);
      else next.delete(name);
      return next;
    }, { replace: true });
  }
  return <div className="coord-page">
    <PageHeader title="Resource availability" description="Monitor stock and approved assistance needs across assigned organisations."
      action={<Link className="button secondary" to={coordinatorCases('shortages')}>Review case shortages <ArrowRight size={17} /></Link>} />
    <CoordinatorMetrics label="Inventory summary" items={[
      { label: 'Inventory records', value: query.data?.length, icon: Boxes },
      { label: 'Records with available stock', value: query.data?.filter(r => r.resource.available > 0).length, icon: PackageCheck, tone: 'green' },
      { label: 'Low or depleted stock records', value: query.data?.filter(r => stockState(r) !== 'Available').length, icon: AlertTriangle, tone: 'amber' },
      { label: 'Cases with stock shortages', value: summary.data?.metrics?.shortages, icon: ClipboardList, tone: 'coral', to: coordinatorCases('shortages') },
    ]} />
    {summary.error && <ErrorState error={summary.error} retry={() => void summary.refetch()} />}
    <CoordinatorPanel title="Regional inventory">
      <div className="coord-filters">
        <Field label="Search inventory"><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Resource, warehouse or location" /></Field>
        <Field label="Category"><select value={category} onChange={e => filter('category', e.target.value)}>
          <option value="">All categories</option>{[...new Set([...categories, ...(category ? [category] : [])])].map(value =>
            <option key={value} value={value}>{t('category.' + value)}</option>)}
        </select></Field>
        <Field label="Organisation"><select value={organisation} onChange={e => filter('organisation', e.target.value)}>
          <option value="">All organisations</option>{organisations.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          {!!organisation && !organisations.some(([id]) => id === organisation) && <option value={organisation}>Case organisation</option>}
        </select></Field>
        <Field label="Availability"><select value={state} onChange={e => setState(e.target.value)}>
          <option value="">Any availability</option>{['Available', 'Low stock', 'Out of stock'].map(value => <option key={value}>{value}</option>)}
        </select></Field>
        <label className="checkbox-label"><input type="checkbox" checked={matchNeeds} onChange={e => setMatchNeeds(e.target.checked)} /> Matches approved needs</label>
      </div>
      {query.isPending ? <Loading /> : query.error ? <ErrorState error={query.error} retry={() => void query.refetch()} /> :
        !rows.length ? <Empty title="No inventory in your scope" description="Inventory appears here once logistics records stock at an assigned organisation." /> :
        !filtered.length ? <Empty title="No inventory matches these filters" /> :
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Inventory results">
          <table className="coord-table">
            <thead><tr><th>Resource</th><th>Organisation / warehouse</th><th>Available</th><th>Reserved</th><th>Physical stock</th><th>Availability</th></tr></thead>
            <tbody>{filtered.map(row => {
              const stock = row.resource;
              const state = stockState(row);
              return <tr key={stock.id}>
                <td><Button variant="ghost" className="coord-record-link" onClick={() => setSelected(stock.id)}>{stock.name}<ArrowRight size={15} /></Button>
                  <small>{t('category.' + stock.category)}{row.matchesApprovedNeed ? ' · Matches approved needs' : ''}</small></td>
                <td>{row.organisation ?? 'Organisation unavailable'}<small>{row.warehouse ?? (stock.locationText || 'Warehouse unavailable')}</small></td>
                <td>{quantity(stock.available, stock.unit)}</td><td>{quantity(stock.reserved, stock.unit)}</td><td>{quantity(stock.stock, stock.unit)}</td>
                <td><span className={`coord-status ${state === 'Available' ? 'green' : state === 'Low stock' ? 'amber' : 'red'}`}>{state}</span></td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
    </CoordinatorPanel>
    {details && <ResourceDetails key={details.resource.id} row={details} country={country} close={() => setSelected(undefined)} />}
  </div>;
}

function ResourceDetails({ row, country, close }: { row: InventoryRow; country: string; close: () => void }) {
  const stock = row.resource;
  const movements = useQuery({
    queryKey: ['coordinator-stock', country, stock.id],
    queryFn: () => get<Movement[]>(countryPath(`/resources/${stock.id}/movements`, country)),
  });
  return <WorkspaceDialog title={stock.name} context={row.organisation} onDismiss={close}>
    <div className="stack">
      <div className="inline"><Badge value={stockState(row)} />{row.matchesApprovedNeed && <Badge value="Matches approved needs" />}</div>
      <dl className="coord-facts">
        <div><dt>Warehouse</dt><dd>{row.warehouse ?? 'Unavailable'}</dd></div>
        <div><dt>Location</dt><dd>{stock.locationText || 'Unavailable'}</dd></div>
        <div><dt>Available</dt><dd>{quantity(stock.available, stock.unit)}</dd></div>
        <div><dt>Reserved</dt><dd>{quantity(stock.reserved, stock.unit)}</dd></div>
        <div><dt>Physical stock</dt><dd>{quantity(stock.stock, stock.unit)}</dd></div>
        <div><dt>Transport</dt><dd>{stock.transportAvailable ? 'Available' : 'Unavailable'}</dd></div>
        {stock.suitability && <div><dt>Suitability</dt><dd>{stock.suitability}</dd></div>}
      </dl>
      <h3>Stock movements</h3>
      {movements.isPending ? <Loading /> : movements.error ? <ErrorState error={movements.error} retry={() => void movements.refetch()} /> :
        movements.data.length ? <ul className="coord-activity-list">{movements.data.map(row => <li key={row.id}>
          <div><strong>{row.kind} · {quantity(row.quantity, stock.unit)}</strong>{row.note && <p>{row.note}</p>}</div>
          <time dateTime={row.createdAt}>{formatDate(row.createdAt)}</time>
        </li>)}</ul> : <p className="muted">No stock movements have been recorded.</p>}
    </div>
  </WorkspaceDialog>;
}
