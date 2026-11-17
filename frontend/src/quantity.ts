export function isMeasuredUnit(unit: string) {
  return ['kg', 'kilogram', 'kilograms', 'l', 'liter', 'liters', 'litre', 'litres'].includes(unit.trim().toLowerCase());
}
