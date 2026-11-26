import { convertCompatibleQuantity, isMeasuredUnit, normalizeUnit } from './quantity';
import type { Category } from './types';

type StockRecord = {
  id: string;
  name: string;
  unit: string;
  available: number;
  depotId?: string | null;
  countryCode?: string;
  organisationId?: string;
  category?: Category;
  locationText?: string;
};

export type AllocationSource = Omit<StockRecord, 'locationText'> & {
  locationText: string;
  resourceIds: string[];
};

function stockQuantity(value: number, unit: string) {
  const scale = isMeasuredUnit(unit) ? 100 : 1;
  return Math.floor(value * scale + 1e-8) / scale;
}

export function groupAllocationSources(rows: StockRecord[]): AllocationSource[] {
  const groups = new Map<string, AllocationSource>();
  for (const row of rows) {
    const unit = normalizeUnit(row.unit);
    const available = stockQuantity(row.available, unit);
    if (available <= 0) continue;
    const key = row.depotId
      ? JSON.stringify([row.countryCode, row.organisationId, row.depotId, row.category, row.name.trim().toLowerCase(), unit])
      : row.id;
    const group = groups.get(key);
    if (group) {
      group.available = stockQuantity(group.available + available, unit);
      group.resourceIds.push(row.id);
    } else {
      groups.set(key, { ...row, unit, available, locationText: row.locationText ?? '', resourceIds: [row.id] });
    }
  }
  return [...groups.values()];
}

export function allocationLimit(source: AllocationSource, outstanding: number, requestedUnit: string) {
  return stockQuantity(Math.min(source.available, convertCompatibleQuantity(outstanding, requestedUnit, source.unit)), source.unit);
}

export function allocationPath(source: AllocationSource) {
  return source.resourceIds.length > 1 ? '/allocations/group' : '/allocations';
}
