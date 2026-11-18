export function baseUnit(unit?: string | null) {
  const value = unit?.trim().toLowerCase() ?? '';
  if (['kg', 'kilogram', 'kilograms', 'g', 'gram', 'grams'].includes(value)) return 'g';
  if (['l', 'liter', 'liters', 'litre', 'litres', 'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'].includes(value)) return 'ml';
  if (['pieces', 'piece', 'items', 'item', 'pcs'].includes(value)) return 'pieces';
  if (['packs', 'pack'].includes(value)) return 'packs';
  if (['persons', 'person', 'people'].includes(value)) return 'persons';
  return value;
}

export function compatibleUnits(first?: string | null, second?: string | null) {
  return !!baseUnit(first) && baseUnit(first) === baseUnit(second);
}

export function isMeasuredUnit(unit: string) {
  return ['g', 'ml'].includes(baseUnit(unit));
}

export function unitSymbol(unit?: string | null) {
  return unit === 'l' ? 'L' : unit === 'ml' ? 'mL' : unit ?? '';
}
