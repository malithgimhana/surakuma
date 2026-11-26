import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Clock, Package, Plus, Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, errorMessage, get } from './api';
import { Badge, Button, Card, Empty, ErrorState, Field, formatDate, IconTile, Loading, PageHeader, categories } from './components';
import { countryPath } from './crisisOperationsApi';
import { useCountry } from './geography';
import { useAuth } from './auth';
import { isShelterWorkspace, shelterPath } from './countryScope';
import { ResourceUnitSelect } from './ResourceUnitSelect';
import { baseUnit, isMeasuredUnit, unitSymbol } from './quantity';
import type { Category } from './types';

interface Organisation { id: string; name: string }
interface SupplyRow {
  id: string; requestingOrganisationId: string; targetOrganisationId: string; category: Category; unit: string;
  reference: string;
  quantity: number; receivedQuantity: number; reason: string; cancelled: boolean;
  createdAt?: string; resourceName?: string | null; destination?: string | null;
}
interface SupportOffer { id: string; supportRequestId: string; title: string; unit: string; status: string }
interface SupportData {
  requests: SupplyRow[]; organisations: Organisation[]; requestingOrganisations: Organisation[];
  offeringOrganisations: Organisation[]; receivableCommitments: { id: string; supportRequestId: string; title: string }[];
  commitments?: SupportOffer[];
  receipts?: { id: string; contributionId: string; quantity: number; reference: string; createdAt: string; discrepancy?: string | null }[];
  statistics?: { total: number; awaiting: number; active: number; delivered: number };
}
const values = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); return new FormData(e.currentTarget); };

export function SupplyReferenceSearch({ search, onSearch }: { search: string; onSearch: (search: string) => void }) {
  return <form role="search" className="toolbar" onSubmit={event => onSearch(String(values(event).get('reference') ?? '').trim())}>
    <Field label="Find supply request by reference"><input type="search" name="reference" defaultValue={search} /></Field>
    <Button type="submit" variant="secondary">Search</Button>
  </form>;
}

export default function SupplySupport() {
  const country = useCountry();
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const location = useLocation();
  const { user } = useAuth();
  const workspace = isShelterWorkspace(user, location.pathname, location.search);
  const path = '/supply-support/' + country;
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: ['supply-support', country, search, workspace],
    queryFn: () => get<SupportData>(search ? path + '?search=' + encodeURIComponent(search) : path),
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === country && previousQuery.queryKey[3] === workspace ? previous : undefined,
  });
  const write = useMutation({
    mutationFn: (input: { path: string; data: unknown }) => api.post(countryPath(input.path, country), input.data),
    onSuccess: () => client.invalidateQueries(),
  });
  const [operation, setOperation] = useState(() => crypto.randomUUID());
  const [from, setFrom] = useState(params.get('organisation') ?? '');
  const [selectedCategory, setCategory] = useState<string>(categories[0]);
  const [unit, setUnit] = useState(params.get('unit') ?? '');
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const data = query.data;
  const orgName = (id: string) => data.organisations.find(o => o.id === id)?.name ?? 'Archived organisation';
  const source = data.requestingOrganisations.find(o => o.id === (params.get('organisation') ?? from)) ?? (!params.has('organisation') ? data.requestingOrganisations[0] : undefined);
  const caseId = workspace ? null : params.get('case'), shelterId = params.get('shelter');
  const caseCategory = caseId ? params.get('category') : null;
  const caseUnit = caseCategory ? params.get('unit') : null;
  const linkedUnit = baseUnit(caseUnit) === 'persons' ? null : caseUnit;
  const requestForm = source ? <Card>
    <h2>{workspace && <Plus size={19} aria-hidden="true" />}{shelterId ? 'Report a shelter shortage' :
      caseId ? 'Request supplies for this case' : workspace ? 'New supply request' : 'Request supplies from another organisation'}</h2>
      <form className="form-grid" onChange={() => setOperation(crypto.randomUUID())} onSubmit={e => {
        const data = values(e);
        if (write.isPending) return;
        const reason = e.currentTarget.elements.namedItem('reason') as HTMLTextAreaElement;
        if (!reason.value.trim()) {
          reason.setCustomValidity('Describe the operational need.');
          reason.reportValidity();
          return;
        }
        write.mutate({ path, data: {
          operationId: operation, requestingOrganisationId: source.id, targetOrganisationId: data.get('target'),
           caseId, shelterId, category: caseCategory ?? data.get('category'),
          unit: data.get('unit'), quantity: Number(data.get('quantity')), reason: String(data.get('reason')).trim(),
        } });
      }}>
        {params.has('organisation') ? <p>Requesting organisation · {source.name}</p> :
          <Field label="Requesting organisation"><select value={source.id} onChange={e => setFrom(e.target.value)}>
            {data.requestingOrganisations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>}
        <Field label={workspace ? "Supporting organisation" : "Support organisation"}><select name="target" required>
          <option value="">Choose a verified organisation</option>
          {data.organisations.filter(o => o.id !== source.id).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select></Field>
         {caseCategory ? <p>Aid category · {caseCategory}</p> : <Field label="Aid category"><select name="category"
           value={selectedCategory} onChange={e => { setCategory(e.target.value); setUnit(''); }}>
          {categories.map(c => <option key={c} value={c}>{workspace ? t('category.' + c) : c}</option>)}</select></Field>}
         <Field label="Unit"><ResourceUnitSelect name="unit" category={caseCategory ?? selectedCategory} existingUnit={linkedUnit}
           compatibleWith={caseUnit} value={unit} onChange={e => setUnit(e.target.value)} required /></Field>
        <Field label="Quantity"><input name="quantity" type="number" min={isMeasuredUnit(unit) ? 0.01 : 1}
          max="10000000" step={isMeasuredUnit(unit) ? 0.01 : 1} required /></Field>
        <Field label="Operational need" hint="Include only details the receiving organisation needs. Keep household and personal information in the case.">
          <textarea name="reason" maxLength={1000} required onInput={e => e.currentTarget.setCustomValidity('')} />
        </Field>
        <Button busy={write.isPending}>Send supply request</Button>
      </form>
  </Card> : workspace ? <Card><Empty title="No authorized requesting organisation"
    description="Select a shelter operated by one of your verified organisations." /></Card> : null;
  const requestActions = (row: SupplyRow) => <>
      {!row.cancelled && row.receivedQuantity < row.quantity && data.offeringOrganisations.some(o => o.id === row.targetOrganisationId) &&
        <OfferSupplies country={country} row={row} />}
      {data.receivableCommitments.filter(c => c.supportRequestId === row.id).map(c =>
        <details key={c.id}><summary>Receive accepted offer · {c.title}</summary><ContributionReceipt id={c.id} country={country} /></details>)}
      {!row.cancelled && !row.receivedQuantity && data.requestingOrganisations.some(o => o.id === row.requestingOrganisationId) &&
        !data.commitments?.some(c => c.supportRequestId === row.id && ['Accepted', 'InProgress', 'Fulfilled'].includes(c.status)) &&
        <details><summary>Cancel supply request</summary><form className="stack" onSubmit={e => {
          const data = values(e);
          if (write.isPending) return;
          write.mutate({ path: path + '/' + row.id + '/cancel', data: { reason: data.get('reason') } });
        }}>
          <Field label="Cancellation reason"><input name="reason" maxLength={1000} required /></Field>
          <Button busy={write.isPending}>Cancel request</Button>
        </form></details>}
  </>;
  const feedback = <>
    {write.error && <p role="alert" className="field-error">{errorMessage(write.error)}</p>}
    {write.isSuccess && <p role="status" className="success-text">Supply support records updated.</p>}
  </>;
  const searchForm = <SupplyReferenceSearch search={search} onSearch={setSearch} />;
  const empty = !data.requests.length && <Empty title={search ? 'No matching supply requests' : 'No supply requests in your scope'} />;
  if (workspace) return <div className="shelter-page shelter-management stack">
    <PageHeader title="Supply Support" description="Request essential items from verified partners and track physical deliveries."
      action={<Link className="button secondary" to={shelterPath()}><ArrowLeft size={16} />Back to overview</Link>} />
    <section className="shelter-metrics shelter-supply-metrics" aria-label="Supply request statistics">
      {([
        ['total', 'Total requests', Package, 'blue'], ['awaiting', 'Awaiting response', Clock, 'purple'],
        ['active', 'In progress', Truck, 'blue'], ['delivered', 'Delivered', CheckCircle2, 'green'],
      ] as const).map(([key, label, Icon, tone]) => <Card key={key} className="shelter-stat">
        <IconTile icon={Icon} tone={tone} /><div><span>{label}</span><strong>{data.statistics?.[key]?.toLocaleString() ?? '—'}</strong></div>
      </Card>)}
    </section>
    {feedback}
    <div className="shelter-supply-grid">
      {requestForm}
      <Card>
        <h2><Package size={19} /> Delivery workflow</h2>
        <ol className="shelter-supply-workflow">
          <li><strong>Send a supply request</strong><span>Specify the item, quantity and operational need.</span></li>
          <li><strong>Track the partner response</strong><span>Review offers and fulfillment updates in the request history.</span></li>
          <li><strong>Check physical receipts</strong><span>Authorized Logistics staff reconcile partial and complete deliveries against inventory.</span></li>
        </ol>
      </Card>
    </div>
    <Card>
      <h2>Supply request tracking</h2>
      {searchForm}{empty}
      {!!data.requests.length && <div className="shelter-table-scroll" tabIndex={0} role="region" aria-label="Scrollable supply requests">
        <table className="shelter-table" aria-label="Supply requests">
          <thead><tr>
            {['Request ID', 'Aid category', 'Quantity', 'Supporting organisation', 'Submitted', 'Status', 'Delivery progress', 'Actions'].map(label =>
              <th scope="col" key={label}>{label}</th>)}
          </tr></thead>
          <tbody>{data.requests.map(row => {
            const offers = data.commitments?.filter(offer => offer.supportRequestId === row.id) ?? [];
            const receipts = data.receipts?.filter(receipt => offers.some(offer => offer.id === receipt.contributionId)) ?? [];
            const state = row.cancelled ? 'Cancelled' : row.receivedQuantity >= row.quantity ? 'Delivered' :
              row.receivedQuantity ? 'Partially received' : offers.some(offer => offer.status === 'Fulfilled') ? 'Awaiting physical receipt' :
              offers.some(offer => ['Accepted', 'InProgress'].includes(offer.status)) ? 'In progress' :
              offers.some(offer => offer.status === 'Offered') ? 'Offer awaiting review' : 'Awaiting response';
            const quantity = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
            return <tr key={row.id}>
              <th scope="row">{row.reference}</th><td>{t('category.' + row.category)}</td><td>{quantity.format(row.quantity)} {unitSymbol(row.unit)}</td>
              <td>{orgName(row.targetOrganisationId)}</td><td>{row.createdAt ? formatDate(row.createdAt) : '—'}</td>
              <td><span className="shelter-state" data-state={state === 'Delivered' ? 'open' : state === 'Cancelled' ? 'closed' : 'review'}>{state}</span></td>
              <td><progress max={row.quantity} value={row.receivedQuantity} aria-label={`Receipt progress for ${row.reference}`} />
                <small>{quantity.format(row.receivedQuantity)} received · {quantity.format(Math.max(0, row.quantity - row.receivedQuantity))} remaining</small></td>
              <td><details className="shelter-supply-details"><summary>Details</summary>
                <p>{row.reason}</p>
                {offers.map(offer => <p key={offer.id}>{offer.title} · {offer.status === 'InProgress' ? 'In progress' : offer.status}</p>)}
                {receipts.map(receipt => <p key={receipt.id}>{receipt.reference} · {quantity.format(receipt.quantity)} {unitSymbol(offers.find(o => o.id === receipt.contributionId)?.unit ?? row.unit)}
                  {' · '}{formatDate(receipt.createdAt)}{receipt.discrepancy && <small>{receipt.discrepancy}</small>}</p>)}
                {requestActions(row)}
              </details></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </Card>
  </div>;
  return <div className="stack">
    <PageHeader title="Supply support" description="Request essential supplies from a verified organisation and reconcile physical receipts." />
    {feedback}{requestForm}{searchForm}{empty}
    {data.requests.map(row => <Card key={row.id}>
      <h2>{row.category} · {orgName(row.requestingOrganisationId)}</h2>
      <p>{row.reference}</p>
      {row.resourceName && <p>{row.resourceName} · Delivery to {row.destination}</p>}
      <p>Requested from {orgName(row.targetOrganisationId)} · <Badge value={row.cancelled ? 'Cancelled' : row.receivedQuantity === row.quantity ? 'Fulfilled' : 'Open'} /></p>
      <p>{row.receivedQuantity} of {row.quantity} {row.unit} received</p><p>{row.reason}</p>
      {requestActions(row)}
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
  if (!query.data.remaining) return <p role="status">{write.isSuccess ? 'Inventory receipt recorded. ' : ''}There is no remaining quantity to receive.</p>;
  if (!query.data.resources.length) return <p>No compatible inventory item is available in your scope.</p>;
  return <form className="form-grid" onChange={() => changeId(crypto.randomUUID())} onSubmit={e => {
    const data = values(e);
    write.mutate({ operationId, resourceId: data.get('resource'), reference: data.get('reference'), discrepancy: data.get('discrepancy'), quantity: Number(data.get('quantity')) });
  }}>
    <Field label="Receiving inventory"><select name="resource" disabled={write.isPending}>
      {query.data.resources.map(r => <option key={r.id} value={r.id}>{r.name} ({r.unit})</option>)}</select></Field>
    <Field label="Actual quantity received" hint={`${query.data.remaining} ${unitSymbol(query.data.unit)} remaining on this commitment.`}>
      <input name="quantity" type="number" disabled={write.isPending} min={isMeasuredUnit(query.data.unit) ? 0.01 : 1} max={query.data.remaining}
        step={isMeasuredUnit(query.data.unit) ? 0.01 : 1} required />
    </Field>
    <Field label="Physical receipt reference"><input name="reference" disabled={write.isPending} maxLength={100} required /></Field>
    <Field label="Delivery discrepancy (optional)"><textarea name="discrepancy" disabled={write.isPending} maxLength={500} /></Field>
    <Button busy={write.isPending}>Confirm stock receipt</Button>
    {write.isSuccess && <p role="status">Inventory receipt recorded.</p>}
    {write.error && <p role="alert">{errorMessage(write.error)}</p>}
  </form>;
}
