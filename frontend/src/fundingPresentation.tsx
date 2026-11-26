import type { ReactNode } from 'react';
import type { Campaign, Donation } from './FundingWorkspace';

export function fundingMoney(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function fundingLabel(value: string) {
  return value === 'FoodWater' ? 'Food & water' : value.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function donationStatus(donation: Pick<Donation, 'state' | 'kind'>) {
  if (donation.state === 'Pledged') return 'Awaiting receipt';
  if (donation.state === 'Confirmed') return 'Received';
  if (donation.state === 'Distributed') return donation.kind === 'Material' ? 'Distributed' : 'Spent';
  return fundingLabel(donation.state);
}

export function DonationStatus({ donation }: { donation: Donation }) {
  const tone = donation.state === 'Pledged' ? 'pending' : donation.state === 'Cancelled' ? 'neutral' : 'good';
  return <span className="funding-status" data-state={tone}>{donationStatus(donation)}</span>;
}

export function CampaignStatus({ campaign }: { campaign: Campaign }) {
  return <span className="funding-status" data-state={campaign.open ? 'good' : 'neutral'}>{campaign.open ? 'Open' : 'Closed'}</span>;
}

export function FundingFacts({ values }: { values: [string, ReactNode][] }) {
  return <dl className="funding-facts">{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
