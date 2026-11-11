import { useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get } from './api';
import { Field } from './components';
import { ChevronDown } from 'lucide-react';
export interface Country {
  code: string;
  name: string;
  languages: string;
  requiredAlertLanguages: string;
  emergencyContactsJson: string;
}
export function selectedCountry() {
  try {
    return localStorage.getItem('surakuma.country') || 'LK';
  } catch {
    return 'LK';
  }
}
export function useCountry() {
  return useSyncExternalStore((fn) => {
    window.addEventListener('surakuma-country', fn);
    return () => window.removeEventListener('surakuma-country', fn);
  }, selectedCountry);
}
export function useCountries() {
  return useQuery({ queryKey: ['countries'], queryFn: () => get<Country[]>('/countries') });
}
export function CountrySelector() {
  const country = useCountry(),
    client = useQueryClient(),
    countries = useCountries();
  return (
    <label className="language country-selector">
      <span className="sr-only">Country</span>
      <select
        aria-label="Country"
        value={country}
        onChange={(e) => {
          localStorage.setItem('surakuma.country', e.target.value);
          void client.cancelQueries();
          client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'countries' });
          window.dispatchEvent(new Event('surakuma-country'));
        }}
      >
        {(Array.isArray(countries.data) && countries.data.length
          ? countries.data
          : [
              { code: 'LK', name: 'Sri Lanka' },
              { code: 'NP', name: 'Nepal' },
              { code: 'IN', name: 'India' },
            ]
        ).map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
      <ChevronDown size={14} aria-hidden="true" />
    </label>
  );
}
export function RegionField({ initialDivisionId }: { initialDivisionId?: string | null }) {
  const country = useCountry();
  const regions = useQuery({
    queryKey: ['divisions', country],
    queryFn: () =>
      get<{ id: string; name: string; levelName: string; parentId: string | null }[]>(
        `/countries/${country}/divisions`,
      ),
  });
  const [chosenPath, setPath] = useState<string[] | null>(null);
  const all = Array.isArray(regions.data) ? regions.data : [];
  const initialPath: string[] = [];
  let current = all.find((r) => r.id === initialDivisionId);
  while (current && !initialPath.includes(current.id)) {
    initialPath.unshift(current.id);
    current = all.find((r) => r.id === current?.parentId);
  }
  const path = chosenPath ?? initialPath;
  const parents: (string | null)[] = [null, ...path];
  return (
    <>
      <input type="hidden" name="countryCode" value={country} />
      <input type="hidden" name="administrativeDivisionId" value={path.at(-1) || ''} />
      {parents.map((parent, depth) => {
        const children = all.filter((r) => r.parentId === parent);
        if (!children.length && depth > 0) return null;
        return (
          <Field
            key={parent || 'root'}
            label={depth === 0 ? 'Administrative region' : `Local division (level ${depth + 1})`}
          >
            <select
              value={path[depth] || ''}
              onChange={(e) =>
                setPath([...path.slice(0, depth), ...(e.target.value ? [e.target.value] : [])])
              }
            >
              <option value="">
                {depth === 0 ? 'Select a region (optional)' : 'Keep the parent region'}
              </option>
              {children.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.levelName}
                </option>
              ))}
            </select>
          </Field>
        );
      })}
    </>
  );
}
