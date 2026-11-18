import type { SelectHTMLAttributes } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { get } from './api';

interface ResourceUnit {
  code: string;
  label: string;
  allowsFractions: boolean;
}

export function ResourceUnitSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { t } = useTranslation();
  const catalog = useQuery({
    queryKey: ['resource-units'],
    queryFn: () => get<ResourceUnit[]>('/public/resource-units'),
    staleTime: 5 * 60 * 1000,
  });
  const units = Array.isArray(catalog.data) ? catalog.data : [];
  return <select {...props} disabled={props.disabled || catalog.isPending || catalog.isError}>
    <option value="">{t(catalog.isError ? 'measurementUnavailable' : 'selectMeasurementUnit')}</option>
    {units.map(unit => <option key={unit.code} value={unit.code}>
      {t('units.' + unit.code, { defaultValue: unit.label })}
    </option>)}
  </select>;
}
