import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { get } from './api';
import { Badge, Button, Card, Empty, ErrorState, Field, formatDate, Loading, PageHeader, categories } from './components';
import { ContributionReceipt } from './SupplySupport';
import { countryPath, useCrisisOperationsWrite } from './crisisOperationsApi';
import { useCountry } from './geography';

interface Contribution {
  id: string;
  organisationId: string;
  title: string;
  kind: string;
  description: string;
  unit: string;
  quantity: number;
  fulfilledQuantity: number;
  status: string;
  category?: string;
  supportRequestId?: string;
}
interface Workspace {
  organisations: { id: string; name: string; countryCode: string; verificationState: string; canOffer: boolean }[];
  memberships: { organisationId: string; countryCode: string; crisisId: string | null }[];
  work: { organisationId: string; reference: string; crisis: string; category: string; status: string; quantity: number; deliveredQuantity: number;
    workTitle: string | null; workInstructions: string | null }[];
  contributions: Contribution[];
  history: { entityId: string; action: string; detail: string; createdAt: string }[];
  contact: { displayName: string; email: string };
}
const active = (c: Contribution) => ['Accepted', 'InProgress'].includes(c.status);

export default function PartnerWorkspace() {
  const country = useCountry();
  const { section: view = 'overview' } = useParams();
  const query = useQuery({
    queryKey: ['partner', country], queryFn: () => get<Workspace>(countryPath('/partner', country)),
  });
  const [draft, setDraft] = useState<Contribution | 'new'>();
  const [operationId, setOperationId] = useState<string>();
  const write = useCrisisOperationsWrite(country);
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const { organisations, memberships, contributions, work, history, contact } = query.data;
  const local = organisations.filter((org) => org.countryCode === country);
  const offering = local.filter((org) => org.canOffer);
  const orgName = (id: string) => local.find((org) => org.id === id)?.name ?? 'Organisation';
  const editing = draft === 'new' ? undefined : draft;
  const names = { work: 'Assigned work', contributions: 'Contributions & commitments', profile: 'Organisation profile' };
  return <div className="stack">
    <PageHeader title={names[view as keyof typeof names] ?? 'Partner overview'} description={local.map((org) => org.name).join(' · ') || country} />
    {write.error && <ErrorState error={write.error} />}
    {!local.length && <Empty title="No organisation membership in this country" description="Choose a country where you hold a partner membership." />}
    {view === 'overview' && <>
      <div className="resource-grid">
        <Card><h2><Link to="/partner/work">Assigned work</Link></h2><p>{work.length} shared cases</p></Card>
        <Card><h2><Link to="/partner/contributions">Active commitments</Link></h2><p>{contributions.filter(active).length} accepted or in progress</p></Card>
        <Card><h2><Link to="/partner/contributions">Pending actions</Link></h2>
          <p>{contributions.filter((c) => c.status === 'Offered').length} offers awaiting a decision</p>
          <p>{contributions.filter(active).length} commitments awaiting fulfilment</p></Card>
      </div>
      <Card><h2>Organisations</h2><ul>{local.map((org) => <li key={org.id}>{org.name} · <Badge value={org.verificationState} /></li>)}</ul>
        <p>Authorized countries · {[...new Set(organisations.map((org) => org.countryCode))].join(', ') || 'None'}</p>
      </Card>
      <Card><h2>Recent activity</h2>{history.length ? <ul>{history.slice(0, 5).map((event, index) =>
        <li key={index}>{contributions.find((c) => c.id === event.entityId)?.title} · {event.action.replace('Contribution', '')} · {formatDate(event.createdAt)}</li>)}</ul>
        : <p className="muted">There is no contribution activity yet.</p>}</Card>
    </>}
    {view === 'work' && (work.length ? <div className="resource-grid">{work.map((row) => (
      <Card key={`${row.organisationId}-${row.reference}`}>
        <h2>{row.workTitle || row.reference}</h2><p>{row.workTitle && `${row.reference} · `}{orgName(row.organisationId)} · {row.crisis}</p><Badge value={row.status} />
        <p>{row.category} · {row.deliveredQuantity} of {row.quantity} fulfilled</p>
        <p>{['Fulfilled', 'Closed', 'Rejected', 'Cancelled'].includes(row.status) ? 'Case work has ended.' : row.workInstructions || 'Coordinate fulfilment with the assigned response team.'}</p>
      </Card>))}</div> : <Empty title="No work has been shared with your organisation" />)}
    {view === 'profile' && <div className="resource-grid">
      {organisations.map((org) => <Card key={`${org.id}-${org.countryCode}`}>
        <h2>{org.name}</h2><p>{org.countryCode} · <Badge value={org.verificationState} /></p>
        <p>{org.canOffer ? 'Country-wide contribution access' : 'Contribution offers require a verified, country-wide membership.'}</p>
        <p>Membership · {memberships.some((m) => m.organisationId === org.id && m.countryCode === org.countryCode && !m.crisisId) ? 'Country-wide' : 'Assigned crises only'}</p>
        <p>Signed-in representative · {contact.displayName} · {contact.email}</p>
      </Card>)}
    </div>}
    {view === 'contributions' && <>
      {!!offering.length && <div><Button onClick={() => { setOperationId(crypto.randomUUID()); setDraft('new'); write.reset(); }}>Record an offer</Button></div>}
      {draft && <Card><h2>{editing ? 'Edit offer' : 'New offer'}</h2>
        <form key={editing?.id ?? 'new'} className="form-grid" onSubmit={(event) => {
          event.preventDefault();
          const data = Object.fromEntries(new FormData(event.currentTarget));
          write.mutate({ path: editing ? `/partner/contributions/${editing.id}` : '/partner/contributions',
            method: editing ? 'put' : 'post', data: { ...data, operationId: editing ? undefined : operationId,
              organisationId: editing?.organisationId ?? data.organisationId, quantity: Number(data.quantity),
              category: data.category || null, supportRequestId: editing?.supportRequestId } },
            { onSuccess: () => setDraft(undefined) });
        }}>
          {!editing && <Field label="Organisation"><select name="organisationId" required>{offering.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></Field>}
          <Field label="Offer title"><input name="title" required maxLength={160} defaultValue={editing?.title} /></Field>
          <Field label="Contribution type"><select name="kind" defaultValue={editing?.kind}><option>Resource</option><option>Service</option></select></Field>
          <Field label="Category for inventory receipts"><select name="category" defaultValue={editing?.category ?? ''}>
            <option value="">No category selected</option>{categories.map(c => <option key={c}>{c}</option>)}
          </select></Field>
          <Field label="Unit"><input name="unit" required maxLength={40} defaultValue={editing?.unit} /></Field>
          <Field label="Offered quantity"><input name="quantity" type="number" min={0.01} step={0.01} max={10000000} required defaultValue={editing?.quantity} /></Field>
          <Field label="Offer description"><textarea name="description" required maxLength={2000} defaultValue={editing?.description} /></Field>
          <div className="button-row"><Button busy={write.isPending}>Save offer</Button><Button type="button" variant="secondary" onClick={() => setDraft(undefined)}>Cancel</Button></div>
        </form>
      </Card>}
      {!contributions.length && <Empty title="No contribution offers" />}
      <div className="resource-grid">{contributions.map((c) => (
        <Card key={c.id}><h2>{c.title}</h2>
          <p>{orgName(c.organisationId)} · {c.kind} · <Badge value={c.status} /></p>
          <p>{c.description}</p>
          <p>{c.fulfilledQuantity} of {c.quantity} {c.unit} recorded as fulfilled</p>
          {c.status === 'Offered' && <Button variant="secondary" onClick={() => { setDraft(c); write.reset(); }}>Edit offer</Button>}
          {['Offered', 'Accepted', 'InProgress'].includes(c.status) && <ContributionForm contribution={c} country={country} />}
          <details><summary>Contribution history</summary><ul>{history.filter((event) => event.entityId === c.id).map((event, index) =>
            <li key={index}>{event.action.replace('Contribution', '')} · {formatDate(event.createdAt)}{event.detail && <p>{event.detail}</p>}</li>)}</ul></details>
        </Card>))}
      </div>
    </>}
  </div>;
}

function ContributionForm({ contribution, country, admin = false }: { contribution: Contribution; country: string; admin?: boolean }) {
  const write = useCrisisOperationsWrite(country);
  const c = contribution;
  return <form className="stack" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const action = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
    if (action) write.mutate({ path: `/partner/contributions/${c.id}/${action}`,
      data: { note: form.get('note'), quantity: active(c) ? Number(form.get('quantity')) : null } });
  }}>
    {active(c) && <Field label="Total fulfilment to date"><input name="quantity" type="number"
      min={c.fulfilledQuantity + 0.01} max={c.quantity} step={0.01} required /></Field>}
    <Field label={admin ? 'Decision notes' : 'Update notes'}><textarea name="note" required maxLength={1000} /></Field>
    {write.error && <ErrorState error={write.error} />}
    <div className="button-row">
      {admin ? <><Button value="accept" busy={write.isPending}>Accept offer</Button>
        <Button value="decline" variant="secondary" busy={write.isPending}>Decline offer</Button></>
        : <Button value={active(c) ? 'progress' : 'withdraw'} busy={write.isPending}>{active(c) ? 'Record progress' : 'Withdraw offer'}</Button>}
    </div>
  </form>;
}

export function PartnerCommitments() {
  const country = useCountry();
  const query = useQuery({ queryKey: ['partner-commitments', country],
    queryFn: () => get<{ contribution: Contribution; organisation: string }[]>(countryPath('/partner/commitments', country)) });
  return <div className="stack">
    <PageHeader title="Partner commitments" description="Review resource and service offers in the selected country." />
    {query.isPending ? <Loading /> : query.error ? <ErrorState error={query.error} /> : !query.data.length ? <Empty title="No offers or commitments" /> :
      <div className="resource-grid">{query.data.map(({ contribution: c, organisation }) => <Card key={c.id}>
        <h2>{c.title}</h2><p>{organisation} · {c.kind} · <Badge value={c.status} /></p><p>{c.description}</p>
        <p>{c.fulfilledQuantity} of {c.quantity} {c.unit} recorded as fulfilled</p>
        {c.status === 'Offered' && <ContributionForm contribution={c} country={country} admin />}
        {c.category && c.kind === 'Resource' && ['Accepted', 'InProgress', 'Fulfilled'].includes(c.status) &&
          <details><summary>Record inventory receipt</summary><ContributionReceipt id={c.id} country={country} /></details>}
      </Card>)}</div>}
  </div>;
}
