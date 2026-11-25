import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Bell, Package } from 'lucide-react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { api, errorMessage, get } from './api';
import { useAuth } from './auth';
import { Button, Empty, ErrorState, Field, Loading, PageHeader, formatDate } from './components';
import { donorWorkspace } from './countryScope';
import { AssignedCountry, useCountry } from './geography';
import { PledgeForm, amountText } from './FundingWorkspace';
import type { Campaign, Donation, FundingActionProps, FundingWrite, Workspace } from './FundingWorkspace';
import { CampaignStatus, DonationStatus, FundingFacts, fundingLabel, fundingMoney } from './fundingPresentation';

const pages = {
  overview: 'Donor overview', campaigns: 'Donation campaigns', donations: 'Donations and pledges',
  allocations: 'Allocations', expenses: 'Distributions and spending', reports: 'Transparency reports',
  activity: 'Donation activity', profile: 'Donor profile',
};
type Section = keyof typeof pages;
const path = (section: Section | 'notifications', campaign?: string) =>
  `${donorWorkspace}/${section}${campaign ? `?${new URLSearchParams({ campaign })}` : ''}`;
const reliefPhoto = '/donor-art/relief-packing.webp';
const suppliesPhoto = '/donor-art/food-packs.webp';
const amount = (value: number, donation: Donation) => donation.kind === 'Monetary'
  ? fundingMoney(value, donation.unit) : amountText(value, donation.unit);
const activityLabel = (activity: string) => activity === 'Pledged' ? 'Pledge recorded'
  : activity === 'Aid allocation recorded' ? 'Donation allocated' : fundingLabel(activity);

export default function DonorWorkspace() {
  const { section = 'overview' } = useParams();
  const country = useCountry();
  const { user } = useAuth();
  if (!Object.hasOwn(pages, section)) return <Navigate to={donorWorkspace} replace />;
  return <DonorPage key={`${user?.id}:${country}:${section}`} country={country} section={section as Section} />;
}

function DonorPage({ country, section }: { country: string; section: Section }) {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const url = `/funding/${country}`;
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['funding', country, false, user?.id], queryFn: () => get<Workspace>(`${url}/workspace?manage=false`) });
  const write = useMutation({
    mutationFn: ({ path, method, data }: FundingWrite) => api[method ?? 'post'](path, data),
    onSuccess: () => client.invalidateQueries({ queryKey: ['funding'] }),
  });
  const actions = { url, busy: write.isPending, submit: (input: FundingWrite) => write.mutate(input) };
  const data = query.data;
  const campaignNames = new Map(data?.campaigns.map(campaign => [campaign.id, campaign.name]));
  const open = data?.campaigns.filter(campaign => campaign.open) ?? [];
  const featured = open[0];
  const selected = data?.campaigns.find(campaign => campaign.id === params.get('campaign')) ?? featured ?? data?.campaigns[0];
  return <div className="donor-page">
    <PageHeader title={pages[section]} />
    {write.isSuccess && <p className="funding-feedback" role="status">{section === 'profile' ? 'Profile saved.' : 'Donation records updated.'}</p>}
    {write.error && <p className="funding-feedback funding-error" role="alert">{errorMessage(write.error)}</p>}
    {!data ? query.isError ? <ErrorState error={query.error} retry={() => void query.refetch()} /> : <Loading /> : <>
      {section === 'overview' && <>
        {featured ? <section className="donor-hero">
          <div className="donor-hero-copy">
            <p className="donor-open-label">Open campaign</p>
            <h2>{featured.name}</h2><p>{featured.purpose}</p>
            <div className="inline">
              <Link className="button primary" to={path('donations', featured.id)}>Pledge to this campaign</Link>
              <Link to={path('campaigns')}>Browse all campaigns</Link>
            </div>
          </div>
          <img src={reliefPhoto} alt="" />
        </section> : <section className="funding-panel"><Empty title="No open campaigns in this country"
          action={<Link to={path('campaigns')}>Browse donation campaigns</Link>} /></section>}
        <div className="donor-overview-grid">
          <DonationList donations={data.donations.slice(0, 4)} names={campaignNames} />
          <section className="funding-panel donor-latest"><h2>Latest updates</h2>
            {data.events[0] ? <div className="donor-update"><Bell size={24} aria-hidden="true" /><div>
              <strong>{activityLabel(data.events[0].activity)}</strong>
              <p>{campaignNames.get(data.donations.find(donation => donation.id === data.events[0].donationId)?.campaignId ?? '')}</p>
              <time dateTime={data.events[0].createdAt}>{formatDate(data.events[0].createdAt)}</time>
            </div></div> : <p className="muted">No donation updates yet.</p>}
            <Link className="donor-next" to={path('notifications')}>View notifications <ArrowRight size={17} aria-hidden="true" /></Link>
          </section>
        </div>
      </>}
      {section === 'campaigns' && <>
        <p className="donor-description muted">Choose a campaign to support in <AssignedCountry code={country} />.</p>
        {data.campaigns.length ? <div className="donor-campaign-grid">{data.campaigns.map(campaign =>
          <article className="funding-panel donor-campaign-card" key={campaign.id}>
            <img src={campaign.id === featured?.id ? reliefPhoto : suppliesPhoto} alt="" loading="lazy" />
            <div className="donor-campaign-details"><CampaignStatus campaign={campaign} />
              <h2>{campaign.name}</h2><p>{campaign.purpose}</p>
              <FundingFacts values={[["Campaign budget", fundingMoney(campaign.budget, campaign.currency)]]} />
              {campaign.open ? <Link className="button primary" to={path('donations', campaign.id)}>Pledge to this campaign</Link>
                : <Link to={path('reports', campaign.id)}>View transparency report</Link>}
            </div>
          </article>)}</div> : <Empty title="No campaigns in this country" />}
      </>}
      {section === 'donations' && <div className="donor-pledge-grid">
        <PledgeForm key={params.get('campaign') ?? ''} {...actions} campaigns={open} />
        <DonationList donations={data.donations} names={campaignNames} actions={actions} />
      </div>}
      {section === 'allocations' && <DonorAllocations data={data} names={campaignNames} />}
      {section === 'expenses' && <DonorSpending data={data} names={campaignNames} />}
      {section === 'reports' && (selected ? <>
        <p className="donor-description muted">See how campaign funds and supplies are used.</p>
        <div className="funding-context donor-report-context"><Field label="Campaign">
          <select value={selected.id} onChange={event => setParams({ campaign: event.target.value })}>
            {data.campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
          </select></Field></div>
        <DonorReports campaign={selected} data={data} />
      </> : <Empty title="No campaign totals" />)}
      {section === 'activity' && <section className="funding-panel">
        {data.events.length ? <ul className="donor-events">{data.events.map(event => {
          const donation = data.donations.find(item => item.id === event.donationId);
          return <li key={event.id}><div><strong>{activityLabel(event.activity)}</strong>
            {donation && <p>{campaignNames.get(donation.campaignId)} · {amount(donation.amount, donation)}</p>}</div>
            <time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time></li>;
        })}</ul> : <Empty title="No funding updates" />}
        <Link to={path('notifications')}>View notifications</Link>
      </section>}
      {section === 'profile' && (data.profile ? <DonorProfile profile={data.profile} actions={actions} /> : <Empty title="No donor profile found" />)}
    </>}
  </div>;
}

function CampaignLink({ id, names }: { id: string; names: Map<string, string> }) {
  const name = names.get(id);
  return name ? <Link to={path('reports', id)}>{name}</Link> : <span>Campaign unavailable</span>;
}

function DonationList({ donations, names, actions }: { donations: Donation[]; names: Map<string, string>; actions?: FundingActionProps }) {
  return <section className="funding-panel donor-donations"><h2>My donations</h2>
    {donations.length ? <div className="donor-table"><table><thead><tr><th scope="col">Contribution</th><th scope="col">Campaign</th><th scope="col">Status</th></tr></thead>
      <tbody>{donations.map(donation => <tr key={donation.id}>
        <td><strong>{amount(donation.amount, donation)}</strong></td><td><CampaignLink id={donation.campaignId} names={names} /></td>
        <td><DonationStatus donation={donation} />{actions && donation.state === 'Pledged' &&
          <Button className="donor-cancel" type="button" variant="ghost" disabled={actions.busy}
            onClick={() => actions.submit({ path: `${actions.url}/donations/${donation.id}/cancel` })}>Cancel pledge</Button>}</td>
      </tr>)}</tbody></table></div> : <p className="muted">No donation records yet.</p>}
    {!actions && <Link className="donor-next" to={path('donations')}>View donations and pledges <ArrowRight size={17} aria-hidden="true" /></Link>}
  </section>;
}

function DonorAllocations({ data, names }: { data: Workspace; names: Map<string, string> }) {
  const donations = new Map(data.donations.map(donation => [donation.id, donation]));
  const entries = data.allocations.flatMap(allocation => {
    const donation = donations.get(allocation.donationId);
    return donation ? [{ allocation, donation }] : [];
  });
  const waiting = data.donations.filter(donation => donation.state === 'Pledged');
  return <>
    <p className="donor-description muted">See where your confirmed donations were allocated.</p>
    <section className="funding-panel"><h2>My allocations</h2>
      {entries.length ? <div className="donor-table"><table><thead><tr><th scope="col">Campaign</th><th scope="col">Donation type</th><th scope="col">Allocated</th><th scope="col">Status</th></tr></thead>
        <tbody>{entries.map(({ allocation, donation }) => <tr key={allocation.id}>
          <td><CampaignLink id={donation.campaignId} names={names} /></td><td>{donation.kind}</td>
          <td><strong>{amount(allocation.amount, donation)}</strong></td><td><span className="funding-status" data-state="good">Allocated</span></td>
        </tr>)}</tbody></table></div> : <p className="muted">Your donations have no allocations yet.</p>}
      {waiting.length > 0 && <div className="donor-pending"><span className="funding-status" data-state="pending">Awaiting receipt</span>
        {waiting.length === 1 ? <span>{names.get(waiting[0].campaignId)} · {amount(waiting[0].amount, waiting[0])}</span>
          : <span>{waiting.length} pledges are awaiting receipt verification.</span>}
      </div>}
      <Link className="donor-next" to={path('donations')}>View donations and pledges <ArrowRight size={17} aria-hidden="true" /></Link>
    </section>
  </>;
}

function DonorSpending({ data, names }: { data: Workspace; names: Map<string, string> }) {
  const donations = new Map(data.donations.map(donation => [donation.id, donation]));
  const allocations = new Map(data.allocations.map(allocation => [allocation.id, allocation]));
  const entries = data.expenses.flatMap(expense => {
    const allocation = allocations.get(expense.allocationId);
    const donation = allocation && donations.get(allocation.donationId);
    return donation && allocation ? [{ expense, donation, allocation }] : [];
  });
  const money = entries.filter(entry => entry.donation.kind === 'Monetary');
  const materials = entries.filter(entry => entry.donation.kind === 'Material');
  const pendingMaterial = data.donations.filter(donation => donation.kind === 'Material' && donation.state === 'Pledged');
  const totals = new Map<string, number>();
  for (const entry of money) totals.set(entry.donation.unit, (totals.get(entry.donation.unit) ?? 0) + entry.expense.amount);
  function records(list: typeof entries) {
    return <ul className="donor-events">{list.map(({ expense, donation, allocation }) => <li key={expense.id}>
      <div><CampaignLink id={donation.campaignId} names={names} />
        {expense.createdAt && <time dateTime={expense.createdAt}>{formatDate(expense.createdAt)}</time>}</div>
      <div><strong>{amount(expense.amount, donation)}</strong><small>{amount(allocation.amount, donation)} allocated</small></div>
    </li>)}</ul>;
  }
  return <>
    <p className="donor-description muted">See how your contributions were used.</p>
    <div className="donor-spending-grid">
      <section className="funding-panel"><h2>Money spent</h2>
        {money.length ? <><div className="donor-spending-totals">{Array.from(totals, ([currency, total]) =>
          <strong key={currency}>{fundingMoney(total, currency)}</strong>)}</div>{records(money)}</> : <p className="muted">No spending recorded yet.</p>}
      </section>
      <section className="funding-panel"><h2>Material distributions</h2>
        {materials.length ? records(materials) : <div className="donor-material-empty"><Package size={38} aria-hidden="true" /><strong>No distributions recorded yet</strong></div>}
        {pendingMaterial.length > 0 && <div className="donor-pending">{pendingMaterial.length === 1
          ? `${names.get(pendingMaterial[0].campaignId) ?? 'Material pledge'} · ${amount(pendingMaterial[0].amount, pendingMaterial[0])} awaiting receipt`
          : `${pendingMaterial.length} material pledges awaiting receipt`}</div>}
      </section>
    </div>
    <Link className="donor-next" to={path('reports')}>View transparency reports <ArrowRight size={17} aria-hidden="true" /></Link>
  </>;
}

function DonorReports({ campaign, data }: { campaign: Campaign; data: Workspace }) {
  const report = data.reports.find(item => item.campaignId === campaign.id);
  const materials = data.materialReports.filter(item => item.campaignId === campaign.id);
  return <div className="donor-report-grid">
    <section className="funding-panel" aria-label={`Campaign finances for ${campaign.name}`}><h2>Campaign finances</h2><p className="muted">Campaign totals</p>
      {report ? <FundingFacts values={[
        ['Budget', fundingMoney(report.budget, campaign.currency)], ['Received', fundingMoney(report.received, campaign.currency)],
        ['Allocated', fundingMoney(report.allocated, campaign.currency)], ['Spent', fundingMoney(report.expended, campaign.currency)],
        ['Unallocated', fundingMoney(report.received - report.allocated, campaign.currency)],
      ]} /> : <p className="muted">No financial report is available for this campaign.</p>}
    </section>
    <section className="funding-panel"><h2>Material donations</h2>
      {materials.length ? materials.map(item => <div className="donor-material-report" key={`${item.category}:${item.unit}`}>
        <h3>{fundingLabel(item.category)}</h3><FundingFacts values={[
          ['Received', amountText(item.received, item.unit)], ['Allocated', amountText(item.allocated, item.unit)], ['Distributed', amountText(item.distributed, item.unit)],
        ]} />
      </div>) : <p className="muted">No verified material donations for this campaign.</p>}
    </section>
  </div>;
}

function DonorProfile({ profile, actions }: { profile: NonNullable<Workspace['profile']>; actions: FundingActionProps }) {
  return <section className="funding-panel donor-profile">
    <div className="donor-profile-identity"><span className="avatar" aria-hidden="true">{profile.displayName.trim().charAt(0).toUpperCase() || 'D'}</span>
      <div><h2>{profile.displayName}</h2><p className="muted">Donor</p></div></div>
    <form key={JSON.stringify([profile.displayName, profile.organisationName])} className="form-grid" onSubmit={event => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      actions.submit({ path: '/funding/profile', method: 'put', data: { displayName: values.get('name'), organisationName: values.get('organisation') } });
    }}>
      <Field label="Donor name"><input name="name" maxLength={100} defaultValue={profile.displayName} required /></Field>
      <Field label="Donor organisation (optional)" hint="Leave blank if you donate as an individual."><input name="organisation" maxLength={150} defaultValue={profile.organisationName ?? ''} /></Field>
      <Button busy={actions.busy}>Save profile</Button>
    </form>
  </section>;
}
