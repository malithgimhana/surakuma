import type { SelectHTMLAttributes } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { get } from './api';
import { compatibleUnits } from './quantity';

interface ResourceUnit {
  code: string;
  label: string;
  allowsFractions: boolean;
  stockCategories?: string[] | null;
}

type ResourceUnitSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  category: string | null;
  existingUnit?: string | null;
  compatibleWith?: string | null;
  allowPersons?: boolean;
};

export function useResourceUnitCatalog(enabled = true) {
  return useQuery({
    queryKey: ['resource-units'],
    queryFn: () => get<ResourceUnit[]>('/public/resource-units'),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

export function isStockUnitForCategory(unit: ResourceUnit, category: string | null) {
  return category !== null && unit.stockCategories?.includes(category) === true;
}

export function ResourceUnitSelect({ category, existingUnit, compatibleWith, allowPersons, ...props }: ResourceUnitSelectProps) {
  const { t } = useTranslation();
  const catalog = useResourceUnitCatalog();
  const definitions = Array.isArray(catalog.data) ? catalog.data : [];
  const units = definitions.filter(unit =>
    (!compatibleWith || compatibleUnits(unit.code, compatibleWith)) &&
    (isStockUnitForCategory(unit, category) || (allowPersons && unit.code === 'persons')));
  const legacy = existingUnit && !units.some(unit => unit.code === existingUnit)
    ? definitions.find(unit => unit.code === existingUnit)
    : undefined;
  return <select {...props} aria-busy={catalog.isPending || undefined}>
    <option value="">{t(catalog.isError ? 'measurementUnavailable' : 'selectMeasurementUnit')}</option>
    {legacy && <option value={legacy.code}>{t('units.' + legacy.code, { defaultValue: legacy.label })}</option>}
    {units.map(unit => <option key={unit.code} value={unit.code}>
      {t('units.' + unit.code, { defaultValue: unit.label })}
    </option>)}
  </select>;
}
