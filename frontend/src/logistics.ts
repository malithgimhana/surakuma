import type { Category } from './types';

export interface InventoryItem {
  id: string;
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
  kind: 'Dispatch' | 'Transfer';
  resourceId: string;
  destinationResourceId: string | null;
  crisisId: string | null;
  requestId: string | null;
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
  crises: Array<{ id: string; name: string; countryCode: string; active: boolean }>;
  areas: Array<{ id: string; name: string; crisisId: string }>;
  partners: Array<{ id: string; name: string; countryCode: string }>;
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

export type ShipmentAction = 'dispatch' | 'deliver' | 'cancel';
export const actionLabels: Record<ShipmentAction, string> = {
  dispatch: 'Dispatch stock', deliver: 'Confirm receipt', cancel: 'Release reservation',
};
export const shipmentStatus = { Reserved: 'Pending', Dispatched: 'In transit', Delivered: 'Delivered', Cancelled: 'Cancelled', DeliveryException: 'Delivery failed' };

export type LogisticsDialogState =
  | { kind: 'resource' | 'depot'; country?: string }
  | { kind: 'stock' | 'dispatch' | 'reservation' | 'transfer'; resourceId?: string }
  | { kind: 'details'; resourceId: string }
  | { kind: 'receipt'; receipt: Receipt; order: Shipment }
  | { kind: 'transition'; order: Shipment; action: ShipmentAction };

export function resourceCode(item: InventoryItem) {
  return item.code || `RES-${item.id.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
}

export function shipmentCode(item: Shipment) {
  return `${item.kind === 'Transfer' ? 'TRF' : 'DSP'}-${item.id.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
}

export function isLow(item: InventoryItem) {
  return item.lowStockThreshold != null && item.available < item.lowStockThreshold;
}

export function inventoryStatus(item: InventoryItem) {
  if (isLow(item)) return 'Low stock';
  if (item.stock === 0) return 'Out of stock';
  return item.reserved > 0 ? 'Reserved' : 'Normal';
}

export function transferMatches(origin: InventoryItem, destination: InventoryItem) {
  return !!origin.depotId && !!destination.depotId && origin.depotId !== destination.depotId
    && origin.category === destination.category && compatibleUnits(origin.unit, destination.unit)
    && origin.name.toLowerCase() === destination.name.toLowerCase()
    && (!origin.code || !destination.code || origin.code.toLowerCase() === destination.code.toLowerCase());
}
import { compatibleUnits } from './quantity';
