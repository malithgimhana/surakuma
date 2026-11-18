import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, errorMessage, get } from './api';
import { Button, categories, ErrorState, Field, formatDate, Loading } from './components';
import { CountryScope, RegionField } from './geography';
import { OrganisationDialog } from './OrganisationDialog';
import { DeliveryFields, deliveryInput } from './DeliveryFields';
import { ResourceLocationFields } from './ResourceLocationFields';
import { isMeasuredUnit } from './quantity';
import { actionLabels, resourceCode, shipmentCode, transferMatches } from './logistics';
import type { InventoryItem, LogisticsData, LogisticsDialogState } from './logistics';

interface Write {
  path: string;
  data: object;
  message: string;
  method?: 'patch';
}

const read = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const optionalNumber = (form: FormData, name: string) => read(form, name) ? Number(read(form, name)) : null;
const quantityStep = (unit: string) => isMeasuredUnit(unit) ? 0.01 : 1;

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
  const write = useMutation({
    mutationFn: ({ path, data, method }: Write) => api.request({ url: path, method: method ?? 'post', data }),
    onSuccess: async (_, { message }) => {
      await client.invalidateQueries();
      saved(message);
    },
  });
  const item = 'resourceId' in state ? data.inventory.find(row => row.id === state.resourceId) : undefined;
  const titles = {
    resource: 'Add resource', depot: 'Register depot', stock: 'Record stock', dispatch: 'Create dispatch',
    reservation: 'Reserve stock', transfer: 'Create transfer', details: 'Resource details', receipt: 'Delivery receipt',
  };
  const title = state.kind === 'transition' ? actionLabels[state.action] : titles[state.kind];
  const controls = (label: string, disabled = false) => (
    <div className="organisation-dialog-actions">
      <Button variant="secondary" type="button" disabled={write.isPending} onClick={close}>Cancel</Button>
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
    case 'depot':
      content = <RegisterForm kind={state.kind} data={data} defaultCountry={state.country ?? defaultCountry}
        operationId={operationId} busy={write.isPending} form={form} controls={controls} change={change} />;
      break;
    case 'stock':
    case 'dispatch':
    case 'reservation':
    case 'transfer':
      content = <MovementForm kind={state.kind} data={data} selected={state.resourceId} defaultCountry={defaultCountry}
        operationId={operationId} busy={write.isPending} form={form} controls={controls} />;
      break;
    case 'details':
      content = item ? <ResourceDetails resource={item} data={data} form={form} controls={controls}
        busy={write.isPending} change={change} /> : <p>Resource is no longer available.</p>;
      break;
    case 'receipt': {
      const { receipt, order } = state;
      const unit = data.inventory.find(row => row.id === order.resourceId)?.unit;
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
      const unit = data.inventory.find(row => row.id === order.resourceId)?.unit;
      const description = action === 'cancel'
        ? 'The reserved quantity will become available at the source.'
        : action === 'dispatch'
          ? 'The reserved quantity will leave physical stock at the source.'
          : order.kind === 'Transfer' ? 'The destination depot will receive the quantity into physical stock.'
            : 'The shipment will be marked delivered.';
      content = <form className="stack" onSubmit={event => form(event, fields => ({
        path: `/logistics/${order.requestId ? 'allocations' : 'orders'}/${order.id}/${action}`,
        data: action === 'deliver' ? { delivery: deliveryInput(fields) } : { reason: read(fields, 'reason') }, message: action === 'dispatch' ? 'Stock dispatched.'
          : action === 'deliver' ? 'Receipt confirmed.' : 'Reservation released.',
      }))}>
        <p><strong>{shipmentCode(order)}</strong> · {order.quantity} {unit}</p>
        <p>{order.origin} → {order.destination}</p>
        <p className="muted">{description}</p>
        {action === 'deliver'
          ? <DeliveryFields quantity={order.quantity} unit={unit} transfer={order.kind === 'Transfer'} />
          : <ReasonField />}
        {controls(title)}
      </form>;
      break;
    }
  }
  return <OrganisationDialog title={title} context={item?.name} busy={write.isPending} onDismiss={close}>
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

function RegisterForm({ kind, data, defaultCountry, operationId, busy, form, controls, change }: FormProps & {
  kind: 'resource' | 'depot'; change: (state: LogisticsDialogState) => void;
}) {
  const { t } = useTranslation();
  const [country, setCountry] = useState(defaultCountry);
  const [depotId, setDepot] = useState('');
  const [unit, setUnit] = useState('packs');
  const depots = data.depots.filter(depot => depot.countryCode === country
    && data.partners.some(p => p.countryCode === country && p.id === depot.organisationId));
  const depot = depots.find(row => row.id === depotId);
  const partners = data.partners.filter(row => row.countryCode === country);
  const isDepot = kind === 'depot';
  return (
    <form className="stack" onSubmit={event => form(event, fields => isDepot ? {
      path: '/logistics/depots',
      data: { operationId, countryCode: country, organisationId: read(fields, 'organisation'), name: read(fields, 'name'), location: read(fields, 'location') },
      message: 'Depot registered. It is available when adding a resource.',
    } : {
      path: '/resources',
      data: {
        operationId, countryCode: country, depotId, organisationId: depot?.organisationId, locationText: depot?.location,
        name: read(fields, 'name'), code: read(fields, 'code') || null, category: read(fields, 'category'), unit,
        stock: Number(read(fields, 'stock')), lowStockThreshold: optionalNumber(fields, 'threshold'),
        latitude: Number(read(fields, 'latitude')), longitude: Number(read(fields, 'longitude')),
        administrativeDivisionId: read(fields, 'administrativeDivisionId') || null,
        suitability: read(fields, 'suitability'), transportAvailable: fields.has('transport'),
      },
      message: 'Resource registered.',
    })}>
      <fieldset className="form-grid" disabled={busy}>
        <Field label="Country">
          <select value={country} onChange={event => { setCountry(event.target.value); setDepot(''); }} required>
            {data.countries.map(row => <option key={row.code} value={row.code}>{row.name}</option>)}
          </select>
        </Field>
        {isDepot ? <>
          <Field label="Organisation">
            <select name="organisation" key={country} defaultValue="" required>
              <option value="">Select an organisation</option>
              {partners.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </Field>
          <Field label="Depot name"><input name="name" maxLength={120} required /></Field>
          <Field label="Depot location"><input name="location" maxLength={240} required /></Field>
        </> : <>
          <Field label="Depot">
            <select value={depotId} onChange={event => setDepot(event.target.value)} required>
              <option value="">Select a depot</option>
              {depots.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </Field>
          <Field label="Resource name"><input name="name" maxLength={100} required /></Field>
          <Field label="Resource code" hint="Leave blank to use an automatic reference."><input name="code" maxLength={40} /></Field>
          <Field label="Category">
            <select name="category">
              {categories.map(value => <option value={value} key={value}>{t(`category.${value}`)}</option>)}
            </select>
          </Field>
          <Field label="Unit"><input name="unit" value={unit} onChange={event => setUnit(event.target.value)} maxLength={40} required /></Field>
          <Field label="Opening stock"><input name="stock" type="number" min={0} max={10000000} step={quantityStep(unit)} defaultValue={0} required /></Field>
          <Field label="Low-stock threshold" hint="Alerts appear below this amount of available stock.">
            <input name="threshold" type="number" min={0} max={10000000} step={quantityStep(unit)} />
          </Field>
          <ResourceLocationFields key={country} country={country} />
          <CountryScope.Provider value={country}><RegionField key={country} /></CountryScope.Provider>
          <Field label="Suitability notes"><input name="suitability" maxLength={1000} /></Field>
          <label className="checkbox-label"><input name="transport" type="checkbox" defaultChecked />Transport available</label>
        </>}
      </fieldset>
      {isDepot ? (
        partners.length === 0 && <p className="muted">Register or verify an organisation in {data.countries.find(row => row.code === country)?.name} first.</p>
      ) : <Button variant="secondary" type="button" disabled={busy} onClick={() => change({ kind: 'depot', country })}>Register a depot</Button>}
      {controls(isDepot ? 'Save depot' : 'Save resource', isDepot ? partners.length === 0 : !depot)}
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
  const sources = data.inventory.filter(row => isStock || row.available > 0 && (!isTransfer || !!row.depotId))
    .sort((a, b) => Number(b.countryCode === defaultCountry) - Number(a.countryCode === defaultCountry) || a.name.localeCompare(b.name));
  const crises = data.crises.filter(row => row.countryCode === item?.countryCode && row.active);
  const destinations = item && data.inventory.filter(row => transferMatches(item, row));
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
      {item && isTransfer && destinations?.length === 0 && <p className="muted">Register the same resource and unit at the destination depot first.</p>}
      {item && !isTransfer && !isStock && crises.length === 0 && <p className="muted">An active crisis in the source country is required.</p>}
      {controls(submitLabel, !item || !quantityLimit || (!isStock && (isTransfer ? !destinationId : !crisisId)))}
    </form>
  );
}

function ResourceDetails({ resource, data, busy, form, controls, change }: Pick<FormProps, 'data' | 'busy' | 'form' | 'controls'> & {
  resource: InventoryItem; change: (state: LogisticsDialogState) => void;
}) {
  const depot = data.depots.find(row => row.id === resource.depotId);
  const history = useQuery({
    queryKey: ['logistics-history', resource.id],
    queryFn: () => get<Array<{ id: string; operationId: string | null; kind: string; quantity: number; actorName: string | null;
      actorId: string; origin: string | null; destination: string | null; crisisId: string | null; requestId: string | null;
      note: string; createdAt: string }>>(`/logistics/resources/${resource.id}/history`),
  });
  return <>
    <p><strong>{resourceCode(resource)}</strong> · {depot?.name ?? resource.locationText} · {resource.countryCode}</p>
    <p>{resource.stock} physical · {resource.reserved} reserved · {resource.available} available ({resource.unit})</p>
    {resource.suitability && <p>{resource.suitability}</p>}
    <p className="muted">{resource.transportAvailable ? 'Transport available' : 'Transport unavailable'}</p>
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
            step={quantityStep(resource.unit)} defaultValue={resource.lowStockThreshold ?? ''} /></Field>
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
