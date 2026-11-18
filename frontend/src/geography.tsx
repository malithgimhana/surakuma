import { createContext, useContext, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
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
export const CountryScope = createContext<string | undefined>(undefined);

const countryOptions = [
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'NP', name: 'Nepal' },
  { code: 'IN', name: 'India' },
];

export function selectedCountry() {
  try {
    return localStorage.getItem('surakuma.country') || 'LK';
  } catch {
    return 'LK';
  }
}
export function useCountry() {
  const fixedCountry = useContext(CountryScope);
  const savedCountry = useSyncExternalStore((fn) => {
    window.addEventListener('surakuma-country', fn);
    return () => window.removeEventListener('surakuma-country', fn);
  }, selectedCountry);
  return fixedCountry ?? savedCountry;
}
export function useCountries() {
  return useQuery({ queryKey: ['countries'], queryFn: () => get<Country[]>('/countries') });
}
export function selectCountry(code: string, client: QueryClient) {
  if (code === selectedCountry()) return;
  localStorage.setItem('surakuma.country', code);
  void client.cancelQueries();
  client.removeQueries({ predicate: (query) => !['countries', 'my-profile'].includes(String(query.queryKey[0])) });
  window.dispatchEvent(new Event('surakuma-country'));
}

export function CountryFlag({ code }: { code: string }) {
  if (!countryOptions.some(country => country.code === code)) return null;
  return <img className="workspace-country-flag" src={`${import.meta.env.BASE_URL}country-flags/${code.toLowerCase()}.svg`}
    alt="" width={20} height={15} />;
}

export function CountrySelector({ withFlag = false }: { withFlag?: boolean }) {
  const country = useCountry(),
    client = useQueryClient(),
    countries = useCountries();
  const fixedCountry = useContext(CountryScope);
  const options = Array.isArray(countries.data) && countries.data.length ? countries.data : countryOptions;
  if (fixedCountry) {
    const name = options.find(option => option.code === fixedCountry)?.name ?? fixedCountry;
    return <span className="workspace-country" title={name}><span className="sr-only">Country </span>{withFlag && <CountryFlag code={fixedCountry} />}{name}</span>;
  }
  return (
    <label className={`language country-selector${withFlag ? ' country-selector-with-flag' : ''}`}>
      <span className="sr-only">Country</span>
      {withFlag && <CountryFlag code={country} />}
      <select
        aria-label="Country"
        value={country}
        onChange={(e) => selectCountry(e.target.value, client)}
      >
        {options.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
      <ChevronDown size={14} aria-hidden="true" />
    </label>
  );
}
export function useDivisions(country: string) {
  return useQuery({
    queryKey: ['divisions', country],
    queryFn: () =>
      get<{ id: string; name: string; levelName: string; parentId: string | null }[]>(
        `/countries/${country}/divisions`,
      ),
  });
}

export function RegionField({ initialDivisionId, onChange }: {
  initialDivisionId?: string | null;
  onChange?: (id: string | null) => void;
}) {
  const country = useCountry();
  const regions = useDivisions(country);
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
      <input type="hidden" name="administrativeDivisionId" value={path.at(-1) ?? (chosenPath === null ? initialDivisionId ?? '' : '')} />
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
              onChange={(e) => {
                const next = [...path.slice(0, depth), ...(e.target.value ? [e.target.value] : [])];
                setPath(next);
                onChange?.(next.at(-1) ?? null);
              }}
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
