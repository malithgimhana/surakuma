const litreUnits = ['l', 'liter', 'liters', 'litre', 'litres'];

export function normalizeUnit(unit?: string | null) {
  const value = unit?.trim().toLowerCase() ?? '';
  if (['kg', 'kilogram', 'kilograms'].includes(value)) return 'kg';
  if (['g', 'gram', 'grams'].includes(value)) return 'g';
  if (litreUnits.includes(value)) return 'l';
  if (['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'].includes(value)) return 'ml';
  if (['pieces', 'piece', 'items', 'item', 'pcs'].includes(value)) return 'pieces';
  if (['packs', 'pack'].includes(value)) return 'packs';
  if (['persons', 'person', 'people'].includes(value)) return 'persons';
  return value;
}

export function baseUnit(unit?: string | null) {
  const normalized = normalizeUnit(unit);
  return normalized === 'kg' ? 'g' : normalized === 'l' ? 'ml' : normalized;
}

export function compatibleUnits(first?: string | null, second?: string | null) {
  return !!baseUnit(first) && baseUnit(first) === baseUnit(second);
}

export function isMeasuredUnit(unit: string) {
  return ['g', 'ml'].includes(baseUnit(unit));
}

export function stockLevelStep(unit: string) {
  return isMeasuredUnit(unit) && !litreUnits.includes(unit.trim().toLowerCase()) ? 0.01 : 1;
}

export function convertCompatibleQuantity(amount: number, from: string, to: string) {
  const larger = (unit: string) => ['kg', 'l'].includes(normalizeUnit(unit));
  if (!compatibleUnits(from, to)) return 0;
  return amount * (larger(from) ? 1000 : 1) / (larger(to) ? 1000 : 1);
}

export function unitSymbol(unit?: string | null) {
  return unit === 'l' ? 'L' : unit === 'ml' ? 'mL' : unit ?? '';
}
