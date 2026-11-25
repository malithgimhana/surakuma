import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, CircleCheck, Droplet, Flag, FolderOpen, Layers, MapPin, Plus, ReceiptText, ScanLine, Search, Truck } from 'lucide-react';
import { api, errorMessage, get } from './api';
import { useAuth } from './auth';
import { Button, Empty, ErrorState, Field, Loading, PageHeader, formatDate } from './components';
import { fundingWorkspace } from './countryScope';
import { fundingSections } from './fundingNavigation';
import { InvestigationList } from './DecisionSupport';
import { AssignedCountry, useCountry } from './geography';
import { amountText, CampaignForm, DonationAction, EditCampaignDialog, useFundingOptions } from './FundingWorkspace';
import type { Campaign, Donation, FundingActionProps, FundingWrite, Workspace } from './FundingWorkspace';
import { CampaignStatus, DonationStatus, FundingFacts as Facts, donationStatus, fundingLabel, fundingMoney } from './fundingPresentation';

const reference = (id: string) => id.slice(0, 8).toUpperCase();
const availableBalance = (amount: number, used: number) => Math.max(0, Number((amount - used).toFixed(2)));
function donationPath(section: string, donation: Donation, allocation?: string) {
  const query = new URLSearchParams({ campaign: donation.campaignId, kind: donation.kind === 'Material' ? 'materials' : 'money', donation: donation.id });
  if (allocation) query.set('allocation', allocation);
  return `${fundingWorkspace}/${section}?${query}`;
}

export default function FundingOfficerWorkspace() {
  const { section = 'overview' } = useParams();
  const country = useCountry();
  const { user } = useAuth();
  return <FundingCampaignPage key={`${user?.id}:${country}:${section}`} section={section} country={country} userId={user?.id} />;
}

function FundingCampaignPage({ section, country, userId }: { section: string; country: string; userId?: string }) {
  const [params, setParams] = useSearchParams();
  const [create, setCreate] = useState(false);
  const [editing, setEditing] = useState<Campaign>();
  const url = '/funding/' + country;
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['funding', country, true, userId], queryFn: () => get<Workspace>(url + '/workspace?manage=true') });
  const write = useMutation({
    mutationFn: ({ path, data, method }: FundingWrite) => api[method ?? 'post'](path, data),
    onSuccess: async (_, input) => {
      await client.invalidateQueries({ queryKey: ['funding'] });
      if (input.path === url + '/campaigns') setCreate(false);
      if (input.path === `${url}/campaigns/${editing?.id}`) setEditing(undefined);
    },
  });
  const page = fundingSections.find(([id]) => id === section);
  if (!page) return <Navigate to={fundingWorkspace} replace />;
  const { data } = query;
  const campaign = data?.campaigns.find(item => item.id === params.get('campaign')) ?? data?.campaigns.find(item => item.open) ?? data?.campaigns[0];
  const donations = data?.donations.filter(item => item.campaignId === campaign?.id) ?? [];
  const linkedDonation = donations.find(item => item.id === params.get('donation'));
  const kind = params.get('kind') === 'materials' || (!params.has('kind') && linkedDonation?.kind === 'Material') ? 'Material' : 'Monetary';
  const changeCampaign = (id: string) => {
    write.reset();
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('campaign', id);
      next.delete('donation');
      next.delete('allocation');
      return next;
    });
  };
  const changeKind = (value: Donation['kind']) => {
    write.reset();
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('kind', value === 'Material' ? 'materials' : 'money');
      next.delete('donation');
      next.delete('allocation');
      if (campaign) next.set('campaign', campaign.id);
      return next;
    });
  };
  const actions: FundingActionProps = { url, busy: write.isPending, submit: input => write.mutate(input) };
  return <div className="funding-officer-page">
    <PageHeader title={section === 'overview' ? 'Funding overview' : page[1]} description={page[2]} action={section === 'campaigns' && <Button onClick={() => { write.reset(); setCreate(!create); }}
      variant={create ? 'secondary' : 'primary'}>{!create && <Plus size={18} aria-hidden="true" />}{create ? 'Back to campaigns' : 'Create campaign'}</Button>} />
    {write.isSuccess && <p className="funding-feedback" role="status">{section === 'investigations' && typeof write.data.data === 'number'
      ? `Ledger scan complete. ${write.data.data} new ${write.data.data === 1 ? 'flag' : 'flags'}.` : 'Changes saved.'}</p>}
    {write.error && !editing && <p className="funding-feedback funding-error" role="alert">{errorMessage(write.error)}</p>}
    {!data ? query.isError ? <ErrorState error={query.error} retry={() => void query.refetch()} /> : <Loading /> :
      section === 'overview' ? <Overview data={data} /> : section === 'campaigns' ? (
        create ? <CampaignForm {...actions} /> : <Campaigns {...actions} data={data} campaign={campaign} select={changeCampaign}
          edit={item => { changeCampaign(item.id); setEditing(item); }} />
      ) : !campaign ? <Empty title="No campaigns in your assigned scope" description="Create a campaign to start managing donations." /> :
      <>
        <div className="funding-context">
          <span className="funding-icon" aria-hidden="true"><Droplet size={19} /></span>
          <Field label="Campaign"><select value={campaign.id} onChange={event => changeCampaign(event.target.value)}>
            {data.campaigns.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></Field>
          <CampaignStatus campaign={campaign} />
          <span className="funding-context-country"><MapPin size={16} aria-hidden="true" /><AssignedCountry code={country} /></span>
        </div>
        {['donations', 'allocations', 'expenses', 'reports'].includes(section) && <div className="funding-toggle" role="group" aria-label="Donation type">
          <Button variant={kind === 'Monetary' ? 'primary' : 'secondary'} aria-pressed={kind === 'Monetary'} onClick={() => changeKind('Monetary')}>Money</Button>
          <Button variant={kind === 'Material' ? 'primary' : 'secondary'} aria-pressed={kind === 'Material'} onClick={() => changeKind('Material')}>Materials</Button>
        </div>}
        {section === 'donations' && <Donations key={campaign.id + kind} {...actions} campaign={campaign} donations={donations.filter(item => item.kind === kind)} linked={linkedDonation?.id} kind={kind} />}
        {section === 'allocations' && <AllocationView key={campaign.id + kind} {...actions} data={data} donations={donations.filter(item => item.kind === kind)} selectedDonation={linkedDonation?.id} />}
        {section === 'expenses' && <Spending key={campaign.id + kind} {...actions} data={data} donations={donations.filter(item => item.kind === kind)} kind={kind}
          selectedDonation={linkedDonation?.id} selectedAllocation={params.get('allocation')} />}
        {section === 'reports' && <Reports data={data} campaign={campaign} kind={kind} />}
        {section === 'activity' && <Activity data={data} campaign={campaign} donations={donations} />}
        {section === 'investigations' && <Investigations key={campaign.id} {...actions} data={data} campaign={campaign} donations={donations} />}
      </>}
    {editing && <EditCampaignDialog {...actions} campaign={editing} error={write.error} onDismiss={() => { write.reset(); setEditing(undefined); }} />}
  </div>;
}

function Overview({ data }: { data: Workspace }) {
  const donations = new Map(data.donations.map(item => [item.id, item]));
  const allocated = new Map<string, number>();
  const spent = new Map<string, number>();
  for (const item of data.allocations) allocated.set(item.donationId, (allocated.get(item.donationId) ?? 0) + item.amount);
  for (const item of data.expenses) spent.set(item.allocationId, (spent.get(item.allocationId) ?? 0) + item.amount);
  const pending = data.donations.filter(item => item.state === 'Pledged');
  const ready = data.donations.filter(item => (item.state === 'Confirmed' || item.state === 'Allocated') &&
    availableBalance(item.amount, allocated.get(item.id) ?? 0) > 0);
  const openAllocations = data.allocations.filter(item => availableBalance(item.amount, spent.get(item.id) ?? 0) > 0);
  const flags = data.flags.filter(item => !item.reviewedAt);
  const openCampaigns = data.campaigns.filter(campaign => campaign.open);
  const queueLink = (section: string, item?: Donation, allocation?: string) => item ? donationPath(section, item, allocation) : '';
  const metrics = [
    ['Open campaigns', openCampaigns.length, FolderOpen], ['Awaiting receipts', pending.length, ReceiptText],
    ['Unallocated donations', ready.length, Layers], ['Flags to review', flags.length, Flag],
  ] as const;
  const tasks = [
    ['Review receipts', pending.length, 'Review', queueLink('donations', pending[0]), ReceiptText],
    ['Allocate donations', ready.length, 'Allocate', queueLink('allocations', ready[0]), Layers],
    ['Allocations with a remaining balance', openAllocations.length, 'Review', queueLink('expenses', donations.get(openAllocations[0]?.donationId), openAllocations[0]?.id), Truck],
    ['Review ledger flags', flags.length, 'Review', queueLink('investigations', donations.get(flags[0]?.donationId ?? '')), Flag],
  ] as const;
  return <>
    <div className="funding-queue-metrics">{metrics.map(([label, count, Icon]) => <section className="funding-panel funding-queue-metric" key={label}>
      <span><Icon size={20} aria-hidden="true" />{label}</span><strong data-active={count > 0}>{count}</strong>
    </section>)}</div>
    <div className="funding-overview-grid"><section className="funding-panel funding-queue-list"><h2>Funding work queue</h2>
      {tasks.map(([label, count, action, href, Icon], index) => <div className="funding-queue-row" key={label} data-priority={index === 0 && count > 0}>
        <Icon size={19} aria-hidden="true" /><strong>{label}</strong><small>{count} {count === 1 ? 'item' : 'items'}</small>
        {href && <Link className={`button ${index === 0 ? 'primary' : 'secondary'}`} to={href} aria-label={label}>{action}<ArrowRight size={14} aria-hidden="true" /></Link>}
      </div>)}
    </section><section className="funding-panel funding-overview-campaigns"><h2>Open campaigns</h2>
      {openCampaigns.length ? <ul className="funding-recorded">{openCampaigns.slice(0, 4).map(campaign => <li key={campaign.id}>
        <Link to={`${fundingWorkspace}/campaigns?${new URLSearchParams({ campaign: campaign.id })}`}>{campaign.name}</Link><CampaignStatus campaign={campaign} />
      </li>)}</ul> : <p className="muted">No open campaigns in your assigned scope.</p>}
      <Link className="inline" to={`${fundingWorkspace}/campaigns`}>Manage campaigns <ArrowRight size={16} aria-hidden="true" /></Link>
    </section></div>
  </>;
}

function Campaigns({ data, campaign, select, edit, ...actions }: FundingActionProps & {
  data: Workspace; campaign?: Campaign; select: (id: string) => void; edit: (campaign: Campaign) => void;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(campaign?.open ?? true);
  const options = useFundingOptions(actions.url, undefined, !!campaign);
  const scope = options.data?.campaignScopes.find(item => item.organisationId === campaign?.organisationId &&
    (item.crisisId ?? null) === (campaign?.crisisId ?? null));
  const visible = data.campaigns.filter(item => item.open === open && item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <>
    <div className="funding-campaign-toolbar">
      <div className="funding-toggle" role="group" aria-label="Campaign status">
        <Button variant={open ? 'primary' : 'secondary'} aria-pressed={open} onClick={() => setOpen(true)}>Open</Button>
        <Button variant={!open ? 'primary' : 'secondary'} aria-pressed={!open} onClick={() => setOpen(false)}>Closed</Button>
      </div>
      <Field label="Search campaigns"><input type="search" placeholder="Campaign name" value={search} onChange={event => setSearch(event.target.value)} /></Field>
    </div>
    {visible.length ? <section className="funding-panel funding-table" tabIndex={0} role="region" aria-label="Campaign register"><table>
      <thead><tr><th>Campaign</th><th>Status</th><th>Currency</th><th>Actions</th></tr></thead>
      <tbody>{visible.map(item => <tr key={item.id} data-selected={item.id === campaign?.id}>
        <td><button className="funding-campaign-name" type="button" aria-pressed={item.id === campaign?.id} onClick={() => select(item.id)}>{item.name}</button><small>{item.purpose}</small></td>
        <td><CampaignStatus campaign={item} /></td><td>{item.currency}</td>
        <td><div className="inline funding-campaign-actions">
          <button type="button" aria-label={`Edit campaign ${item.name}`} disabled={actions.busy} onClick={() => edit(item)}>Edit campaign</button>
          <Link to={`${fundingWorkspace}/donations?campaign=${item.id}`} aria-label={`View donations for ${item.name}`}>View donations</Link>
        </div></td>
      </tr>)}</tbody>
    </table></section> : <Empty title={search.trim() ? 'No matching campaigns' : `No ${open ? 'open' : 'closed'} campaigns`} />}
    {campaign && visible.some(item => item.id === campaign.id) && <section className="funding-panel"><div className="funding-section-title"><h2>{campaign.name}</h2><CampaignStatus campaign={campaign} /></div>
      <Facts values={[
        ['Campaign scope', scope?.name ?? (options.isPending ? 'Loading…' : campaign.crisisId ? 'Crisis-specific' : 'Country-wide')],
        ['Budget', fundingMoney(campaign.budget, campaign.currency)],
        ...(campaign.createdAt ? [['Created', formatDate(campaign.createdAt)] as [string, string]] : []),
      ]} />
      <Button variant="secondary" busy={actions.busy} onClick={() => actions.submit({ path: `${actions.url}/campaigns/${campaign.id}/state`, method: 'put', data: { open: !campaign.open } })}>{campaign.open ? 'Close campaign' : 'Reopen campaign'}</Button>
    </section>}
  </>;
}

function Donations({ campaign, donations, kind, linked, ...actions }: FundingActionProps & {
  campaign: Campaign; donations: Donation[]; kind: Donation['kind']; linked?: string;
}) {
  const [selection, setSelection] = useState('');
  const [awaiting, setAwaiting] = useState(!linked);
  const queue = awaiting ? donations.filter(item => item.state === 'Pledged') : donations;
  const active = donations.find(item => item.id === (selection || linked)) ?? queue[0];
  return <div className="funding-split funding-detail-split">
    <div className="funding-column">
      <div className="funding-toggle" role="group" aria-label="Donation status">
        <Button variant={awaiting ? 'primary' : 'secondary'} aria-pressed={awaiting} onClick={() => { setSelection(''); setAwaiting(true); }}>Awaiting receipt</Button>
        <Button variant={!awaiting ? 'primary' : 'secondary'} aria-pressed={!awaiting} onClick={() => { setSelection(''); setAwaiting(false); }}>All donations</Button>
      </div>
      <section className="funding-panel funding-list"><h2>{kind === 'Monetary' ? 'Donations and pledges' : 'Material donations'}</h2>
        {queue.map(item => <button key={item.id} type="button" aria-pressed={active?.id === item.id} onClick={() => setSelection(item.id)}>
          <span><strong>{item.donor || `Donation ${reference(item.id)}`}</strong><small>{amountText(item.amount, item.unit)}</small></span>
          <DonationStatus donation={item} />
        </button>)}
        {queue.length === 0 && <p className="muted">{awaiting ? 'No receipts awaiting verification.' : 'No donations for this campaign.'}</p>}
      </section>
    </div>
    {active && <section className="funding-panel funding-accent-panel"><h2><CircleCheck size={21} aria-hidden="true" />{active.state === 'Pledged' ? 'Verify receipt' : 'Donation details'}</h2>
      <Facts values={[
        ['Donation', reference(active.id)], ['Campaign', campaign.name], ['Amount', amountText(active.amount, active.unit)],
        ...(active.kind === 'Material' ? [['Aid category', fundingLabel(active.category)] as [string, string]] : []),
      ]} />
      {active.state === 'Pledged' ? <DonationAction key={active.id} {...actions} action="confirm" donation={active}
        submit={input => { setSelection(active.id); actions.submit(input); }} /> :
        <><p>{active.receiptReference ? `Receipt ${active.receiptReference}` : donationStatus(active)}</p>
          {active.state === 'Confirmed' && <Link className="button primary" to={donationPath('allocations', active)}>Allocate donation</Link>}
          {active.state === 'Allocated' && <Link className="button secondary" to={donationPath('expenses', active)}>Review spending and delivery</Link>}
        </>}
    </section>}
  </div>;
}

function AllocationView({ data, donations, selectedDonation, ...actions }: FundingActionProps & { data: Workspace; donations: Donation[]; selectedDonation?: string }) {
  const [selection, setSelection] = useState('');
  const eligible = donations.filter(item => item.state !== 'Pledged' && item.state !== 'Cancelled').map(donation => ({
    donation, remaining: availableBalance(donation.amount, data.allocations.filter(item => item.donationId === donation.id).reduce((sum, item) => sum + item.amount, 0)),
  }));
  const selected = eligible.find(item => item.donation.id === (selection || selectedDonation)) ?? eligible.find(item => item.remaining > 0) ?? eligible[0];
  if (!selected) return <Empty title="No confirmed donations" description="Verify a receipt before allocating a donation." />;
  const { donation, remaining } = selected;
  return <div className="funding-split funding-detail-split funding-balance-layout">
    <section className="funding-panel"><h2>Allocate to an approved case</h2>
      <Field label="Confirmed donation"><select value={donation.id} onChange={event => setSelection(event.target.value)}>
        {eligible.map(item => <option key={item.donation.id} value={item.donation.id}>{item.donation.donor ?? reference(item.donation.id)} · {amountText(item.remaining, item.donation.unit)} available</option>)}
      </select></Field>
      {remaining > 0 ? <DonationAction key={`${donation.id}:${remaining}`} {...actions} action="allocate" donation={donation} maxAmount={remaining} /> : <p className="muted">This donation is fully allocated.</p>}
    </section>
    <section className="funding-panel funding-accent-panel"><h2>Allocation summary</h2><Facts values={[
      ['Verified donation', amountText(donation.amount, donation.unit)], ['Already allocated', amountText(donation.amount - remaining, donation.unit)],
      ['Available to allocate', amountText(remaining, donation.unit)],
    ]} /></section>
  </div>;
}

function Spending({ data, donations, kind, selectedDonation, selectedAllocation, ...actions }: FundingActionProps & {
  data: Workspace; donations: Donation[]; kind: Donation['kind']; selectedDonation?: string; selectedAllocation: string | null;
}) {
  const [selection, setSelection] = useState('');
  const entries = data.allocations.flatMap(allocation => {
    const donation = donations.find(item => item.id === allocation.donationId);
    if (!donation) return [];
    const expenses = data.expenses.filter(item => item.allocationId === allocation.id);
    const remaining = availableBalance(allocation.amount, expenses.reduce((sum, item) => sum + item.amount, 0));
    return [{ allocation, donation, expenses, remaining }];
  });
  const selected = entries.find(item => item.allocation.id === (selection || selectedAllocation)) ??
    entries.find(item => item.donation.id === selectedDonation && item.remaining > 0) ??
    entries.find(item => item.donation.id === selectedDonation) ?? entries.find(item => item.remaining > 0) ?? entries[0];
  if (!selected) return <Empty title="No allocations to reconcile" description="Allocate a donation before recording spending or delivery." />;
  const { allocation, donation, expenses, remaining } = selected;
  return <div className="funding-split funding-detail-split funding-balance-layout">
    <section className="funding-panel"><h2>{kind === 'Material' ? 'Record confirmed fulfilment' : 'Record expenditure'}</h2>
      <Field label="Allocation"><select value={allocation.id} onChange={event => setSelection(event.target.value)}>
        {entries.map(item => <option key={item.allocation.id} value={item.allocation.id}>{reference(item.allocation.id)} · {item.donation.donor ?? 'Donation'} · {amountText(item.allocation.amount, item.donation.unit)}</option>)}
      </select></Field>
      {remaining > 0 ? <DonationAction key={`${allocation.id}:${remaining}`} {...actions} donation={donation} allocation={allocation} action="expend" maxAmount={remaining} fulfilmentLabel /> :
        <p className="muted">This allocation is fully recorded.</p>}
    </section>
    <section className="funding-panel funding-accent-panel"><h2>Allocation summary</h2><Facts values={[
      ['Allocated', amountText(allocation.amount, donation.unit)], ['Recorded', amountText(allocation.amount - remaining, donation.unit)],
      ['Remaining', amountText(remaining, donation.unit)],
    ]} />{expenses.length > 0 && <><h3>Recorded entries</h3><ul className="funding-recorded">{expenses.map(item => <li key={item.id}>{item.reference ?? reference(item.id)} <strong>{amountText(item.amount, donation.unit)}</strong></li>)}</ul></>}</section>
  </div>;
}

function Reports({ data, campaign, kind }: { data: Workspace; campaign: Campaign; kind: Donation['kind'] }) {
  const report = data.reports.find(item => item.campaignId === campaign.id);
  const materials = data.materialReports.filter(item => item.campaignId === campaign.id);
  if (kind === 'Monetary' && !report) return <Empty title="No financial report is available for this campaign" />;
  if (kind === 'Material' && !materials.length) return <Empty title="No verified material donations for this campaign" />;
  if (kind === 'Monetary' && report) {
    const maximum = Math.max(report.received, report.allocated, report.expended, 1);
    return <section className="funding-panel"><h2>Funding progress — {campaign.name} ({campaign.currency})</h2>
      {([['Received', report.received], ['Allocated', report.allocated], ['Spent', report.expended]] as const).map(([label, amount]) =>
        <div className="funding-progress" data-stage={label.toLowerCase()} key={label}>
          <span>{label}</span><progress aria-label={`${label} compared with the largest recorded amount`} value={amount} max={maximum} />
          <strong>{fundingMoney(amount, campaign.currency)}</strong>
        </div>)}
      <Facts values={[
        ['Budget', fundingMoney(report.budget, campaign.currency)], ['Pledged · awaiting receipt', fundingMoney(report.pledged, campaign.currency)],
        ['Unallocated', fundingMoney(report.received - report.allocated, campaign.currency)],
      ]} />
    </section>;
  }
  return <section className="funding-panel funding-table" tabIndex={0} role="region" aria-label="Campaign report">
    <table><thead><tr><th>Material category</th><th>Received</th><th>Allocated</th><th>Distributed</th></tr></thead><tbody>
      {materials.map(item => <tr key={`${item.category}:${item.unit}`}><th scope="row">{fundingLabel(item.category)}</th>
        <td>{amountText(item.received, item.unit)}</td><td>{amountText(item.allocated, item.unit)}</td><td>{amountText(item.distributed, item.unit)}</td></tr>)}
    </tbody></table>
  </section>;
}

function Activity({ data, campaign, donations }: { data: Workspace; campaign: Campaign; donations: Donation[] }) {
  const records = new Map(donations.map(item => [item.id, item]));
  const events = data.events.filter(item => records.has(item.donationId));
  if (!events.length) return <Empty title="No funding activity for this campaign" />;
  return <section className="funding-panel"><h2>Campaign activity timeline</h2><ol className="funding-timeline">{events.map(event => <li key={event.id}>
    <time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time><span className="funding-icon"><CircleCheck size={18} aria-hidden="true" /></span>
    <div><strong>{event.activity}</strong><small>Donation {reference(event.donationId)} · {records.get(event.donationId)?.donor || campaign.name}</small></div>
    <Link to={`${fundingWorkspace}/donations?campaign=${campaign.id}&donation=${event.donationId}`}>View donation <ArrowRight size={15} aria-hidden="true" /></Link>
  </li>)}</ol></section>;
}

function Investigations({ data, campaign, donations, ...actions }: FundingActionProps & { data: Workspace; campaign: Campaign; donations: Donation[] }) {
  const [selection, setSelection] = useState('');
  const ids = new Set(donations.map(donation => donation.id));
  const flags = data.flags.filter(item => item.donationId && ids.has(item.donationId));
  const flag = flags.find(item => item.id === selection);
  return <>
    <div className="funding-section-title"><h2>Ledger flags ({flags.length})</h2>
      <Button variant="secondary" busy={actions.busy} onClick={() => actions.submit({ path: `${actions.url}/campaigns/${campaign.id}/scan` })}><ScanLine size={18} aria-hidden="true" /> Scan campaign ledger</Button>
    </div>
    {flags.length ? <section className="funding-panel funding-table" tabIndex={0} role="region" aria-label="Ledger flags"><table>
      <thead><tr><th>Flag</th><th>Campaign</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>{flags.map(item => <tr key={item.id} data-selected={flag?.id === item.id}>
        <td>{fundingLabel(item.category)}</td><td>{campaign.name}</td>
        <td><span className="funding-status" data-state={item.reviewedAt ? 'good' : 'pending'}>{item.reviewedAt ? 'Reviewed' : 'Pending'}</span></td>
        <td><button type="button" onClick={() => setSelection(item.id)} aria-pressed={flag?.id === item.id} aria-label={`Review ${fundingLabel(item.category)}`}>Review</button></td>
      </tr>)}</tbody>
    </table></section> : <Empty title="No flags recorded for this campaign" />}
    {flag && <div className="funding-investigation-detail" key={flag.id}><InvestigationList flags={[flag]} busy={actions.busy}
      reference={item => <Link to={`${fundingWorkspace}/donations?campaign=${campaign.id}&donation=${item.donationId}`}>View flagged donation <Search size={14} aria-hidden="true" /></Link>}
      review={(id, values) => actions.submit({ path: `${actions.url}/investigations/${id}/review`, data: values })} /></div>}
  </>;
}
