import { useState, type ComponentProps, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, useParams } from 'react-router-dom';
import { api, errorMessage, get } from './api';
import { Badge, Button, Card, Empty, ErrorState, Field, Loading, PageHeader, categories, formatDate } from './components';
import { useCountry } from './geography';
import type { Category } from './types';
import { InvestigationList, type Investigation } from './DecisionSupport';

interface Campaign { id: string; name: string; purpose: string; currency: string; budget: number; open: boolean }
interface Donation {
  id: string; campaignId: string; kind: 'Monetary' | 'Material'; category: Category; unit: string;
  amount: number; state: string; donor?: string; receiptReference?: string; resourceId?: string;
}
interface Allocation { id: string; donationId: string; requestId?: string; amount: number }
interface Workspace {
  profile?: { displayName: string; organisationName?: string };
  campaigns: Campaign[];
  donations: Donation[];
  allocations: Allocation[];
  expenses: { id: string; allocationId: string; amount: number; reference?: string }[];
  events: { id: string; donationId: string; activity: string; state: string; createdAt: string }[];
  reports: { campaignId: string; pledged: number; received: number; allocated: number; expended: number; budget: number }[];
  materialReports: { campaignId: string; category: string; unit: string; received: number; allocated: number; distributed: number }[];
  flags: Investigation[];
}
interface Options {
  campaignScopes: { id: string; organisationId: string; name: string; crisisId?: string }[];
  cases: { id: string; reference: string; category: Category }[];
  resources: { id: string; name: string; category: Category; unit: string }[];
  deliveries: { id: string; requestId: string; resourceId: string; reference: string; quantity: number }[];
}
type Write = { path: string; method?: 'put'; data?: unknown };
const tabs = [
  ['overview', 'Overview'], ['campaigns', 'Donation campaigns'], ['donations', 'Donations and pledges'],
  ['allocations', 'Fund allocations'], ['expenses', 'Expenditures'], ['reports', 'Transparency reports'],
  ['notifications', 'Notifications'], ['profile', 'Profile'], ['investigations', 'Investigations'],
] as const;
const form = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); return new FormData(event.currentTarget); };
const amountText = (amount: number, unit: string) => `${amount.toLocaleString()} ${unit}`;

export default function FundingWorkspace({ manage = false, admin = false }: { manage?: boolean; admin?: boolean }) {
  const base = admin ? '/admin/funding' : manage ? '/funding/manage' : '/funding';
  const { section = 'overview' } = useParams();
  const country = useCountry();
  const url = '/funding/' + country;
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['funding', country, manage, section], queryFn: () => get<Workspace>(url + '/workspace?manage=' + manage) });
  const [message, setMessage] = useState('');
  const write = useMutation({
    mutationFn: ({ path, data, method }: Write) => api[method ?? 'post'](path, data),
    onMutate: () => setMessage(''),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['funding'] });
      setMessage('Saved.');
    },
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const data = query.data;
  const campaigns = new Map(data.campaigns.map(c => [c.id, c]));
  const donations = new Map(data.donations.map(d => [d.id, d]));
  const submit = (input: Write) => write.mutate(input);
  const availableTabs = tabs.filter(([key]) => manage || key !== 'investigations');
  return <div className="stack">
    <PageHeader title={manage ? 'Funding management' : 'Donor workspace'} description="Campaigns, verified donations and funding activity." />
    <nav className="actions" style={{ flexWrap: 'wrap' }} aria-label="Funding sections">
      {availableTabs.map(([key, label]) => <NavLink end className={({ isActive }) => 'button ' + (isActive ? 'primary' : 'secondary')}
        key={key} to={key === 'overview' ? base : manage && key === 'profile' ? '/app/profile' : base + '/' + key}>{label}</NavLink>)}
    </nav>
    {message && <p role="status">{message}</p>}
    {write.error && <p role="alert">{errorMessage(write.error)}</p>}
    {section === 'overview' && <Card>
      <h2>Funding activity</h2>
      <p>{data.campaigns.filter(c => c.open).length} open campaigns · {data.donations.length} recorded donations</p>
      {!manage && !data.profile && <Link to={base + '/profile'}>Register a donor profile</Link>}
      <p>Staff verify external receipts before any pledge is counted as received.</p>
    </Card>}
    {section === 'profile' && !manage && <Card><h2>Donor profile</h2>
      <form key={data.profile?.displayName ?? 'new'} className="stack" onSubmit={e => {
        const values = form(e);
        submit({ path: '/funding/profile', method: 'put', data: {
          displayName: values.get('name'), organisationName: values.get('organisation'),
        } });
      }}>
        <Field label="Donor name"><input name="name" required maxLength={100} defaultValue={data.profile?.displayName} /></Field>
        <Field label="Donor organisation (optional)"><input name="organisation" maxLength={150} defaultValue={data.profile?.organisationName ?? ''} /></Field>
        <Button busy={write.isPending}>{data.profile ? 'Save profile' : 'Register as donor'}</Button>
      </form>
    </Card>}
    {section === 'campaigns' && <>
      {manage && <CampaignForm url={url} submit={submit} busy={write.isPending} />}
      {!data.campaigns.length && <Empty title="No campaigns in this country" />}
      {data.campaigns.map(c => <Card key={c.id}><h2>{c.name}</h2><p>{c.purpose}</p>
        <p>Budget {amountText(c.budget, c.currency)} · {c.open ? 'Open' : 'Closed'}</p>
        {manage && <Button type="button" busy={write.isPending} onClick={() => submit({
          path: url + '/campaigns/' + c.id + '/state', method: 'put', data: { open: !c.open },
        })}>{c.open ? 'Close campaign' : 'Reopen campaign'}</Button>}
      </Card>)}
    </>}
    {section === 'donations' && <>
      {!manage && (data.profile
        ? <PledgeForm url={url} campaigns={data.campaigns.filter(c => c.open)} submit={submit} busy={write.isPending} />
        : <Card><Link to={base + '/profile'}>Register a donor profile to pledge</Link></Card>)}
      {!data.donations.length && <Empty title="No donation records" />}
      {data.donations.map(d => <Card key={d.id}><h2>{campaigns.get(d.campaignId)?.name}</h2>
        <p>{d.kind} · {d.category} · {amountText(d.amount, d.unit)} <Badge value={d.state} /></p>
        {d.donor && <p>Donor {d.donor}</p>}{d.receiptReference && <p>Receipt {d.receiptReference}</p>}
        {d.state === 'Pledged' && (manage
          ? <DonationAction key={d.id} action="confirm" donation={d} url={url} submit={submit} busy={write.isPending} />
          : <Button type="button" busy={write.isPending} onClick={() => submit({ path: url + '/donations/' + d.id + '/cancel' })}>Cancel pledge</Button>)}
      </Card>)}
    </>}
    {section === 'allocations' && manage && <AllocationPanel data={data} url={url} campaigns={campaigns} busy={write.isPending} submit={submit} />}
    {section === 'expenses' && manage && <ExpenditurePanel data={data} url={url} campaigns={campaigns} busy={write.isPending} submit={submit} />}
    {section === 'allocations' && !manage && (data.allocations.length ? data.allocations.map(a => {
      const donation = donations.get(a.donationId);
      return <Card key={a.id}><h2>{campaigns.get(donation?.campaignId ?? '')?.name}</h2>
        <p>{amountText(a.amount, donation?.unit ?? '')} allocated to verified aid needs.</p></Card>;
    }) : <Empty title="Your donations have no allocations yet" />)}
    {section === 'expenses' && !manage && (data.expenses.length ? data.expenses.map(e => {
      const donation = donations.get(data.allocations.find(a => a.id === e.allocationId)?.donationId ?? '');
      return <Card key={e.id}><h2>{campaigns.get(donation?.campaignId ?? '')?.name}</h2>
        <p>{amountText(e.amount, donation?.unit ?? '')} recorded as {donation?.kind === 'Material' ? 'distributed' : 'expended'}.</p></Card>;
    }) : <Empty title="Your donations have no recorded expenditures or distributions yet" />)}
    {section === 'reports' && <>
      <p>Financial figures are grouped by campaign currency. Material quantities have separate ledger entries.</p>
      {!data.reports.length && <Empty title="No campaign totals" />}
      {data.reports.map(r => {
        const campaign = campaigns.get(r.campaignId);
        if (!campaign) return null;
        return <Card key={r.campaignId}><h2>{campaign.name}</h2>
          <dl>{[
            ['Budget', r.budget], ...(manage ? [['Pledged', r.pledged] as const] : []), ['Received', r.received],
            ['Allocated', r.allocated], ['Expended', r.expended], ['Unallocated', r.received - r.allocated],
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{amountText(Number(value), campaign.currency)}</dd></div>)}</dl>
        </Card>;
      })}
      {data.materialReports.map(r => <Card key={r.campaignId + '/' + r.category + '/' + r.unit}>
        <h2>{campaigns.get(r.campaignId)?.name} · {r.category}</h2>
        <p>{amountText(r.received, r.unit)} received · {amountText(r.allocated, r.unit)} allocated · {amountText(r.distributed, r.unit)} distributed</p>
      </Card>)}
    </>}
    {section === 'notifications' && <>
      {!data.events.length && <Empty title="No funding updates" />}
      {data.events.map(e => <Card key={e.id}><strong>{e.activity}</strong>
        <p>{campaigns.get(donations.get(e.donationId)?.campaignId ?? '')?.name} · {formatDate(e.createdAt)}</p>
      </Card>)}
    </>}
    {section === 'investigations' && manage && <>
      <Card><h2>Campaign ledger checks</h2>
        <form className="form-grid" onSubmit={event => {
          const data = form(event);
          submit({ path: url + '/campaigns/' + data.get('campaign') + '/scan' });
        }}>
          <Field label="Campaign"><select name="campaign" required>{data.campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Button busy={write.isPending} disabled={!data.campaigns.length}>Scan campaign ledger</Button>
        </form>
      </Card>
      <InvestigationList flags={data.flags} busy={write.isPending}
        reference={flag => <p>{campaigns.get(donations.get(flag.donationId ?? '')?.campaignId ?? '')?.name}</p>}
        review={(id, data) => submit({ path: url + '/investigations/' + id + '/review', data })} />
    </>}
  </div>;
}

type ActionProps = { url: string; busy: boolean; submit: (input: Write) => void };
function useOptions(url: string, campaignId?: string, enabled = true) {
  return useQuery({
    queryKey: ['funding', 'options', url, campaignId],
    queryFn: () => get<Options>(url + '/options' + (campaignId ? '?campaignId=' + campaignId : '')),
    enabled,
  });
}
function CampaignForm({ url, busy, submit }: ActionProps) {
  const options = useOptions(url);
  if (options.isPending) return <Loading />;
  if (options.isError) return <ErrorState error={options.error} />;
  if (!options.data.campaignScopes.length) return <Empty title="No eligible campaign organisations" />;
  return <Card><h2>Create campaign</h2>
    <form className="form-grid" onSubmit={e => {
      const values = form(e);
      const scope = options.data.campaignScopes[Number(values.get('scope'))];
      submit({ path: url + '/campaigns', data: {
        organisationId: scope.organisationId, crisisId: scope.crisisId, name: values.get('name'),
        purpose: values.get('purpose'), budget: Number(values.get('budget')),
      } });
    }}>
      <Field label="Campaign scope"><select name="scope">{options.data.campaignScopes.map((scope, index) =>
        <option key={scope.organisationId + scope.id} value={index}>{scope.name}</option>)}</select></Field>
      <Field label="Campaign name"><input name="name" maxLength={150} required /></Field>
      <Field label="Purpose"><textarea name="purpose" maxLength={1000} required /></Field>
      <Field label="Budget in local currency"><NumberInput name="budget" /></Field>
      <Button busy={busy}>Create campaign</Button>
    </form>
  </Card>;
}
function NumberInput({ max = 10000000, ...props }: ComponentProps<'input'>) {
  return <input type="number" step="0.01" min="0.01" max={max} required {...props} />;
}
function PledgeForm({ url, busy, submit, campaigns }: ActionProps & { campaigns: Campaign[] }) {
  const [kind, setKind] = useState('Monetary');
  const [operationId, setOperation] = useState(() => crypto.randomUUID());
  if (!campaigns.length) return null;
  return <Card><h2>Record a pledge</h2>
    <form className="form-grid" onChange={() => setOperation(crypto.randomUUID())} onSubmit={e => {
      const values = form(e);
      submit({ path: url + '/donations', data: { operationId, campaignId: values.get('campaign'), kind,
        category: values.get('category'), amount: Number(values.get('amount')), unit: values.get('unit') } });
    }}>
      <Field label="Campaign"><select name="campaign">{campaigns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}</select></Field>
      <Field label="Donation type"><select value={kind} onChange={e => setKind(e.target.value)}><option>Monetary</option><option>Material</option></select></Field>
      <Field label="Aid category"><select name="category">{categories.map(c => <option key={c}>{c}</option>)}</select></Field>
      <Field label="Amount"><NumberInput name="amount" /></Field>
      {kind === 'Material' && <Field label="Inventory unit"><input name="unit" required maxLength={30} placeholder="e.g. packs" /></Field>}
      <Button busy={busy}>Record pledge</Button>
    </form>
  </Card>;
}
function DonationAction({ url, busy, submit, action, donation, allocation }: ActionProps & {
  action: 'confirm' | 'allocate' | 'expend'; donation: Donation; allocation?: Allocation;
}) {
  const [operationId, setOperation] = useState(() => crypto.randomUUID());
  const options = useOptions(url, donation.campaignId, action === 'allocate' || donation.kind === 'Material');
  const material = donation.kind === 'Material';
  const needsOptions = action === 'allocate' || material;
  if (needsOptions && options.isPending) return <Loading />;
  if (needsOptions && options.isError) return <ErrorState error={options.error} />;
  const resources = options.data?.resources.filter(r => r.category === donation.category && r.unit.trim().toLowerCase() === donation.unit) ?? [];
  const cases = options.data?.cases.filter(c => !material || c.category === donation.category) ?? [];
  const deliveries = options.data?.deliveries.filter(d => d.requestId === allocation?.requestId && d.resourceId === donation.resourceId) ?? [];
  const donationPath = url + '/donations/' + donation.id;
  if (action === 'confirm' && material && !resources.length) return <p>Material confirmation requires logistics access and a matching inventory item.</p>;
  if (action === 'allocate' && !cases.length) return <p>No eligible cases in this campaign scope.</p>;
  if (action === 'expend' && material && !deliveries.length) return <p>No eligible confirmed case delivery yet.</p>;
  return <form className="form-grid" onChange={() => setOperation(crypto.randomUUID())} onSubmit={e => {
    const values = form(e);
    const amount = Number(values.get('amount'));
    if (action === 'confirm') submit({ path: donationPath + '/confirm', data: { reference: values.get('reference'), resourceId: values.get('resource') } });
    if (action === 'allocate') submit({ path: donationPath + '/allocations', data: { operationId, requestId: values.get('request'), amount } });
    if (action === 'expend') submit({ path: url + '/allocations/' + allocation?.id + '/expenses',
      data: { operationId, amount, reference: values.get('reference'), deliveryConfirmationId: values.get('delivery') } });
  }}>
    {action !== 'allocate' && <Field label={action === 'confirm' ? 'Verified receipt reference' : 'Expense or fulfilment reference'}>
      <input name="reference" required maxLength={100} /></Field>}
    {action !== 'confirm' && <Field label="Amount"><NumberInput name="amount" max={allocation?.amount ?? donation.amount} /></Field>}
    {action === 'confirm' && material && <Field label="Inventory item"><select name="resource">{resources.map(r =>
      <option key={r.id} value={r.id}>{r.name} ({r.unit})</option>)}</select></Field>}
    {action === 'allocate' && <Field label="Approved case"><select name="request">{cases.map(r =>
      <option key={r.id} value={r.id}>{r.reference} · {r.category}</option>)}</select></Field>}
    {action === 'expend' && material && <Field label="Confirmed delivery"><select name="delivery">{deliveries.map(d =>
      <option key={d.id} value={d.id}>{d.reference} · {d.quantity}</option>)}</select></Field>}
    <Button busy={busy}>{action === 'confirm' ? 'Verify receipt' : action === 'allocate' ? 'Record allocation' : 'Record expenditure'}</Button>
  </form>;
}
function AllocationPanel({ data, url, campaigns, busy, submit }: ActionProps & { data: Workspace; campaigns: Map<string, Campaign> }) {
  const [selected, setSelected] = useState('');
  const eligible = data.donations.filter(d => d.state === 'Confirmed' || d.state === 'Allocated');
  const donation = eligible.find(d => d.id === selected) ?? eligible[0];
  if (!donation) return <Empty title="No confirmed donations available" />;
  const allocated = data.allocations.filter(a => a.donationId === donation.id).reduce((sum, a) => sum + a.amount, 0);
  return <Card><h2>Allocate confirmed donations</h2>
    <Field label="Donation"><select value={donation.id} onChange={e => setSelected(e.target.value)}>{eligible.map(d =>
      <option key={d.id} value={d.id}>{campaigns.get(d.campaignId)?.name} · {d.donor} · {amountText(d.amount, d.unit)}</option>)}</select></Field>
    <p>Unallocated {amountText(donation.amount - allocated, donation.unit)}</p>
    {allocated < donation.amount && <DonationAction key={donation.id} action="allocate" donation={donation} url={url} busy={busy} submit={submit} />}
  </Card>;
}
function ExpenditurePanel({ data, url, campaigns, busy, submit }: ActionProps & { data: Workspace; campaigns: Map<string, Campaign> }) {
  const [selected, setSelected] = useState('');
  const allocation = data.allocations.find(a => a.id === selected) ?? data.allocations[0];
  const donation = data.donations.find(d => d.id === allocation?.donationId);
  if (!donation || !allocation) return <Empty title="No allocations to reconcile" />;
  const expenses = data.expenses.filter(e => e.allocationId === allocation.id);
  return <Card><h2>Record expenditure or confirmed fulfilment</h2>
    <Field label="Allocation"><select value={allocation.id} onChange={e => setSelected(e.target.value)}>
      {data.allocations.map(a => {
        const d = data.donations.find(entry => entry.id === a.donationId);
        return <option key={a.id} value={a.id}>{campaigns.get(d?.campaignId ?? '')?.name} · {d?.donor} · {amountText(a.amount, d?.unit ?? '')}</option>;
      })}</select></Field>
    {expenses.map(e => <p key={e.id}>{e.reference} · {amountText(e.amount, donation.unit)}</p>)}
    {expenses.reduce((sum, e) => sum + e.amount, 0) < allocation.amount &&
      <DonationAction key={allocation.id} action="expend" donation={donation} allocation={allocation} url={url} busy={busy} submit={submit} />}
  </Card>;
}
