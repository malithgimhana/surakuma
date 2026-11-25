import type { Category } from './types';

type SupplyItem = { id: string; name: string; stockUnit: string };

const foodSupplyItems = [
  { id: 'Water', name: 'Drinking water', stockUnit: 'l' },
  { id: 'BabyFormula', name: 'Baby formula', stockUnit: 'pieces' },
  { id: 'CookedMeals', name: 'Cooked meals or ready-to-eat food', stockUnit: 'packs' },
  { id: 'DryRations', name: 'Dry rations', stockUnit: 'packs' },
  { id: 'CookingGas', name: 'Cooking gas', stockUnit: 'kg' },
  { id: 'Clothes', name: 'Clothes', stockUnit: 'pieces' },
  { id: 'Blankets', name: 'Blankets', stockUnit: 'pieces' },
  { id: 'Hygiene', name: 'Hygiene supplies', stockUnit: 'packs' },
  { id: 'Cleaning', name: 'Cleaning supplies', stockUnit: 'cartons' },
] as const;

export const stockResourceItems: Record<Category, readonly SupplyItem[]> = {
  FoodWater: foodSupplyItems,
  Medical: [
    { id: 'MedicalKits', name: 'Medical support kits', stockUnit: 'kits' },
    { id: 'Bandages', name: 'Bandages', stockUnit: 'packs' },
    { id: 'Dressings', name: 'Sterile dressings', stockUnit: 'packs' },
  ],
  Shelter: [
    { id: 'Tents', name: 'Tents', stockUnit: 'pieces' },
    { id: 'Tarpaulins', name: 'Tarpaulins', stockUnit: 'pieces' },
    { id: 'SleepingMats', name: 'Sleeping mats', stockUnit: 'pieces' },
  ],
  Transportation: [
    { id: 'Fuel', name: 'Fuel', stockUnit: 'l' },
    { id: 'VehicleRepairKits', name: 'Vehicle repair kits', stockUnit: 'kits' },
  ],
  Accessibility: [
    { id: 'Wheelchairs', name: 'Wheelchairs', stockUnit: 'pieces' },
    { id: 'WalkingAids', name: 'Walking aids', stockUnit: 'pieces' },
    { id: 'PortableRamps', name: 'Portable ramps', stockUnit: 'pieces' },
  ],
  Other: [
    { id: 'Gloves', name: 'Protective gloves', stockUnit: 'pairs' },
    { id: 'Torches', name: 'Torches', stockUnit: 'pieces' },
    { id: 'Batteries', name: 'Batteries', stockUnit: 'packs' },
  ],
};

export const foodItems: Record<string, string> = Object.fromEntries(
  foodSupplyItems.map(({ id, name }) => [id, name]),
);
