import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage, get } from './api';
import { Badge, Button, Card, Empty, ErrorState, Field, Loading, PageHeader, categories } from './components';
import { countryPath } from './crisisOperationsApi';
import { useCountry } from './geography';
import { ResourceUnitSelect } from './ResourceUnitSelect';
import { isMeasuredUnit, unitSymbol } from './quantity';
import type { Category } from './types';

interface Organisation { id: string; name: string }
interface SupplyRow {
  id: string; requestingOrganisationId: string; targetOrganisationId: string; category: Category; unit: string;
  quantity: number; receivedQuantity: number; reason: string; cancelled: boolean;
}
interface SupportData {
  requests: SupplyRow[]; organisations: Organisation[]; requestingOrganisations: Organisation[];
  offeringOrganisations: Organisation[]; receivableCommitments: { id: string; supportRequestId: string; title: string }[];
}
const values = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); return new FormData(e.currentTarget); };

export default function SupplySupport() {
  const country = useCountry();
  const [params] = useSearchParams();
  const path = '/supply-support/' + country;
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['supply-support', country], queryFn: () => get<SupportData>(path) });
  const write = useMutation({
    mutationFn: (input: { path: string; data: unknown }) => api.post(countryPath(input.path, country), input.data),
    onSuccess: () => client.invalidateQueries(),
  });
  const [operation, setOperation] = useState(() => crypto.randomUUID());
  const [from, setFrom] = useState(params.get('organisation') ?? '');
  const [unit, setUnit] = useState(params.get('unit') ?? '');
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const data = query.data;
  const orgName = (id: string) => data.organisations.find(o => o.id === id)?.name ?? 'Archived organisation';
  const source = data.requestingOrganisations.find(o => o.id === from) ?? data.requestingOrganisations[0];
  const caseId = params.get('case'), shelterId = params.get('shelter'), category = params.get('category');
  return <div className="stack">
    <PageHeader title="Supply support" description="Request essential supplies from a verified organisation and reconcile physical receipts." />
    {write.error && <p role="alert">{errorMessage(write.error)}</p>}
    {write.isSuccess && <p role="status">Supply support records updated.</p>}
    {source && <Card><h2>{shelterId ? 'Report a shelter shortage' : caseId ? 'Request supplies for this case' : 'Request supplies from another organisation'}</h2>
      <form className="form-grid" onChange={() => setOperation(crypto.randomUUID())} onSubmit={e => {
        const data = values(e);
        write.mutate({ path, data: {
          operationId: operation, requestingOrganisationId: source.id, targetOrganisationId: data.get('target'),
          caseId, shelterId, category: caseId && category ? category : data.get('category'),
          unit: data.get('unit'), quantity: Number(data.get('quantity')), reason: data.get('reason'),
        } });
      }}>
        {params.has('organisation') ? <p>Requesting organisation · {source.name}</p> :
          <Field label="Requesting organisation"><select value={source.id} onChange={e => setFrom(e.target.value)}>
            {data.requestingOrganisations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>}
        <Field label="Support organisation"><select name="target" required>
          <option value="">Choose a verified organisation</option>
          {data.organisations.filter(o => o.id !== source.id).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select></Field>
        {caseId && category ? <p>Aid category · {category}</p> : <Field label="Aid category"><select name="category">
          {categories.map(c => <option key={c}>{c}</option>)}</select></Field>}
        <Field label="Unit"><ResourceUnitSelect name="unit" value={unit} onChange={e => setUnit(e.target.value)} required /></Field>
        <Field label="Quantity"><input name="quantity" type="number" min={isMeasuredUnit(unit) ? 0.01 : 1}
          max="10000000" step={isMeasuredUnit(unit) ? 0.01 : 1} required /></Field>
        <Field label="Operational need" hint="Include only details the receiving organisation needs. Keep household and personal information in the case.">
          <textarea name="reason" maxLength={1000} required />
        </Field>
        <Button busy={write.isPending}>Send supply request</Button>
      </form>
    </Card>}
    {!data.requests.length && <Empty title="No supply requests in your scope" />}
    {data.requests.map(row => <Card key={row.id}>
      <h2>{row.category} · {orgName(row.requestingOrganisationId)}</h2>
      <p>Requested from {orgName(row.targetOrganisationId)} · <Badge value={row.cancelled ? 'Cancelled' : row.receivedQuantity === row.quantity ? 'Fulfilled' : 'Open'} /></p>
      <p>{row.receivedQuantity} of {row.quantity} {row.unit} received</p><p>{row.reason}</p>
      {!row.cancelled && row.receivedQuantity < row.quantity && data.offeringOrganisations.some(o => o.id === row.targetOrganisationId) &&
        <OfferSupplies country={country} row={row} />}
      {data.receivableCommitments.filter(c => c.supportRequestId === row.id).map(c =>
        <details key={c.id}><summary>Receive accepted offer · {c.title}</summary><ContributionReceipt id={c.id} country={country} /></details>)}
      {!row.cancelled && !row.receivedQuantity && data.requestingOrganisations.some(o => o.id === row.requestingOrganisationId) &&
        <details><summary>Cancel supply request</summary><form className="stack" onSubmit={e => {
          const data = values(e);
          write.mutate({ path: path + '/' + row.id + '/cancel', data: { reason: data.get('reason') } });
        }}>
          <Field label="Cancellation reason"><input name="reason" maxLength={1000} required /></Field>
          <Button busy={write.isPending}>Cancel request</Button>
        </form></details>}
    </Card>)}
  </div>;
}

function OfferSupplies({ row, country }: { row: SupplyRow; country: string }) {
  const [operationId, changeId] = useState(() => crypto.randomUUID());
  const client = useQueryClient();
  const write = useMutation({
    mutationFn: (data: unknown) => api.post(countryPath('/partner/contributions', country), data),
    onSuccess: () => client.invalidateQueries(),
  });
  return <details><summary>Offer supplies</summary>
    <form className="form-grid" onChange={() => changeId(crypto.randomUUID())} onSubmit={e => {
      const data = values(e);
      write.mutate({
        operationId, organisationId: row.targetOrganisationId, supportRequestId: row.id,
        title: data.get('title'), kind: 'Resource', category: row.category, unit: row.unit,
        quantity: Number(data.get('quantity')), description: data.get('description'),
      });
    }}>
      <Field label="Offer title"><input name="title" maxLength={160} required /></Field>
      <Field label="Offered quantity"><input name="quantity" type="number" min="0.01" max={row.quantity - row.receivedQuantity} step="0.01" required /></Field>
      <Field label="Offer details"><textarea name="description" maxLength={2000} required /></Field>
      <Button busy={write.isPending}>Submit offer for approval</Button>
      {write.error && <p role="alert">{errorMessage(write.error)}</p>}
      {write.isSuccess && <p role="status">Offer recorded. An administrator can review it under Partner commitments.</p>}
    </form>
  </details>;
}
export function ContributionReceipt({ id, country }: { id: string; country: string }) {
  const client = useQueryClient();
  const path = '/supply-support/' + country + '/contributions/' + id + '/receipts';
  const query = useQuery({
    queryKey: ['partner-receipts', country, id],
    queryFn: () => get<{ resources: { id: string; name: string; unit: string }[]; remaining: number; unit: string }>(countryPath(path, country)),
  });
  const [operationId, changeId] = useState(() => crypto.randomUUID());
  const write = useMutation({ mutationFn: (data: unknown) => api.post(countryPath(path, country), data), onSuccess: () => client.invalidateQueries() });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} />;
  if (!query.data.remaining) return <p>All committed units have been received.</p>;
  if (!query.data.resources.length) return <p>No compatible inventory item is available in your scope.</p>;
  return <form className="form-grid" onChange={() => changeId(crypto.randomUUID())} onSubmit={e => {
    const data = values(e);
    write.mutate({ operationId, resourceId: data.get('resource'), reference: data.get('reference'), quantity: Number(data.get('quantity')) });
  }}>
    <Field label="Receiving inventory"><select name="resource">
      {query.data.resources.map(r => <option key={r.id} value={r.id}>{r.name} ({r.unit})</option>)}</select></Field>
    <Field label="Actual quantity received" hint={`Enter the receipt quantity in ${unitSymbol(query.data.unit)}.`}>
      <input name="quantity" type="number" min={isMeasuredUnit(query.data.unit) ? 0.01 : 1} max={query.data.remaining}
        step={isMeasuredUnit(query.data.unit) ? 0.01 : 1} required />
    </Field>
    <Field label="Physical receipt reference"><input name="reference" maxLength={100} required /></Field>
    <Button busy={write.isPending}>Confirm stock receipt</Button>
    {write.isSuccess && <p role="status">Inventory receipt recorded.</p>}
    {write.error && <p role="alert">{errorMessage(write.error)}</p>}
  </form>;
}
