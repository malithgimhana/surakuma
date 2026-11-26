import { useState, type ComponentProps, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, NavLink, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, Bell, ChartNoAxesCombined, CircleCheck, Coins, FolderOpen, LayoutDashboard, ReceiptText, Search, UserRound, Wallet } from 'lucide-react';
import { AdminMetrics, AdminPanelHeading } from './AdminTabUi';
import { api, errorMessage, get } from './api';
import { useAuth } from './auth';
import { Badge, Button, Card, Empty, ErrorState, Field, Loading, PageHeader, categories, formatDate } from './components';
import { AssignedCountry, CountryFlag, useCountry } from './geography';
import { fundingLabel } from './fundingPresentation';
import type { Category } from './types';
import { fundingWorkspace } from './countryScope';
import { InvestigationList, type Investigation } from './DecisionSupport';
import { WorkspaceDialog } from './OrganisationDialog';
import { compatibleUnits, convertCompatibleQuantity, isMeasuredUnit, unitSymbol } from './quantity';

export interface Campaign {
  id: string; name: string; purpose: string; currency: string; budget: number; open: boolean;
  organisationId?: string; crisisId?: string; createdAt?: string;
}
export interface Donation {
  id: string; campaignId: string; kind: 'Monetary' | 'Material'; category: Category; unit: string;
  amount: number; state: string; donor?: string; receiptReference?: string; resourceId?: string;
}
interface Allocation { id: string; donationId: string; requestId?: string; amount: number }
export interface Workspace {
  profile?: { displayName: string; organisationName?: string };
  campaigns: Campaign[];
  donations: Donation[];
  allocations: Allocation[];
  expenses: { id: string; allocationId: string; amount: number; reference?: string; createdAt?: string }[];
  events: { id: string; donationId: string; activity: string; state: string; createdAt: string }[];
  reports: { campaignId: string; pledged: number; received: number; allocated: number; expended: number; budget: number }[];
  materialReports: { campaignId: string; category: string; unit: string; received: number; allocated: number; distributed: number }[];
  flags: Investigation[];
}
interface Options {
  campaignScopes: { id: string; organisationId: string; name: string; crisisId?: string }[];
  cases: { id: string; reference: string; category: Category; unit?: string | null }[];
  resources: { id: string; name: string; category: Category; unit: string }[];
  deliveries: { id: string; requestId: string; resourceId: string; reference: string; quantity: number; unit: string }[];
}
export type FundingWrite = { path: string; method?: 'put'; data?: unknown };
const tabs = [
  ['overview', 'Overview', LayoutDashboard], ['campaigns', 'Donation campaigns', FolderOpen],
  ['donations', 'Donations and pledges', ReceiptText], ['allocations', 'Fund allocations', Coins],
  ['expenses', 'Expenditures', Wallet], ['reports', 'Transparency reports', ChartNoAxesCombined],
  ['activity', 'Donation activity', Bell], ['profile', 'Profile', UserRound], ['investigations', 'Investigations', Search],
] as const;
const form = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); return new FormData(event.currentTarget); };
export const amountText = (amount: number, unit: string) => `${amount.toLocaleString()} ${unitSymbol(unit)}`;

export default function FundingWorkspace({ manage = true, admin = false }: { manage?: boolean; admin?: boolean }) {
  const base = admin ? '/admin/funding' : fundingWorkspace;
  const { section = 'overview' } = useParams();
  const country = useCountry();
  const url = '/funding/' + country;
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['funding', country, manage], queryFn: () => get<Workspace>(url + '/workspace?manage=' + manage) });
  const [message, setMessage] = useState('');
  const write = useMutation({
    mutationFn: ({ path, data, method }: FundingWrite) => api[method ?? 'post'](path, data),
    onMutate: () => setMessage(''),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['funding'] });
      setMessage('Saved.');
    },
  });
  if (admin && section === 'profile') return <Navigate to={base} replace />;
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const data = query.data;
  const campaigns = new Map(data.campaigns.map(c => [c.id, c]));
  const donations = new Map(data.donations.map(d => [d.id, d]));
  const submit = (input: FundingWrite) => write.mutate(input);
  const adminOverview = admin && section === 'overview';
  const awaitingReceipt = admin ? data.donations.filter(d => d.state === 'Pledged').length : 0;
  const fundingNav = manage && <nav className={admin ? 'admin-tab-switch' : 'actions funding-officer-tabs'} aria-label="Funding sections">
    {tabs.filter(([key]) => !admin || key !== 'profile').map(([key, label, Icon]) => <NavLink end
      className={admin ? undefined : ({ isActive }) => 'button ' + (isActive ? 'primary' : 'secondary')}
      key={key} to={key === 'overview' ? base : base + '/' + key}>
      {admin && <Icon size={17} aria-hidden="true" />}{label}
    </NavLink>)}
  </nav>;
  return <div className={admin ? 'admin-tab admin-tab-stack funding-admin' : 'stack'}>
    <PageHeader title="Funding management" description="Campaigns, verified donations and funding activity." />
    {admin && <AdminMetrics items={[
      { label: 'Open campaigns', value: data.campaigns.filter(c => c.open).length, icon: FolderOpen },
      { label: 'Pledges awaiting verification', value: awaitingReceipt, icon: ReceiptText, tone: awaitingReceipt ? 'yellow' : undefined },
      { label: 'Verified donations', value: data.donations.filter(d => d.receiptReference).length, icon: CircleCheck, tone: 'green' },
      { label: 'Fund allocations', value: data.allocations.length, icon: Coins },
    ]} />}
    {admin ? <Card className="funding-admin-navigation">
      {fundingNav}
      <span className="funding-country"><CountryFlag code={country} /><AssignedCountry code={country} /></span>
    </Card> : fundingNav}
    {message && <p role="status">{message}</p>}
    {write.error && <p role="alert">{errorMessage(write.error)}</p>}
    {adminOverview && <Card className="funding-activity">
      <AdminPanelHeading title="Funding activity" icon={Wallet} />
      <p className="muted">{awaitingReceipt ? 'Verify external receipts before counting pledged donations as received.'
        : data.campaigns.length ? 'No pledges are awaiting receipt verification.' : 'No campaigns have been created for the selected country.'}</p>
      <Link className="button secondary" to={`${base}/${awaitingReceipt ? 'donations' : 'campaigns'}`}>
        {awaitingReceipt ? 'Review donations' : 'View campaigns'} <ArrowRight size={16} aria-hidden="true" />
      </Link>
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
      {!data.donations.length && <Empty title="No donation records" />}
      {data.donations.map(d => <Card key={d.id}><h2>{campaigns.get(d.campaignId)?.name}</h2>
        <p>{d.kind} · {d.category} · {amountText(d.amount, d.unit)} <Badge value={d.state} /></p>
        {d.donor && <p>Donor {d.donor}</p>}{d.receiptReference && <p>Receipt {d.receiptReference}</p>}
        {d.state === 'Pledged' && manage && <DonationAction key={d.id} action="confirm" donation={d} url={url} submit={submit} busy={write.isPending} />}
      </Card>)}
    </>}
    {section === 'allocations' && manage && <AllocationPanel data={data} url={url} campaigns={campaigns} busy={write.isPending} submit={submit} />}
    {section === 'expenses' && manage && <ExpenditurePanel data={data} url={url} campaigns={campaigns} busy={write.isPending} submit={submit} />}
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
    {(section === 'activity' || section === 'notifications') && <>
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

export type FundingActionProps = { url: string; busy: boolean; submit: (input: FundingWrite) => void };
export function useFundingOptions(url: string, campaignId?: string, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['funding', 'options', url, campaignId, user?.id],
    queryFn: () => get<Options>(url + '/options' + (campaignId ? '?campaignId=' + campaignId : '')),
    enabled,
  });
}
export function CampaignForm({ url, busy, submit }: FundingActionProps) {
  const options = useFundingOptions(url);
  if (options.isPending) return <Loading />;
  if (options.isError) return <ErrorState error={options.error} />;
  if (!options.data.campaignScopes.length) return <Empty title="No eligible campaign organisations" />;
  return <Card><h2>Create campaign</h2>
    <form className="form-grid" onSubmit={e => {
      const values = form(e);
      const scope = options.data.campaignScopes[Number(values.get('scope'))];
      submit({ path: url + '/campaigns', data: {
        organisationId: scope.organisationId, crisisId: scope.crisisId, ...campaignDetails(values),
      } });
    }}>
      <Field label="Campaign scope"><select name="scope">{options.data.campaignScopes.map((scope, index) =>
        <option key={scope.organisationId + scope.id} value={index}>{scope.name}</option>)}</select></Field>
      <CampaignFields />
      <Button busy={busy}>Create campaign</Button>
    </form>
  </Card>;
}

export function EditCampaignDialog({ url, busy, submit, campaign, error, onDismiss }: FundingActionProps & {
  campaign: Campaign; error: Error | null; onDismiss: () => void;
}) {
  return <WorkspaceDialog title="Edit campaign" context={campaign.name} busy={busy} onDismiss={onDismiss}>
    <form className="organisation-dialog-fields" onSubmit={event => {
      const values = form(event);
      if (!busy) submit({ path: `${url}/campaigns/${campaign.id}`, method: 'put', data: campaignDetails(values) });
    }}>
      <fieldset className="organisation-dialog-fields" disabled={busy}>
        <CampaignFields campaign={campaign} />
      </fieldset>
      {error && <p className="funding-feedback funding-error" role="alert">{errorMessage(error)}</p>}
      <div className="organisation-dialog-actions">
        <Button type="button" variant="secondary" disabled={busy} onClick={onDismiss}>Cancel</Button>
        <Button type="submit" busy={busy}>Save changes</Button>
      </div>
    </form>
  </WorkspaceDialog>;
}

function CampaignFields({ campaign }: { campaign?: Campaign }) {
  return <>
    <Field label="Campaign name"><input name="name" maxLength={150} defaultValue={campaign?.name} required /></Field>
    <Field label="Purpose"><textarea name="purpose" maxLength={1000} defaultValue={campaign?.purpose} required /></Field>
    <Field label="Budget in local currency"><NumberInput name="budget" defaultValue={campaign?.budget} /></Field>
  </>;
}

function campaignDetails(values: FormData) {
  return { name: values.get('name'), purpose: values.get('purpose'), budget: Number(values.get('budget')) };
}

function NumberInput({ max = 10000000, ...props }: ComponentProps<'input'>) {
  return <input type="number" step="0.01" min="0.01" max={max} required {...props} />;
}
export function PledgeForm({ url, busy, submit, campaigns }: FundingActionProps & { campaigns: Campaign[] }) {
  const [campaignId, setCampaignId] = useState('');
  const [kind, setKind] = useState('Monetary');
  const [category, setCategory] = useState<string>(categories[0]);
  const [unit, setUnit] = useState('');
  const [operationId, setOperation] = useState(() => crypto.randomUUID());
  const [params] = useSearchParams();
  const selectedCampaign = campaigns.find(c => c.id === (campaignId || params.get('campaign'))) ?? campaigns[0];
  if (!selectedCampaign) return <Empty title="No open campaigns in this country" />;
  return <Card><h2>Record a pledge</h2>
    <form className="form-grid" onChange={() => setOperation(crypto.randomUUID())} onSubmit={e => {
      const values = form(e);
      submit({ path: url + '/donations', data: { operationId, campaignId: values.get('campaign'), kind,
        category: values.get('category'), amount: Number(values.get('amount')), unit: values.get('unit') } });
    }}>
      <Field label="Campaign"><select name="campaign" value={selectedCampaign.id} onChange={event => setCampaignId(event.target.value)}>{campaigns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}</select></Field>
      <Field label="Donation type"><select value={kind} onChange={e => setKind(e.target.value)}><option>Monetary</option><option>Material</option></select></Field>
      <Field label="Aid category"><select name="category" value={category} onChange={e => {
        setCategory(e.target.value);
        setUnit('');
      }}>{categories.map(c => <option key={c} value={c}>{fundingLabel(c)}</option>)}</select></Field>
      <div className="pledge-quantity" data-material={kind === 'Material'}>
        {kind === 'Material' && <Field label="Inventory unit"><ResourceUnitSelect name="unit" category={category} value={unit} onChange={e => setUnit(e.target.value)} required /></Field>}
        <Field label="Amount" hint={kind === 'Monetary' ? selectedCampaign.currency : undefined}><NumberInput name="amount" {...(kind === 'Material' && !isMeasuredUnit(unit) ? { step: 1, min: 1 } : {})} /></Field>
      </div>
      <Button busy={busy}>Record pledge</Button>
      <p className="muted pledge-receipt-note">Staff verify receipts before pledges count as received.</p>
    </form>
  </Card>;
}
export function DonationAction({ url, busy, submit, action, donation, allocation, maxAmount, fulfilmentLabel }: FundingActionProps & {
  action: 'confirm' | 'allocate' | 'expend'; donation: Donation; allocation?: Allocation; maxAmount?: number; fulfilmentLabel?: boolean;
}) {
  const [operationId, setOperation] = useState(() => crypto.randomUUID());
  const [selectedDelivery, setSelectedDelivery] = useState('');
  const options = useFundingOptions(url, donation.campaignId, action === 'allocate' || donation.kind === 'Material');
  const material = donation.kind === 'Material';
  const needsOptions = action === 'allocate' || material;
  if (needsOptions && options.isPending) return <Loading />;
  if (needsOptions && options.isError) return <ErrorState error={options.error} />;
  const resources = options.data?.resources.filter(r => r.category === donation.category && compatibleUnits(r.unit, donation.unit)) ?? [];
  const cases = options.data?.cases.filter(c => !material || c.category !== 'Shelter' &&
    c.category === donation.category && compatibleUnits(c.unit, donation.unit)) ?? [];
  const deliveries = (options.data?.deliveries ?? []).filter(d => d.requestId === allocation?.requestId &&
    d.resourceId === donation.resourceId && compatibleUnits(d.unit, donation.unit)).map(delivery => ({
    ...delivery,
    limit: Math.floor(convertCompatibleQuantity(delivery.quantity, delivery.unit, donation.unit) * 100 + 1e-8) / 100,
  })).filter(delivery => delivery.limit >= (isMeasuredUnit(donation.unit) ? 0.01 : 1));
  const delivery = deliveries.find(item => item.id === selectedDelivery) ?? deliveries[0];
  const balance = maxAmount ?? allocation?.amount ?? donation.amount;
  const amountLimit = action === 'expend' && material && delivery ? Math.min(balance, delivery.limit) : balance;
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
    {action !== 'confirm' && <Field label="Amount" hint={`Enter the amount in ${unitSymbol(donation.unit)}.`}>
      <NumberInput name="amount" max={Math.min(amountLimit, 10000000)} {...(material && !isMeasuredUnit(donation.unit) ? { step: 1, min: 1 } : {})} />
    </Field>}
    {action === 'confirm' && material && <Field label="Inventory item"><select name="resource">{resources.map(r =>
      <option key={r.id} value={r.id}>{r.name} ({r.unit})</option>)}</select></Field>}
    {action === 'allocate' && <Field label="Approved case"><select name="request">{cases.map(r =>
      <option key={r.id} value={r.id}>{r.reference} · {r.category} {unitSymbol(r.unit)}</option>)}</select></Field>}
    {action === 'expend' && material && <Field label="Confirmed delivery"><select name="delivery" value={delivery?.id ?? ''} onChange={event => setSelectedDelivery(event.target.value)}>{deliveries.map(d =>
      <option key={d.id} value={d.id}>{d.reference} · {d.quantity} {unitSymbol(d.unit)}</option>)}</select></Field>}
    <Button busy={busy}>{action === 'confirm' ? 'Verify receipt' : action === 'allocate' ? 'Record allocation' : fulfilmentLabel && material ? 'Record fulfilment' : 'Record expenditure'}</Button>
  </form>;
}
function AllocationPanel({ data, url, campaigns, busy, submit }: FundingActionProps & { data: Workspace; campaigns: Map<string, Campaign> }) {
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
function ExpenditurePanel({ data, url, campaigns, busy, submit }: FundingActionProps & { data: Workspace; campaigns: Map<string, Campaign> }) {
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
import { ResourceUnitSelect } from './ResourceUnitSelect';
