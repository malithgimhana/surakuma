import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { api, errorMessage, get } from './api';
import { Button, categories, DateInput, ErrorState, Field, formatDate, Loading } from './components';
import { CountryScope, RegionField, useCountry } from './geography';
import { OrganisationDialog } from './OrganisationDialog';
import { DeliveryFields, deliveryInput } from './DeliveryFields';
import { ResourceLocationFields } from './ResourceLocationFields';
import { isMeasuredUnit, stockLevelStep, unitSymbol } from './quantity';
import { ResourceUnitSelect } from './ResourceUnitSelect';
import { stockResourceItems } from './supplyItems';
import { actionLabels, resourceCode, shipmentCode, transferMatches } from './logistics';
import type { DepotOption, InventoryItem, LogisticsData, LogisticsDialogState } from './logistics';
import type { Category } from './types';

interface Write {
  path: string;
  data: object;
  message: string;
  method?: 'patch';
}

const read = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const optionalNumber = (form: FormData, name: string) => read(form, name) ? Number(read(form, name)) : null;
const quantityStep = (unit: string) => isMeasuredUnit(unit) ? 0.01 : 1;

async function refreshAfterWrite(client: QueryClient, caseQueueCountry?: string) {
  await client.invalidateQueries();
  if (caseQueueCountry) {
    await client.refetchQueries({ queryKey: ['logistics-cases', caseQueueCountry], type: 'inactive', stale: true });
  }
}

export function ReleaseReservationButton({ id, caseAllocation, onNotice }: {
  id: string;
  caseAllocation: boolean;
  onNotice: (message: string) => void;
}) {
  const client = useQueryClient();
  const country = useCountry();
  const release = useMutation({
    mutationFn: () => api.post(`/logistics/${caseAllocation ? 'allocations' : 'orders'}/${id}/cancel`, {
      reason: 'Reservation released by staff.',
    }),
    onMutate: () => onNotice(''),
    onSuccess: async () => {
      await refreshAfterWrite(client, caseAllocation ? country : undefined);
      onNotice('Reservation released. Stock is available again.');
    },
  });
  return <>
    <Button type="button" variant="ghost" title="Return reserved stock to the depot" busy={release.isPending} onClick={() => release.mutate()}>
      {release.isPending ? 'Releasing…' : 'Release'}
    </Button>
    {release.error && <p role="alert" className="field-error">{errorMessage(release.error)}</p>}
  </>;
}

export function LogisticsDialogs({ state, data, defaultCountry, change, close, saved }: {
  state: LogisticsDialogState;
  data: LogisticsData;
  defaultCountry: string;
  change: (state: LogisticsDialogState) => void;
  close: () => void;
  saved: (message: string) => void;
}) {
  const client = useQueryClient();
  const [operationId] = useState(() => crypto.randomUUID());
  const [depotDraft, setDepotDraft] = useState<{ country: string; operationId: string } | null>(null);
  const [selectedDepot, setSelectedDepot] = useState('');
  const [newDepot, setNewDepot] = useState<DepotOption | null>(null);
  const write = useMutation({
    mutationFn: ({ path, data, method }: Write) => api.request({ url: path, method: method ?? 'post', data }),
    onSuccess: async (response, { path, message }) => {
      await refreshAfterWrite(client, state.kind === 'transition' && state.order.requestId ? defaultCountry : undefined);
      if (path === '/logistics/depots' && depotDraft) {
        const depot = response.data as DepotOption;
        setNewDepot(depot);
        setSelectedDepot(depot.id);
        setDepotDraft(null);
        return;
      }
      saved(message);
    },
  });
  const managedItem = 'resourceId' in state ? data.inventory.find(row => row.id === state.resourceId) : undefined;
  const item = managedItem ?? (state.kind === 'details' ? data.caseInventory?.find(row => row.id === state.resourceId) : undefined);
  const titles = {
    resource: 'Add resource', depot: 'Register depot', stock: 'Record stock', dispatch: 'Create dispatch',
    reservation: 'Reserve stock', transfer: 'Create transfer', details: 'Resource details', receipt: 'Delivery receipt',
  };
  const title = depotDraft ? titles.depot : state.kind === 'transition' ? actionLabels[state.action] : titles[state.kind];
  const dismiss = () => {
    if (!depotDraft) {
      close();
      return;
    }
    write.reset();
    setDepotDraft(null);
  };
  const controls = (label: string, disabled = false) => (
    <div className="organisation-dialog-actions">
      <Button variant="secondary" type="button" disabled={write.isPending} onClick={dismiss}>Cancel</Button>
      <Button busy={write.isPending} disabled={disabled}>{label}</Button>
    </div>
  );
  const form = (event: FormEvent<HTMLFormElement>, build: (form: FormData) => Write) => {
    event.preventDefault();
    if (!write.isPending) write.mutate(build(new FormData(event.currentTarget)));
  };
  let content: ReactNode;
  switch (state.kind) {
    case 'resource':
      content = <>
        <div hidden={!!depotDraft}>
          <RegisterForm kind={state.kind} data={data} defaultCountry={state.country ?? defaultCountry}
            operationId={operationId} busy={write.isPending} form={form} controls={controls}
            selectedDepot={selectedDepot} setSelectedDepot={setSelectedDepot} newDepot={newDepot}
            registerDepot={country => {
              write.reset();
              setDepotDraft({ country, operationId: crypto.randomUUID() });
            }} />
        </div>
        {depotDraft && <RegisterForm kind="depot" data={data} defaultCountry={depotDraft.country}
          operationId={depotDraft.operationId} busy={write.isPending} form={form} controls={controls} />}
      </>;
      break;
    case 'stock':
    case 'dispatch':
    case 'reservation':
    case 'transfer':
      content = <MovementForm kind={state.kind} data={data} selected={state.resourceId} defaultCountry={defaultCountry}
        operationId={operationId} busy={write.isPending} form={form} controls={controls} />;
      break;
    case 'details':
      content = item ? <ResourceDetails resource={item} canManage={!!managedItem} data={data} form={form} controls={controls}
        busy={write.isPending} change={change} /> : <p>Resource is no longer available.</p>;
      break;
    case 'receipt': {
      const { receipt, order } = state;
      const unit = order.resourceUnit ?? data.inventory.find(row => row.id === order.resourceId)?.unit;
      content = <dl className="stack">
        <div><dt>Delivery reference</dt><dd>{receipt.reference}</dd></div>
        <div><dt>Confirmed quantity</dt><dd>{receipt.confirmedQuantity} of {order.quantity} {unit}</dd></div>
        <div><dt>Actual receipt time</dt><dd>{formatDate(receipt.receivedAt)}</dd></div>
        <div><dt>Received by</dt><dd>{receipt.receivedBy}</dd></div>
        <div><dt>Recorded by</dt><dd>{data.actors[receipt.actorId] ?? receipt.actorId}</dd></div>
        <div><dt>Confirmation method</dt><dd>{receipt.method === 'ReceivingStaff' ? 'Authorized receiving staff' : 'Recipient acknowledgment'}</dd></div>
        {receipt.note && <div><dt>Notes</dt><dd>{receipt.note}</dd></div>}
        {receipt.exceptionDetail && <div><dt>Delivery exception</dt><dd>{receipt.exceptionDetail}</dd></div>}
      </dl>;
      break;
    }
    case 'transition': {
      const { order, action } = state;
      const unit = order.resourceUnit ?? data.inventory.find(row => row.id === order.resourceId)?.unit;
      const description = action === 'prepare' ? 'Confirm the packed quantity and record the expected arrival time.'
        : action === 'dispatch'
          ? 'The reserved quantity will leave physical stock at the source.'
          : order.kind === 'Transfer' ? 'The destination depot will receive the quantity into physical stock.'
            : 'The shipment will be marked delivered.';
      content = <form className="stack" onSubmit={event => form(event, fields => ({
        path: `/${action === 'prepare' ? 'fulfillment' : 'logistics'}/${order.requestId ? 'allocations' : 'orders'}/${order.id}/${action}`,
        data: action === 'prepare' ? { packedQuantity: Number(read(fields, 'packedQuantity')), scheduledArrivalAt: read(fields, 'arrival') ? new Date(read(fields, 'arrival')).toISOString() : null, note: read(fields, 'reason') } : action === 'deliver' ? { delivery: deliveryInput(fields) } : { reason: read(fields, 'reason') }, message: action === 'prepare' ? 'Packing confirmed and arrival schedule saved.' : action === 'dispatch' ? 'Stock dispatched.'
          : 'Receipt confirmed.',
      }))}>
        <p><strong>{shipmentCode(order)}</strong> · {order.quantity} {unit}</p>
        <p>{order.origin} → {order.destination}</p>
        <p className="muted">{description}</p>
        {action === 'prepare' && <><Field label={`Packed quantity (${unit})`}><input name="packedQuantity" type="number" min={order.quantity} max={order.quantity} step={quantityStep(unit ?? '')} defaultValue={order.quantity} required /></Field><Field label="Scheduled arrival"><DateInput name="arrival" type="datetime-local" /></Field></>}
        {action === 'deliver'
          ? <DeliveryFields quantity={order.quantity} unit={unit} transfer={order.kind === 'Transfer'} />
          : <ReasonField />}
        {controls(title)}
      </form>;
      break;
    }
  }
  return <OrganisationDialog title={title} context={item?.name} busy={write.isPending} onDismiss={dismiss}>
    <div className="logistics-dialog-body">{content}
      {write.error && <p className="field-error" role="alert">{errorMessage(write.error)}</p>}
    </div>
  </OrganisationDialog>;
}

type FormProps = {
  data: LogisticsData;
  defaultCountry: string;
  operationId: string;
  busy: boolean;
  form: (event: FormEvent<HTMLFormElement>, build: (fields: FormData) => Write) => void;
  controls: (label: string, disabled?: boolean) => ReactNode;
};

type ResourceDraft = {
  id: string;
  category: Category;
  choice: string;
  name: string;
  unit: string;
  stock: string;
  threshold: string;
  code: string;
};

function validStockLevel(value: string, unit: string) {
  const amount = Number(value);
  const decimals = stockLevelStep(unit) === 1 ? 0 : 2;
  return value !== '' && amount >= 0 && amount <= 10000000 && Number(amount.toFixed(decimals)) === amount;
}

function RegisterForm({ kind, data, defaultCountry, operationId, busy, form, controls,
  selectedDepot = '', setSelectedDepot, newDepot, registerDepot }: FormProps & {
  kind: 'resource' | 'depot';
  selectedDepot?: string;
  setSelectedDepot?: (id: string) => void;
  newDepot?: DepotOption | null;
  registerDepot?: (country: string) => void;
}) {
  const { t } = useTranslation();
  const [country, setCountry] = useState(defaultCountry);
  const [category, setCategory] = useState<Category>(categories[0]);
  const [items, setItems] = useState<ResourceDraft[]>([]);
  const [activeId, setActiveId] = useState('');
  const [itemError, setItemError] = useState('');
  const active = items.find(item => item.id === activeId);
  const resourceOptions = stockResourceItems[category];
  const unit = active?.unit ?? '';
  const quantityUnit = t(`units.${unit}`, { defaultValue: unitSymbol(unit) });
  const stockStep = stockLevelStep(unit);
  const quantityHint = unit ? stockStep === 0.01
    ? `${quantityUnit} with up to two decimal places.`
    : `${quantityUnit} in whole numbers.`
    : 'Select a unit first.';
  const eligibleOrganisations = (data.resourceRegistration?.partners ?? data.partners).filter(p => p.countryCode === country);
  const depotOptions = data.resourceRegistration?.depots ?? data.depots.map(depot => ({ ...depot, canManageStock: true }));
  const depots = depotOptions.filter(depot => depot.countryCode === country
    && eligibleOrganisations.some(p => p.id === depot.organisationId));
  if (newDepot?.countryCode === country && !depots.some(row => row.id === newDepot.id)) {
    depots.push({ ...newDepot, canManageStock: data.partners.some(p =>
      p.id === newDepot.organisationId && p.countryCode === country) });
  }
  const depot = depots.find(row => row.id === selectedDepot);
  const depotRegistrars = eligibleOrganisations.filter(p => !('canRegisterDepot' in p) || p.canRegisterDepot);
  const isDepot = kind === 'depot';

  function editItem(item: ResourceDraft) {
    setCategory(item.category);
    setActiveId(item.id);
    setItemError('');
  }

  function updateItem(values: Partial<ResourceDraft>) {
    setItems(current => current.map(item => item.id === activeId ? { ...item, ...values } : item));
    setItemError('');
  }

  function chooseResource(choice: string) {
    if (!choice) {
      setActiveId('');
      return;
    }
    const existing = choice !== 'custom' && items.find(item => item.category === category && item.choice === choice);
    if (existing) {
      editItem(existing);
      return;
    }
    const standard = resourceOptions.find(item => item.id === choice);
    const item: ResourceDraft = {
      id: crypto.randomUUID(), category, choice, name: standard?.name ?? '', unit: standard?.stockUnit ?? '',
      stock: '0', threshold: '', code: '',
    };
    setItems(current => [...current, item]);
    editItem(item);
  }

  const itemName = (item: ResourceDraft) => item.choice === 'custom'
    ? item.name.trim() || 'Other resource'
    : t(`intake.${item.name}`, { defaultValue: item.name });
  const registeredMessage = items.length === 1 ? 'Resource registered.' : `${items.length} resources registered.`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isDepot) {
      form(event, fields => ({
        path: '/logistics/depots',
        data: { operationId, countryCode: country, organisationId: read(fields, 'organisation'), name: read(fields, 'name'), location: read(fields, 'location') },
        message: 'Depot registered. It is available when adding a resource.',
      }));
      return;
    }
    if (!depot || items.length === 0) return;
    if (items.length > 100) {
      setItemError('Select up to 100 resources to save at once.');
      return;
    }
    const invalid = items.find(item => !item.name.trim() || !item.unit || !validStockLevel(item.stock, item.unit)
      || (item.threshold !== '' && !validStockLevel(item.threshold, item.unit)));
    if (invalid) {
      editItem(invalid);
      setItemError(`Check the name, unit and stock quantities for ${itemName(invalid)}.`);
      return;
    }
    form(event, fields => {
      const location = {
        countryCode: country, depotId: depot.id, organisationId: depot.organisationId, locationText: depot.location,
        latitude: Number(read(fields, 'latitude')), longitude: Number(read(fields, 'longitude')),
        administrativeDivisionId: read(fields, 'administrativeDivisionId') || null,
        suitability: read(fields, 'suitability'), transportAvailable: fields.has('transport'),
      };
      const resources = items.map(item => ({
        ...location, operationId: item.id, name: item.name.trim(), code: item.code.trim() || null,
        category: item.category, unit: item.unit, stock: Number(item.stock),
        lowStockThreshold: item.threshold === '' ? null : Number(item.threshold),
      }));
      return {
        path: resources.length === 1 ? '/resources' : '/resources/batch',
        data: resources.length === 1 ? resources[0] : { resources },
        message: depot.canManageStock === false
          ? `${registeredMessage} Use Case Fulfillment to reserve stock for your assigned crisis.`
          : registeredMessage,
      };
    });
  }

  return (
    <form className="stack" onSubmit={submit}>
      <fieldset className="form-grid" disabled={busy}>
        {data.countries.length > 1 && !isDepot && <Field label="Country">
          <select value={country} onChange={event => { setCountry(event.target.value); setSelectedDepot?.(''); }} required>
            {data.countries.map(row => <option key={row.code} value={row.code}>{row.name}</option>)}
          </select>
        </Field>}
        {isDepot ? <>
          <Field label="Organisation">
            <select name="organisation" defaultValue="" required autoFocus>
              <option value="">Select an organisation</option>
              {depotRegistrars.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </Field>
          <Field label="Depot name"><input name="name" maxLength={120} required /></Field>
          <Field label="Depot location"><input name="location" maxLength={240} required /></Field>
        </> : <>
          <Field label="Depot">
            <select value={selectedDepot} onChange={event => setSelectedDepot?.(event.target.value)} required>
              <option value="">Select a depot</option>
              {depots.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <select name="category" value={category} onChange={event => {
              setCategory(event.target.value as Category);
              setActiveId('');
              setItemError('');
            }}>
              {categories.map(value => <option value={value} key={value}>{t(`category.${value}`)}</option>)}
            </select>
          </Field>
          <Field label="Resource name">
            <select value={active?.choice ?? ''} required={items.length === 0} onChange={event => chooseResource(event.target.value)}>
              <option value="">Select a resource</option>
              {resourceOptions.map(item => <option key={item.id} value={item.id}>
                {t(`intake.${item.name}`, { defaultValue: item.name })}
              </option>)}
              <option value="custom">Other resource</option>
            </select>
          </Field>
          <Field label="Unit"><ResourceUnitSelect name="unit" category={category} value={unit} disabled={!active}
            onChange={event => updateItem({ unit: event.target.value, stock: '0', threshold: '' })} required /></Field>
          {active?.choice === 'custom' && <div className="logistics-resource-selection">
            <Field label="Custom resource name"><input name="name" maxLength={100} required value={active.name}
              onChange={event => updateItem({ name: event.target.value })} /></Field>
          </div>}
          <Field label="Opening stock" hint={quantityHint}>
            <input name="stock" type="number" min={0} max={10000000} step={stockStep} value={active?.stock ?? ''}
              onChange={event => updateItem({ stock: event.target.value })} disabled={!unit} required />
          </Field>
          <Field label="Low-stock threshold" hint="Alerts appear below this amount of available stock.">
            <input name="threshold" type="number" min={0} max={10000000} step={stockStep} value={active?.threshold ?? ''}
              onChange={event => updateItem({ threshold: event.target.value })} disabled={!unit} />
          </Field>
          {items.length > 0 && <ul className="logistics-resource-selection logistics-resource-chips" aria-label="Selected resources">
            {items.map(item => <li key={item.id} className="logistics-resource-chip" data-active={item.id === activeId}>
              <button type="button" aria-pressed={item.id === activeId} onClick={() => editItem(item)}>
                {itemName(item)}{item.stock !== '' && item.unit ? ` · ${item.stock} ${unitSymbol(item.unit)}` : ''}
              </button>
              <button type="button" aria-label={`Remove ${itemName(item)}`} onClick={() => {
                setItems(current => current.filter(selected => selected.id !== item.id));
                if (item.id === activeId) setActiveId('');
                setItemError('');
              }}><X size={16} aria-hidden="true" /></button>
            </li>)}
          </ul>}
          {itemError && <p className="logistics-resource-selection field-error" role="alert">{itemError}</p>}
          <Field label="Resource code" hint="Optional. This code appears alongside the assigned RES reference.">
            <input name="code" maxLength={40} value={active?.code ?? ''} disabled={!active} onChange={event => updateItem({ code: event.target.value })} />
          </Field>
          <ResourceLocationFields key={country} country={country} />
          <CountryScope.Provider value={country}><RegionField key={country} hideDistrictSuffix /></CountryScope.Provider>
          <Field label="Suitability notes"><input name="suitability" maxLength={1000} /></Field>
          <label className="checkbox-label"><input name="transport" type="checkbox" defaultChecked />Transport available</label>
        </>}
      </fieldset>
      {isDepot ? (
        depotRegistrars.length === 0 && <p className="muted">A verified organisation with permission to register depots is required.</p>
      ) : registerDepot && depotRegistrars.length > 0 && <Button variant="secondary" type="button" disabled={busy} onClick={() => registerDepot(country)}>Register a depot</Button>}
      {controls(isDepot ? 'Save depot' : items.length > 1 ? `Save ${items.length} resources` : 'Save resource',
        isDepot ? depotRegistrars.length === 0 : !depot || items.length === 0)}
    </form>
  );
}

function MovementForm({ kind, data, selected, defaultCountry, operationId, busy, form, controls }: FormProps & {
  kind: 'stock' | 'dispatch' | 'reservation' | 'transfer'; selected?: string;
}) {
  const [resourceId, setResource] = useState(selected ?? '');
  const [crisisId, setCrisis] = useState('');
  const [destinationId, setDestination] = useState('');
  const [direction, setDirection] = useState('receive');
  const item = data.inventory.find(row => row.id === resourceId);
  const isStock = kind === 'stock';
  const isTransfer = kind === 'transfer';
  const sources = data.inventory.filter(row => isStock || row.canShip !== false && row.available > 0 && (!isTransfer || !!row.depotId))
    .sort((a, b) => Number(b.countryCode === defaultCountry) - Number(a.countryCode === defaultCountry) || a.name.localeCompare(b.name));
  const crises = data.crises.filter(row => row.countryCode === item?.countryCode && row.active);
  const destinations = item && data.inventory.filter(row => row.canShip !== false && transferMatches(item, row));
  const depotName = (row: InventoryItem) => data.depots.find(depot => depot.id === row.depotId)?.name ?? row.locationText;
  const quantityLimit = isStock ? direction === 'remove' ? item?.available : 10000000 : item?.available;
  const submitLabel = isStock ? 'Save stock movement' : isTransfer ? 'Queue transfer' : kind === 'reservation' ? 'Reserve stock' : 'Queue dispatch';
  return (
    <form className="stack" onSubmit={event => form(event, fields => {
      const quantity = Number(read(fields, 'quantity'));
      const reason = read(fields, 'reason');
      return isStock ? {
        path: `/logistics/resources/${resourceId}/stock`,
        data: { operationId, delta: direction === 'remove' ? -quantity : quantity, reason,
          movement: direction === 'receive' ? 'receive' : 'adjust' },
        message: 'Stock movement recorded.',
      } : {
        path: '/logistics/orders',
        data: { operationId, kind: isTransfer ? 'Transfer' : 'Dispatch', resourceId, quantity, reason,
          destinationResourceId: isTransfer ? destinationId : null,
          crisisId: isTransfer ? null : crisisId, operationalAreaId: isTransfer ? null : read(fields, 'area') || null },
        message: isTransfer ? 'Transfer queued. Stock is reserved at the origin.'
          : kind === 'reservation' ? 'Stock reserved for the crisis.' : 'Dispatch queued. Stock is reserved until dispatched.',
      };
    })}>
      <fieldset className="form-grid" disabled={busy}>
        <Field label="Resource">
          <select value={resourceId} onChange={event => { setResource(event.target.value); setCrisis(''); setDestination(''); }} required>
            <option value="">Choose a resource</option>
            {sources.map(row => <option key={row.id} value={row.id}>{row.name} · {depotName(row)} ({row.countryCode})</option>)}
          </select>
        </Field>
        {isStock ? <Field label="Movement">
          <select value={direction} onChange={event => setDirection(event.target.value)}>
            <option value="receive">Receive stock</option>
            <option value="add">Adjust stock up</option>
            <option value="remove">Adjust stock down</option>
          </select>
        </Field> : isTransfer ? <Field label="Destination depot">
          <select value={destinationId} onChange={event => setDestination(event.target.value)} required>
            <option value="">Choose a matching inventory record</option>
            {destinations?.map(row => <option key={row.id} value={row.id}>{depotName(row)} ({row.countryCode}) · {resourceCode(row)}</option>)}
          </select>
        </Field> : <>
          <Field label="Destination crisis">
            <select value={crisisId} onChange={event => setCrisis(event.target.value)} required>
              <option value="">Choose an active crisis</option>
              {crises.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </Field>
          <Field label="Operational area">
            <select name="area" key={crisisId} defaultValue="">
              <option value="">Crisis coordination point</option>
              {data.areas.filter(row => row.crisisId === crisisId).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </Field>
        </>}
        <Field label={item ? `Quantity (${item.unit})` : 'Quantity'} hint={item ? `${item.available} ${item.unit} available at source.` : undefined}>
          <input name="quantity" type="number" min={quantityStep(item?.unit ?? '')} max={quantityLimit}
            step={quantityStep(item?.unit ?? '')} required />
        </Field>
      </fieldset>
      <ReasonField />
      {sources.length === 0 && <p className="muted">No eligible resources have been recorded for this action.</p>}
      {item && isTransfer && destinations?.length === 0 && <p className="muted">Register the same resource with a compatible unit at the destination depot first.</p>}
      {item && !isTransfer && !isStock && crises.length === 0 && <p className="muted">An active crisis in the source country is required.</p>}
      {controls(submitLabel, !item || !quantityLimit || (!isStock && (isTransfer ? !destinationId : !crisisId)))}
    </form>
  );
}

function ResourceDetails({ resource, canManage, data, busy, form, controls, change }: Pick<FormProps, 'data' | 'busy' | 'form' | 'controls'> & {
  resource: InventoryItem; canManage: boolean; change: (state: LogisticsDialogState) => void;
}) {
  const [threshold, setThreshold] = useState(resource.lowStockThreshold?.toString() ?? '');
  const stockStep = stockLevelStep(resource.unit);
  const savedThreshold = resource.lowStockThreshold;
  const keepLegacyThreshold = stockStep === 1 && savedThreshold != null && !Number.isInteger(savedThreshold)
    && threshold !== '' && Number(threshold) === savedThreshold;
  const depot = (data.resourceRegistration?.depots ?? data.depots).find(row => row.id === resource.depotId);
  const history = useQuery({
    queryKey: ['logistics-history', resource.id],
    enabled: canManage,
    queryFn: () => get<Array<{ id: string; operationId: string | null; kind: string; quantity: number; actorName: string | null;
      actorId: string; origin: string | null; destination: string | null; crisisId: string | null; requestId: string | null;
      note: string; createdAt: string }>>(`/logistics/resources/${resource.id}/history`),
  });
  const summary = <>
    <p><strong>{resourceCode(resource)}</strong> · {depot?.name ?? resource.locationText} · {resource.countryCode}</p>
    <p>{resource.stock} physical · {resource.reserved} reserved · {resource.available} available ({resource.unit})</p>
    {resource.suitability && <p>{resource.suitability}</p>}
    <p className="muted">{resource.transportAvailable ? 'Transport available' : 'Transport unavailable'}</p>
  </>;
  if (!canManage) return <>{summary}<p className="muted">Use Case Fulfillment to reserve stock for a case in your assigned crisis.</p></>;
  return <>
    {summary}
    <Button type="button" variant="secondary" onClick={() => change({ kind: 'stock', resourceId: resource.id })}>Record stock</Button>
    <details className="logistics-config">
      <summary>Resource configuration</summary>
      <form className="stack" onSubmit={event => form(event, fields => ({
        path: `/logistics/resources/${resource.id}/configuration`, method: 'patch',
        data: { code: read(fields, 'code') || null, depotId: resource.depotId || read(fields, 'depot') || null,
          lowStockThreshold: optionalNumber(fields, 'threshold') },
        message: 'Resource settings saved.',
      }))}>
        <fieldset className="form-grid" disabled={busy}>
          <Field label="Resource code"><input name="code" defaultValue={resource.code ?? ''} maxLength={40} /></Field>
          <Field label="Low-stock threshold"><input name="threshold" type="number" min={0} max={10000000}
            step={keepLegacyThreshold ? 'any' : stockStep} value={threshold} onChange={event => setThreshold(event.target.value)} /></Field>
          {!resource.depotId && <Field label="Assign existing location to a depot">
            <select name="depot" defaultValue="">
              <option value="">Keep legacy location</option>
              {data.depots.filter(row => row.organisationId === resource.organisationId && row.countryCode === resource.countryCode)
                .map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </Field>}
        </fieldset>
        {controls('Save settings')}
      </form>
    </details>
    <h3>Stock movement ledger</h3>
    {history.isPending ? <Loading /> : history.isError ? <ErrorState error={history.error} retry={() => history.refetch()} />
      : history.data.length === 0 ? <p>No stock movements recorded.</p> : <ol className="logistics-ledger">
        {history.data.map(entry => (
          <li key={entry.id}>
            <strong>{entry.kind} · {entry.quantity} {resource.unit}</strong>
            <small>{formatDate(entry.createdAt)} · {entry.actorName || entry.actorId || 'Unknown user'}</small>
            {(entry.origin || entry.destination) && <small>{[entry.origin, entry.destination].filter(Boolean).join(' → ')}</small>}
            {entry.note && <p>{entry.note}</p>}
            {entry.crisisId && <small>Crisis {data.crises.find(row => row.id === entry.crisisId)?.name ?? entry.crisisId}</small>}
            {entry.requestId && <small>Request {entry.requestId}</small>}
            <small>Reference {entry.operationId || entry.id}</small>
          </li>
        ))}
      </ol>}
  </>;
}

function ReasonField() {
  return <Field label="Reason"><textarea name="reason" rows={3} required maxLength={1000} /></Field>;
}
