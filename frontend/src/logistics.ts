import type { Category } from './types';

export interface InventoryItem {
  id: string;
  reference?: string;
  name: string;
  code: string | null;
  countryCode: string;
  organisationId: string;
  depotId: string | null;
  category: Category;
  unit: string;
  stock: number;
  reserved: number;
  available: number;
  locationText: string;
  lowStockThreshold: number | null;
  suitability: string;
  transportAvailable: boolean;
  canShip?: boolean;
}

export interface DepotOption {
  id: string;
  name: string;
  location: string;
  countryCode: string;
  organisationId: string;
}

export interface Shipment {
  id: string;
  caseDispatchId?: string | null;
  centreReceivedAt?: string | null;
  reference?: string;
  kind: 'Dispatch' | 'Transfer';
  resourceId: string;
  destinationResourceId: string | null;
  crisisId: string | null;
  requestId: string | null;
  dispatchedAt?: string | null;
  packedAt?: string | null;
  scheduledArrivalAt?: string | null;
  resourceUnit?: string;
  origin: string;
  destination: string;
  quantity: number;
  status: 'Reserved' | 'Dispatched' | 'Delivered' | 'Cancelled' | 'DeliveryException';
  actorId: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
}

export interface LogisticsData {
  countries: Array<{ code: string; name: string }>;
  depots: DepotOption[];
  inventory: InventoryItem[];
  caseInventory?: InventoryItem[];
  caseStockScope?: { organisationId: string; crisisId: string; depotId?: string | null }[];
  crises: Array<{ id: string; name: string; countryCode: string; active: boolean }>;
  areas: Array<{ id: string; name: string; crisisId: string }>;
  partners: Array<{ id: string; name: string; countryCode: string }>;
  resourceRegistration?: {
    depots: Array<DepotOption & { canManageStock: boolean }>;
    partners: Array<LogisticsData['partners'][number] & { canRegisterDepot: boolean }>;
  };
  organisations?: Array<{ id: string; name: string }>;
  orders: Shipment[];
  actors: Record<string, string>;
  receipts?: Receipt[];
}
export interface Receipt {
  id: string;
  allocationId: string | null;
  logisticsOrderId: string | null;
  reference: string;
  confirmedQuantity: number;
  receivedAt: string;
  receivedBy: string;
  method: 'ReceivingStaff' | 'RecipientAcknowledgment';
  actorId: string;
  note: string;
  exceptionDetail: string;
}

export type ShipmentAction = 'dispatch' | 'deliver' | 'prepare';
export const actionLabels: Record<ShipmentAction, string> = {
  prepare: 'Confirm packing', dispatch: 'Dispatch stock', deliver: 'Confirm receipt',
};
export const shipmentStatus = { Reserved: 'Pending', Dispatched: 'In transit', Delivered: 'Delivered', Cancelled: 'Cancelled', DeliveryException: 'Delivery failed' };

export type LogisticsDialogState =
  | { kind: 'resource'; country?: string }
  | { kind: 'stock' | 'dispatch' | 'reservation' | 'transfer'; resourceId?: string }
  | { kind: 'details'; resourceId: string }
  | { kind: 'receipt'; receipt: Receipt; order: Shipment }
  | { kind: 'transition'; order: Shipment; action: ShipmentAction };

export function resourceCode(item: InventoryItem) {
  if (!item.reference) return item.code || legacyLogisticsReference('RES', item.id);
  return item.code ? `${item.reference} · ${item.code}` : item.reference;
}

export function legacyLogisticsReference(prefix: 'RES' | 'TRF' | 'DSP', id: string) {
  return `${prefix}-${id.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
}

export function legacyShipmentCode(item: Pick<Shipment, 'kind' | 'id'>) {
  return legacyLogisticsReference(item.kind === 'Transfer' ? 'TRF' : 'DSP', item.id);
}

export function shipmentCode(item: Pick<Shipment, 'kind' | 'id' | 'reference'>) {
  return item.reference || legacyShipmentCode(item);
}

export function groupDispatches(orders: Shipment[]) {
  const groups = new Map<string, Shipment[]>();
  for (const order of orders) {
    const id = order.caseDispatchId ?? order.id;
    const lines = groups.get(id);
    if (lines) lines.push(order);
    else groups.set(id, [order]);
  }
  return [...groups.values()];
}

export function shipmentGroupStatus(lines: Shipment[]) {
  const [order] = lines;
  if (!order.caseDispatchId) return shipmentStatus[order.status];
  if (!order.centreReceivedAt) return 'In transit';
  if (lines.some(line => line.status === 'Dispatched')) return 'At centre';
  return lines.every(line => line.status === 'DeliveryException') ? 'Delivery failed' :
    lines.some(line => line.status === 'DeliveryException') ? 'Handover verified with shortages' : 'Handover verified';
}

export function isLow(item: InventoryItem) {
  return item.stock > 0 && item.lowStockThreshold != null && item.available < item.lowStockThreshold;
}

export const isOut = (item: InventoryItem) => item.stock === 0;
export const stockGap = (item: InventoryItem) => Math.max(0, (item.lowStockThreshold ?? 0) - item.available);
export const hasStockAlert = (item: InventoryItem) => isOut(item) || isLow(item);
export const isDeliveryException = (order: Shipment, receipt?: Receipt) =>
  order.status === 'DeliveryException' || !!receipt?.exceptionDetail;

export function visibleInventory(data: LogisticsData) {
  return [...new Map([...(data.caseInventory ?? []), ...data.inventory].map(item => [item.id, item])).values()];
}

export function caseStockForCrisis(data: LogisticsData, crisisId: string) {
  const grants = data.caseStockScope?.filter(grant => grant.crisisId === crisisId) ?? [];
  return (data.caseInventory ?? []).filter(item => grants.some(grant => grant.organisationId === item.organisationId &&
    (grant.depotId == null || grant.depotId === item.depotId)));
}

export function inventoryForCase(data: LogisticsData, crisisId: string) {
  return [...data.inventory, ...caseStockForCrisis(data, crisisId)];
}

export function inventoryStatus(item: InventoryItem) {
  if (isOut(item)) return 'Out of stock';
  if (isLow(item)) return 'Low stock';
  return item.reserved > 0 ? 'Reserved' : 'Normal';
}

export function transferMatches(origin: InventoryItem, destination: InventoryItem) {
  return !!origin.depotId && !!destination.depotId && origin.depotId !== destination.depotId
    && origin.category === destination.category && compatibleUnits(origin.unit, destination.unit)
    && origin.name.toLowerCase() === destination.name.toLowerCase()
    && (!origin.code || !destination.code || origin.code.toLowerCase() === destination.code.toLowerCase());
}
import { compatibleUnits } from './quantity';
