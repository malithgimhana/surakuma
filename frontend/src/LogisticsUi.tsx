import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { get } from './api';
import type { Need } from './FulfillmentPlanning';
import { unitSymbol } from './quantity';
import { useCountry } from './geography';
import type { LogisticsData } from './logistics';
import type { Category, Priority, Status } from './types';
import './admin-logistics.css';
import './logistics-workspace.css';

export interface FulfillmentItem extends Need {
  reservedQuantity: number;
  inTransitQuantity: number;
}

export interface FulfillmentCase {
  id: string;
  reference: string;
  legacyReference?: string | null;
  crisisId: string;
  organisationId: string;
  category: Category;
  priority: Priority;
  status: Status;
  quantity: number;
  unit: string | null;
  deliveredQuantity: number;
  reservedQuantity: number;
  inTransitQuantity: number;
  hasReservations: boolean;
  inTransit: boolean;
  atCentre?: boolean;
  hasPackedItems?: boolean;
  region: string | null;
  synthetic: boolean;
  requiresCoordinatorAuthorization?: boolean;
  requiresCentreHandover?: boolean;
  authorizedAt?: string | null;
  packingComplete?: boolean;
  needCount?: number;
  needsPending?: boolean;
  items?: FulfillmentItem[];
}

export const stages = [
  'Pending allocation',
  'Reserved',
  'Ready to dispatch',
  'In transit',
  'At centre',
  'Completed',
] as const;
export type FulfillmentStage = (typeof stages)[number];
export const remainingNeed = (row: FulfillmentCase) =>
  Math.max(
    0,
    Math.round(
      (row.quantity - row.deliveredQuantity - row.reservedQuantity - row.inTransitQuantity) *
        100000000,
    ) / 100000000,
  );

// The state bands are mutually exclusive. Fully reserved means eligible for dispatch.
export function fulfillmentStage(row: FulfillmentCase): FulfillmentStage {
  if (row.status === 'Fulfilled' || row.status === 'Closed') return 'Completed';
  if (row.requiresCentreHandover && row.authorizedAt && row.hasPackedItems) return 'Ready to dispatch';
  if (row.inTransit) return 'In transit';
  if (row.atCentre) return 'At centre';
  if (row.requiresCoordinatorAuthorization && !row.authorizedAt) return 'Pending allocation';
  if (row.needCount)
    return row.hasReservations && !row.needsPending && row.packingComplete
      ? 'Ready to dispatch'
      : row.hasReservations
        ? 'Reserved'
        : 'Pending allocation';
  if (row.hasReservations && row.requiresCoordinatorAuthorization && !row.packingComplete)
    return 'Reserved';
  if (row.hasReservations) return remainingNeed(row) === 0 ? 'Ready to dispatch' : 'Reserved';
  return 'Pending allocation';
}

export const logisticsHref = (path: string, params: Record<string, string> = {}) =>
  `${path}?${new URLSearchParams({ role: 'Logistics', ...params })}`;
export const casesHref = (id?: string, params?: Record<string, string>) =>
  logisticsHref(id ? `/staff/cases/${id}` : '/staff/cases', params);
export const inventoryHref = (params?: Record<string, string>) =>
  logisticsHref('/staff/resources', params);
export const supplyHref = (params?: Record<string, string>) =>
  logisticsHref('/staff/supply-support', params);

export const quantityText = (value: number, unit?: string | null) =>
  `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(value)}${unit ? ` ${unitSymbol(unit)}` : ''}`;

const timeZones: Record<string, string> = {
  LK: 'Asia/Colombo',
  IN: 'Asia/Kolkata',
  NP: 'Asia/Kathmandu',
};
export function sameOperationsDay(
  date: string | null | undefined,
  country: string,
  now = new Date(),
) {
  if (!date || !Number.isFinite(Date.parse(date))) return false;
  const calendar = new Intl.DateTimeFormat('en', { timeZone: timeZones[country] ?? 'UTC' });
  return calendar.format(new Date(date)) === calendar.format(now);
}

export function useLogisticsData(enabled = true) {
  const country = useCountry();
  return useQuery({
    queryKey: ['staff-logistics', country],
    queryFn: () =>
      get<LogisticsData>(`/logistics?specialist=true&countryCode=${encodeURIComponent(country)}`),
    enabled,
  });
}

export function useFulfillmentCases() {
  const country = useCountry();
  return useQuery({
    queryKey: ['logistics-cases', country],
    queryFn: () =>
      get<FulfillmentCase[]>(`/logistics/cases?countryCode=${encodeURIComponent(country)}`),
  });
}

export function LogisticsHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="logistics-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="logistics-header-actions">{actions}</div>}
    </header>
  );
}

export function LogisticsHeading({
  icon: Icon,
  children,
  href,
  linkText = 'View all',
}: {
  icon: LucideIcon;
  children: ReactNode;
  href?: string;
  linkText?: string;
}) {
  return (
    <div className="logistics-panel-heading">
      <h2>
        <Icon size={19} aria-hidden="true" />
        {children}
      </h2>
      {href && (
        <Link to={href}>
          {linkText}
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

export function LogisticsAttention({ children }: { children: ReactNode }) {
  return (
    <div className="logistics-attention">
      <TriangleAlert size={20} aria-hidden="true" />
      <strong>Attention needed</strong>
      {children}
    </div>
  );
}
