import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown, ArrowDownUp, ArrowLeftRight, ArrowRight, ArrowUp, Bookmark, Box, CalendarCheck, ChevronLeft,
  ChevronRight, Download, Droplet, Ellipsis, Globe2, HeartPulse, Layers, Package, Plus, Search, Tent,
  TriangleAlert, Truck, Warehouse,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { get } from './api';
import { Button, Card, categories, ErrorState, Field, formatDate, Loading } from './components';
import { useCountry } from './geography';
import {
  actionLabels, caseStockForCrisis, groupDispatches, hasStockAlert, inventoryStatus, isDeliveryException, isLow, isOut, legacyLogisticsReference, legacyShipmentCode,
  resourceCode, shipmentCode, shipmentGroupStatus, shipmentStatus, stockGap, visibleInventory,
} from './logistics';
import type { InventoryItem, LogisticsData, LogisticsDialogState, Shipment, ShipmentAction } from './logistics';
import { LogisticsDialogs, ReleaseReservationButton } from './LogisticsDialogs';
import DepotAssignments from './DepotAssignments';
import { casesHref, sameOperationsDay, useLogisticsData } from './LogisticsUi';
import './admin-logistics.css';

const tabs = [
  { key: 'inventory', label: 'Inventory', icon: Layers },
  { key: 'dispatches', label: 'Dispatches', icon: Truck },
  { key: 'transfers', label: 'Transfers', icon: ArrowLeftRight },
  { key: 'reservations', label: 'Reservations', icon: CalendarCheck },
] as const;
type Tab = (typeof tabs)[number]['key'];
type SortKey = 'name' | 'available' | 'reserved' | 'stock';
const pageSize = 5;
const inventoryStatuses = ['Normal', 'Reserved', 'Low stock', 'Out of stock'];
const categoryIcons = {
  FoodWater: [Droplet, 'cyan'], Medical: [HeartPulse, 'coral'], Shelter: [Tent, 'violet'],
  Transportation: [Truck, 'blue'], Accessibility: [Package, 'violet'], Other: [Layers, 'blue'],
} as const;

function ItemIcon({ item }: { item: InventoryItem }) {
  const [Icon, tone] = categoryIcons[item.category] ?? categoryIcons.Other;
  return <span className="logistics-icon" data-tone={tone}><Icon size={18} aria-hidden="true" /></span>;
}

function Status({ label }: { label: string }) {
  return <span className="logistics-status" data-status={label}>{label}</span>;
}

function labelFor(tab: Tab, status: Shipment['status']) {
  return tab === 'reservations' && status === 'Reserved' ? 'Reserved' : shipmentStatus[status];
}

function recentTime(iso: string, locale: string | undefined) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  if (minutes < 60) return format.format(-minutes, 'minute');
  if (minutes < 1440) return format.format(-Math.floor(minutes / 60), 'hour');
  return format.format(-Math.floor(minutes / 1440), 'day');
}

export default function AdminLogistics({ specialist = false }: { specialist?: boolean }) {
  const country = useCountry();
  const [params] = useSearchParams();
  const scoped = useLogisticsData(specialist);
  const admin = useQuery({ queryKey: ['admin-logistics'], enabled: !specialist, queryFn: () => get<LogisticsData>('/logistics?countryCode=') });
  const query = specialist ? scoped : admin;
  if (!query.data && (query.isPending || query.isError)) return <>
    <h1>Resources &amp; Logistics</h1>
    {query.isError ? <ErrorState error={query.error} retry={() => query.refetch()} /> : <Loading />}
  </>;
  if (!Array.isArray(query.data?.inventory)) return <ErrorState error={new Error('The logistics dashboard requires the updated API.')} retry={() => query.refetch()} />;
  const startTab = tabs.find(t => t.key === params.get('tab'))?.key ?? 'inventory';
  const startStatus = params.get('status') ?? '';
  const record = params.get('record') ?? '';
  const today = params.get('date') === 'today';
  return <LogisticsWorkspace key={`${country}-${startTab}-${startStatus}-${record}-${today}`} data={query.data}
    specialist={specialist} startTab={startTab} startStatus={startStatus} record={record} today={today} />;
}

function LogisticsWorkspace({ data, specialist, startTab, startStatus, record, today }: {
  data: LogisticsData; specialist: boolean; startTab: Tab; startStatus: string; record: string; today: boolean;
}) {
  const workspace = useCountry();
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 2 });
  const [country, setCountry] = useState({ workspace, code: workspace });
  const [crisis, setCrisis] = useState('');
  const [depot, setDepot] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState(startStatus);
  const [search, setSearch] = useState('');
  const [recordFilter, setRecordFilter] = useState(record);
  const [todayOnly, setTodayOnly] = useState(today);
  const [tab, setTab] = useState<Tab>(startTab);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'name', descending: false });
  const [dialog, setDialog] = useState<LogisticsDialogState | null>(null);
  const [notice, setNotice] = useState('');
  const countries = new Map(data.countries.map(row => [row.code, row.name]));
  const visibleDepots = data.resourceRegistration?.depots ?? data.depots;
  const depots = new Map(visibleDepots.map(row => [row.id, row]));
  const visibleStock = visibleInventory(data);
  const items = new Map(visibleStock.map(row => [row.id, row]));
  const receipts = new Map(data.receipts?.map((receipt) => [receipt.allocationId ?? receipt.logisticsOrderId, receipt]));
  const countryLabel = (code: string) => countries.get(code) ?? code;
  const depotLabel = (item: InventoryItem) => depots.get(item.depotId ?? '')?.name || item.locationText || 'Unspecified location';
  const selected = specialist ? workspace : country.workspace === workspace ? country.code : workspace;
  const activeCountry = !selected || countries.has(selected) ? selected : data.countries[0]?.code ?? '';
  const defaultCountry = activeCountry || (countries.has(workspace) ? workspace : data.countries[0]?.code ?? '');
  const availableDepots = visibleDepots.filter(row => !activeCountry || row.countryCode === activeCountry);
  const visibleCrises = data.crises.filter(row => !activeCountry || row.countryCode === activeCountry);
  const selectedDepot = availableDepots.some(row => row.id === depot) || depot === 'legacy' ? depot : '';
  const selectedCrisis = visibleCrises.some(row => row.id === crisis) ? crisis : '';
  const legacyLocations = visibleStock.some(row => !row.depotId && (!activeCountry || row.countryCode === activeCountry));
  const term = search.trim().toLowerCase();
  const categoryLabel = (value: InventoryItem['category']) => t(`category.${value}`, { defaultValue: value });
  const resourceTextMatches = (row: InventoryItem) => [row.name, resourceCode(row), legacyLogisticsReference('RES', row.id),
    row.unit, categoryLabel(row.category), countryLabel(row.countryCode), depotLabel(row)]
    .some(value => value.toLowerCase().includes(term));
  const resourceScope = (row: InventoryItem) => (!activeCountry || row.countryCode === activeCountry)
    && (!selectedDepot || (selectedDepot === 'legacy' ? !row.depotId : row.depotId === selectedDepot))
    && (!category || row.category === category);
  const ordersInScope = data.orders.filter(order => {
    if (selectedCrisis && order.crisisId !== selectedCrisis) return false;
    const participants = [items.get(order.resourceId), items.get(order.destinationResourceId ?? '')];
    return participants.some(item => item && resourceScope(item))
      && (!term || participants.some(item => item && resourceTextMatches(item))
        || [shipmentCode(order), legacyShipmentCode(order), order.origin, order.destination].some(value => value.toLowerCase().includes(term)));
  });
  const linkedItems = new Set(ordersInScope.flatMap(order => [order.resourceId, order.destinationResourceId]));
  const crisisStock = new Set(caseStockForCrisis(data, selectedCrisis).map(item => item.id));
  const scopedInventory = visibleStock.filter(item => resourceScope(item) && resourceTextMatches(item)
    && (!selectedCrisis || linkedItems.has(item.id) || crisisStock.has(item.id)));
  const inventory = scopedInventory.filter(item => tab !== 'inventory' ||
    (!recordFilter || item.id === recordFilter) && (!status ||
      (status === 'Stock alerts' ? hasStockAlert(item) : inventoryStatus(item) === status)));
  const activeDispatchIds = new Set(data.orders.filter(order => order.kind === 'Dispatch' &&
    (order.status === 'Reserved' || order.status === 'Dispatched')).map(order => order.caseDispatchId ?? order.id));
  const isActiveDispatch = (order: Shipment) => activeDispatchIds.has(order.caseDispatchId ?? order.id);
  const currentDispatchView = specialist && tab === 'dispatches' && !recordFilter && !todayOnly;
  const filteredOrders = ordersInScope.filter(order => tab === 'inventory' ||
    (!recordFilter || order.id === recordFilter || order.caseDispatchId === recordFilter) && (!todayOnly || sameOperationsDay(order.dispatchedAt, activeCountry)) &&
    (status === 'All' || (!status && (recordFilter || order.status !== 'Cancelled' && (!currentDispatchView || isActiveDispatch(order)))) ||
      order.status === status && (status !== 'Dispatched' || !order.centreReceivedAt) ||
      status === 'Exception' && isDeliveryException(order, receipts.get(order.id)) ||
      status === 'Ready' && order.status === 'Reserved' && !!order.packedAt ||
      status === 'PendingDispatch' && !order.requestId && order.kind === 'Dispatch' && order.status === 'Reserved' ||
      status === 'InTransit' && !order.requestId && order.status === 'Dispatched' ||
      status === 'Centre' && order.status === 'Dispatched' && !!order.centreReceivedAt));
  const dispatches = filteredOrders.filter(row => row.kind === 'Dispatch');
  const transfers = filteredOrders.filter(row => row.kind === 'Transfer');
  const reservations = filteredOrders.filter(row => row.status === 'Reserved');
  const scopedDispatches = ordersInScope.filter(row => row.kind === 'Dispatch' && row.status !== 'Cancelled');
  const activeDispatches = scopedDispatches.filter(isActiveDispatch);
  const defaultDispatches = specialist ? activeDispatches : scopedDispatches;
  const recentDispatches = groupDispatches(tab === 'dispatches' ? dispatches : defaultDispatches);
  const canMoveStock = data.inventory.some(item => item.available > 0 && item.canShip !== false);
  const caseOnlyStock = specialist && !!data.caseInventory?.some(item => item.countryCode === defaultCountry);
  const active = groupDispatches(activeDispatches);
  const exceptions = scopedDispatches.filter(row => isDeliveryException(row, receipts.get(row.id)));
  const low = scopedInventory.filter(isLow);
  const out = scopedInventory.filter(isOut);
  const stockAlerts = [...out, ...low];
  const sorted = [...inventory].sort((a, b) => {
    const comparison = sort.key === 'name' ? a.name.localeCompare(b.name) : a[sort.key] - b[sort.key];
    return (sort.descending ? -comparison : comparison) || a.id.localeCompare(b.id);
  });
  const orders = groupDispatches(tab === 'transfers' ? transfers : tab === 'reservations' ? reservations : dispatches);
  const count = tab === 'inventory' ? inventory.length : orders.length;
  const lastPage = Math.max(1, Math.ceil(count / pageSize));
  const shown = Math.min(page, lastPage);
  const start = (shown - 1) * pageSize;
  const chooseTab = (key: Tab) => { setTab(key); setStatus(''); setRecordFilter(''); setTodayOnly(false); setPage(1); };
  const filter = (apply: (value: string) => void) => (value: string) => { apply(value); setPage(1); };
  const open = (state: LogisticsDialogState) => { setNotice(''); setDialog(state); };
  const summaryStock = (key: 'available' | 'reserved') => {
    const units = new Map<string, number>();
    const stocked = scopedInventory.filter(item => item[key] > 0);
    for (const item of scopedInventory) {
      const unit = item.unit.trim().toLowerCase();
      units.set(unit, (units.get(unit) ?? 0) + item[key]);
    }
    if (!specialist && units.size === 1) {
      const [unit, quantity] = [...units][0];
      return { value: quantity, caption: unit, detail: undefined };
    }
    return { value: stocked.length, caption: key === 'available' ? 'Items with available stock' : 'Items with reservations',
      detail: [...units].map(([unit, quantity]) => `${number.format(quantity)} ${unit}`).join(' · ') };
  };
  const totals = {
    inventory: tab === 'inventory' ? inventory.length : scopedInventory.length,
    dispatches: tab === 'dispatches' ? orders.length : groupDispatches(defaultDispatches).length,
    transfers: tab === 'transfers' ? transfers.length : ordersInScope.filter(row => row.kind === 'Transfer' && row.status !== 'Cancelled').length,
    reservations: tab === 'reservations' ? reservations.length : ordersInScope.filter(row => row.status === 'Reserved').length,
  };
  const statusOptions = tab === 'inventory' ? [...inventoryStatuses, 'Stock alerts'].map(value => [value, value])
    : tab === 'reservations' ? [['Reserved', 'Reserved']]
    : [['All', 'All statuses'], ...Object.keys(shipmentStatus).map(value => [value, labelFor(tab, value as Shipment['status'])]),
      ...(tab === 'dispatches' ? [['Centre', 'At centre'], ['Exception', 'Delivery exceptions'], ['Ready', 'Ready to dispatch'], ['PendingDispatch', 'Dispatch queue'], ['InTransit', 'Non-case shipments in transit']] : [])];
  const summaries: Array<{ label: string; value: number; caption: string; detail?: string; Icon: LucideIcon; tone: string }> = [
    { label: 'Total resources', value: scopedInventory.length, caption: 'Inventory records at selected depots', Icon: Box, tone: 'blue' },
    { label: 'Available stock', ...summaryStock('available'), Icon: Layers, tone: 'green' },
    { label: 'Reserved stock', ...summaryStock('reserved'), Icon: Bookmark, tone: 'blue' },
    { label: 'Low stock items', value: low.length, caption: `${out.length} out of stock separately`, Icon: TriangleAlert, tone: 'amber' },
    { label: 'Active dispatches', value: active.length,
      caption: `${active.filter(lines => lines.some(order => order.status === 'Dispatched' && !order.centreReceivedAt)).length} in transit · ${active.filter(lines => lines[0].status === 'Reserved').length} pending`,
      Icon: Truck, tone: 'violet' },
  ];
  const direction = (key: SortKey) => {
    setSort({ key, descending: sort.key === key ? !sort.descending : key !== 'name' });
    setPage(1);
  };
  const sortHeader = (label: string, key: SortKey) => {
    const Icon = sort.key !== key ? ArrowDownUp : sort.descending ? ArrowDown : ArrowUp;
    return <th scope="col" aria-sort={sort.key === key ? sort.descending ? 'descending' : 'ascending' : undefined}>
      <button className="logistics-sort" type="button" onClick={() => direction(key)}>{label}<Icon size={13} aria-hidden="true" /></button>
    </th>;
  };
  function exportRows() {
    const headings = ['Resource', 'Code', 'Category', 'Country', 'Depot', 'Unit', 'Available', 'Reserved', 'Physical', 'Status'];
    const csvCell = (value: string | number) => {
      if (typeof value === 'number') return String(value);
      const safe = /^[\s\uFEFF]*[=+\-@＝＋－＠]|^[\t\r\n]/u.test(value) ? "'" + value : value;
      return '"' + safe.replaceAll('"', '""') + '"';
    };
    const rows = sorted.map(item => [item.name, resourceCode(item), categoryLabel(item.category), countryLabel(item.countryCode),
      depotLabel(item), item.unit, item.available, item.reserved, item.stock, inventoryStatus(item)]);
    const url = URL.createObjectURL(new Blob(['\uFEFF' + [headings, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'surakuma-inventory.csv';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="logistics-dashboard">
    {!specialist && <DepotAssignments />}
    <header className="logistics-header">
      <div><h1>Resources &amp; Logistics</h1><p>{specialist
        ? `${countryLabel(workspace)} · Manage stock, reservations, transfers, and dispatches across assigned depots.`
        : 'Manage stock, reservations, transfers, and dispatches across countries and depots.'}</p></div>
      <div className="logistics-header-actions">
        {(!specialist || (data.resourceRegistration?.partners ?? data.partners).length > 0) && <Button variant="secondary" onClick={() => open({ kind: 'resource' })} disabled={!defaultCountry}><Plus size={17} aria-hidden="true" /> Add resource</Button>}
        {(!specialist || data.inventory.length > 0) && <Button className="button secondary logistics-receive" onClick={() => open({ kind: 'stock' })} disabled={!data.inventory.length}><Layers size={17} aria-hidden="true" /> Record stock</Button>}
        {(!specialist || data.partners.length > 0) && <Button className={specialist ? 'button primary' : 'button primary logistics-blue'} onClick={() => open({ kind: 'dispatch' })}
          disabled={!canMoveStock}><Truck size={18} aria-hidden="true" /> Create dispatch</Button>}
      </div>
    </header>
    {notice && <p className="organisation-notice" role="status">{notice}</p>}
    {specialist && (stockAlerts.length > 0 || exceptions.length > 0) && <div className="logistics-attention">
      <TriangleAlert size={20} aria-hidden="true" /><strong>Attention needed</strong>
      {stockAlerts.length > 0 && <button type="button" onClick={() => { chooseTab('inventory'); setStatus('Stock alerts'); }}>
        {low.length} below threshold · {out.length} out of stock</button>}
      {exceptions.length > 0 && <button type="button" onClick={() => { chooseTab('dispatches'); setStatus('Exception'); }}>
        {exceptions.length} dispatch {exceptions.length === 1 ? 'exception' : 'exceptions'}</button>}
    </div>}
    <ul className="logistics-kpis" aria-label="Logistics summary">
      {summaries.map(({ label, value, caption, detail, Icon, tone }) => (
        <li key={label} className="logistics-kpi" title={detail}>
          <span className="logistics-icon" data-tone={tone}><Icon size={25} aria-hidden="true" /></span>
          <div><span>{label}</span><strong>{number.format(value)}</strong><small>{caption}</small></div>
        </li>
      ))}
    </ul>
    <Card className="logistics-filters">
      {!specialist && data.countries.length > 1 && <Field label="Inventory country" endAdornment={<Globe2 className="logistics-filter-icon" size={16} aria-hidden="true" />}>
        <select value={activeCountry} onChange={event => {
          setCountry({ workspace, code: event.target.value }); setCrisis(''); setDepot(''); setPage(1);
        }}>
          <option value="">All countries</option>
          {data.countries.map(row => <option key={row.code} value={row.code}>{row.name}</option>)}
        </select>
      </Field>}
      <Field label="Crisis" endAdornment={<TriangleAlert className="logistics-filter-icon" size={16} aria-hidden="true" />}>
        <select value={selectedCrisis} onChange={event => filter(setCrisis)(event.target.value)}>
          <option value="">All crises</option>
          {visibleCrises.map(row => <option key={row.id} value={row.id}>{row.name}{!activeCountry && ` (${row.countryCode})`}</option>)}
        </select>
      </Field>
      <Field label="Depot" endAdornment={<Warehouse className="logistics-filter-icon" size={16} aria-hidden="true" />}>
        <select value={selectedDepot} onChange={event => filter(setDepot)(event.target.value)}>
          <option value="">All depots</option>
          {legacyLocations && <option value="legacy">Legacy locations</option>}
          {availableDepots.map(row => <option key={row.id} value={row.id}>{row.name}{!activeCountry && ` (${row.countryCode})`}</option>)}
        </select>
      </Field>
      <Field label="Resource type" endAdornment={<Layers className="logistics-filter-icon" size={16} aria-hidden="true" />}>
        <select value={category} onChange={event => filter(setCategory)(event.target.value)}>
          <option value="">All types</option>
          {categories.map(value => <option key={value} value={value}>{categoryLabel(value)}</option>)}
        </select>
      </Field>
      <Field label="Status">
        <select value={status} onChange={event => filter(setStatus)(event.target.value)}>
          <option value="">{currentDispatchView ? 'Current dispatches' : tab === 'dispatches' || tab === 'transfers' ? 'Exclude cancelled' : 'All statuses'}</option>
          {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <Field label="Search inventory and shipments" endAdornment={<Search className="logistics-filter-icon" size={16} aria-hidden="true" />}>
        <input type="search" placeholder="Name, code, or location" value={search}
          onChange={event => filter(setSearch)(event.target.value)} />
      </Field>
    </Card>
    <div className="logistics-grid">
      <Card className="logistics-table-card">
        <nav aria-label="Logistics views" className="logistics-tabs">
          {tabs.map(({ key, label, icon: Icon }) => <button key={key} type="button" aria-current={tab === key ? 'page' : undefined} onClick={() => chooseTab(key)}>
            <Icon size={17} aria-hidden="true" />{label} ({number.format(totals[key])})
          </button>)}
        </nav>
        <div className="logistics-section-head">
          <div><h2>{tabs.find(row => row.key === tab)?.label}</h2>
            <p>{tab === 'inventory' ? 'Stock and reservations at the selected locations.' : tab === 'dispatches'
              ? 'Shipments to crises and authorised requests.' : tab === 'transfers'
                ? 'Stock movements between registered depots.' : 'Resources committed to crises and authorised requests.'}</p></div>
          {tab === 'inventory'
            ? <Button type="button" variant="secondary" onClick={exportRows} disabled={!inventory.length}><Download size={16} aria-hidden="true" /> Export</Button>
            : tab === 'transfers' || tab === 'reservations' ? <Button type="button" variant="secondary"
              disabled={!canMoveStock} aria-describedby={canMoveStock ? undefined : 'logistics-movement-access'}
              onClick={() => open({ kind: tab === 'transfers' ? 'transfer' : 'reservation' })}>
              <Plus size={16} aria-hidden="true" />{tab === 'transfers' ? 'Create transfer' : 'Reserve stock'}</Button> : null}
        </div>
        {!canMoveStock && (tab === 'transfers' || tab === 'reservations') && (
          <p id="logistics-movement-access" className="muted">
            {tab === 'transfers' ? 'Transfers require available stock at a depot you can manage.' :
              'Standalone reservations require available stock at a depot you can manage.'}
            {caseOnlyStock && <> Reserve stock assigned to your crisis through <Link to={casesHref()}>Case Fulfillment</Link>.</>}
          </p>
        )}
        {(recordFilter || todayOnly) && <button className="logistics-link" type="button" onClick={() => { setRecordFilter(''); setTodayOnly(false); setPage(1); }}>
          {todayOnly ? "Clear today's dispatch filter" : 'Show all records'}
        </button>}
        {count === 0 ? <p className="logistics-empty">No {tab === 'inventory' ? 'resources' : tab} match these filters.</p>
          : <div className="logistics-table-wrap" tabIndex={0}>
            {tab === 'inventory' ? <table className="logistics-table" aria-label="Inventory">
              <thead><tr>{sortHeader('Resource', 'name')}<th scope="col">Category</th><th scope="col">Country</th><th scope="col">Depot</th>
                {sortHeader('Available', 'available')}{sortHeader('Reserved', 'reserved')}{sortHeader('Physical', 'stock')}
                <th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
              <tbody>{sorted.slice(start, start + pageSize).map(item => <tr key={item.id}>
                <th scope="row"><span className="logistics-item"><ItemIcon item={item} />
                  <span>{item.name}<small>{resourceCode(item)} · {item.unit}</small></span></span></th>
                <td><span className="logistics-category" data-tone={categoryIcons[item.category]?.[1]}>{categoryLabel(item.category)}</span></td>
                <td>{countryLabel(item.countryCode)}</td><td>{depotLabel(item)}</td>
                <td className="logistics-quantity">{number.format(item.available)}</td>
                <td className="logistics-quantity">{number.format(item.reserved)}</td>
                <td className="logistics-quantity">{number.format(item.stock)}</td>
                <td><Status label={inventoryStatus(item)} /></td>
                <td><button type="button" className="logistics-row-action" aria-label={`Details for ${item.name}`} onClick={() => open({ kind: 'details', resourceId: item.id })}><Ellipsis size={20} aria-hidden="true" /></button></td>
              </tr>)}</tbody>
            </table> : <table className="logistics-table logistics-shipments" aria-label={tabs.find(row => row.key === tab)?.label}>
              <thead><tr>{['Reference', 'Resource', 'Origin → destination', 'Crisis', 'Quantity', 'Status', 'Actions'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
              <tbody>{orders.slice(start, start + pageSize).map(lines => {
                const [order] = lines;
                const resource = items.get(order.resourceId);
                const receipt = receipts.get(order.id);
                const next: ShipmentAction | undefined = order.caseDispatchId || specialist && order.requestId ? undefined
                  : order.status === 'Reserved' ? order.packedAt ? 'dispatch' : 'prepare' : order.status === 'Dispatched' ? 'deliver' : undefined;
                return <tr key={order.caseDispatchId ?? order.id}>
                  <th scope="row"><span className="logistics-ref">{shipmentCode(order)}</span>
                    {specialist && order.requestId && <small><Link to={casesHref(order.requestId)}>View case</Link></small>}
                    <small>{formatDate(order.createdAt)}</small></th>
                  <td>{order.caseDispatchId ? lines.map(line => <small key={line.id}>
                    {items.get(line.resourceId)?.name} · {number.format(line.quantity)} {items.get(line.resourceId)?.unit}
                  </small>) : <>{resource?.name}<small>{data.actors[order.actorId] || order.actorId}</small></>}</td>
                  <td>{[...new Set(lines.map(line => line.origin))].join(' · ')}<small>→ {order.destination}</small>{order.requestId && <Link className="logistics-case-link" to={`/staff/cases/${order.requestId}`}>Open request</Link>}</td>
                  <td>{data.crises.find(row => row.id === order.crisisId)?.name || '—'}</td>
                  <td className="logistics-quantity">{order.caseDispatchId
                    ? <>{lines.length}<small>{lines.length === 1 ? 'stock line' : 'stock lines'}</small></>
                    : <>{number.format(order.quantity)}<small>{resource?.unit}</small></>}</td>
                  <td><Status label={order.caseDispatchId ? shipmentGroupStatus(lines) : labelFor(tab, order.status)} /></td>
                  <td><div className="logistics-shipment-actions">
                    {specialist && order.caseDispatchId && order.requestId && <Link className="logistics-link"
                      to={casesHref(order.requestId, { dispatch: order.caseDispatchId })}>
                      {order.centreReceivedAt ? 'View dispatch' : 'Open centre receipt'}
                    </Link>}
                    {next && <Button type="button" variant="secondary" onClick={() => open({ kind: 'transition', order, action: next })}>{actionLabels[next]}</Button>}
                    {order.status === 'Reserved' && <ReleaseReservationButton id={order.id} caseAllocation={!!order.requestId} onNotice={setNotice} />}
                    {receipt && <Button type="button" variant="ghost" onClick={() => open({ kind: 'receipt', receipt, order })}>
                      {receipt.exceptionDetail ? 'View delivery exception' : 'View receipt'}
                    </Button>}
                    {order.reason && <small>{order.reason}</small>}
                  </div></td>
                </tr>;
              })}</tbody>
            </table>}
          </div>}
        <footer className="logistics-pagination">
          <span>{count ? `Showing ${number.format(start + 1)}–${number.format(Math.min(start + pageSize, count))} of ${number.format(count)}` : 'Showing 0 results'}</span>
          {lastPage > 1 && <div role="group" aria-label="Logistics pages">
            <Button type="button" variant="secondary" disabled={shown === 1} aria-label="Previous page" onClick={() => setPage(shown - 1)}><ChevronLeft size={16} aria-hidden="true" /></Button>
            <span>Page {shown} of {lastPage}</span>
            <Button type="button" variant="secondary" disabled={shown === lastPage} aria-label="Next page" onClick={() => setPage(shown + 1)}><ChevronRight size={16} aria-hidden="true" /></Button>
          </div>}
        </footer>
      </Card>
      <aside className="logistics-sidebar" aria-label="Logistics activity">
        <Card className="logistics-widget">
          <header><h2><Truck size={21} aria-hidden="true" /> Recent dispatches</h2>
            <button type="button" onClick={() => {
              if (tab === 'dispatches') { setRecordFilter(''); setPage(1); }
              else chooseTab('dispatches');
            }}>View all <ArrowRight size={14} aria-hidden="true" /></button></header>
          {recentDispatches.length === 0 ? <p className="logistics-empty">No dispatches match these filters.</p> :
            <ul>{recentDispatches.slice(0, 4).map(lines => {
              const [order] = lines;
              return <li key={order.caseDispatchId ?? order.id}>
              <button className="logistics-ref logistics-link" type="button" onClick={() => {
                if (tab !== 'dispatches') chooseTab('dispatches');
                setRecordFilter(order.caseDispatchId ?? order.id);
                setPage(1);
              }}>{shipmentCode(order)}</button>
              <div><strong title={items.get(order.resourceId)?.name}>{order.caseDispatchId
                ? `${lines.length} stock ${lines.length === 1 ? 'line' : 'lines'}`
                : `${items.get(order.resourceId)?.name} (${number.format(order.quantity)} ${items.get(order.resourceId)?.unit})`}</strong>
                <small title={`${order.origin} → ${order.destination}`}>{order.origin} → {order.destination}</small></div>
              <div className="logistics-widget-right"><Status label={shipmentGroupStatus(lines)} />
                <small><time dateTime={order.updatedAt} title={formatDate(order.updatedAt)}>
                  {recentTime(order.updatedAt, i18n.resolvedLanguage)}
                </time></small></div>
              </li>;
            })}</ul>}
        </Card>
        <Card className="logistics-widget">
          <header><h2><TriangleAlert size={21} aria-hidden="true" /> Stock alerts</h2>
            <button type="button" onClick={() => { chooseTab('inventory'); setStatus('Stock alerts'); }}>View all <ArrowRight size={14} aria-hidden="true" /></button></header>
          {stockAlerts.length === 0 ? <p className="logistics-empty">No out-of-stock items or threshold breaches in scope.</p> :
            <ul>{stockAlerts.slice(0, 4).map(item => <li key={item.id}>
              <ItemIcon item={item} />
              <div><button className="logistics-link" type="button" onClick={() => open({ kind: 'details', resourceId: item.id })}>{item.name}</button>
                <small>{depotLabel(item)}{stockGap(item) > 0 && ` · ${number.format(stockGap(item))} ${item.unit} below threshold`}</small></div>
              <div className="logistics-widget-right"><strong>{number.format(item.available)} {item.unit} left</strong><Status label={inventoryStatus(item)} /></div>
            </li>)}</ul>}
        </Card>
      </aside>
    </div>
    {dialog && <LogisticsDialogs key={dialog.kind} state={dialog} data={data} defaultCountry={defaultCountry} change={open}
      close={() => setDialog(null)} saved={message => {
        if (dialog.kind === 'dispatch') chooseTab('dispatches');
        if (dialog.kind === 'transfer') chooseTab('transfers');
        if (dialog.kind === 'reservation') chooseTab('reservations');
        setNotice(message);
        setDialog(null);
      }} />}
  </div>;
}
