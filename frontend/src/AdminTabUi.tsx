import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Card, Field, IconTile } from './components';
import { selectCountry, useCountries, useCountry } from './geography';
import './admin-tabs.css';

export function useAdminTabScope(globalAdmin: boolean) {
  const country = useCountry();
  const client = useQueryClient();
  const countries = useCountries();
  const [allForCountry, setAllForCountry] = useState<string>();
  const scope = globalAdmin && allForCountry === country ? '' : country;
  const options = Array.isArray(countries.data) ? countries.data : [];
  function setScope(code: string) {
    setAllForCountry(code ? undefined : country);
    if (code) selectCountry(code, client);
  }
  return { scope, country, options, globalAdmin, setScope, countries };
}

export function AdminScopeField({
  selection,
  onChange,
}: {
  selection: ReturnType<typeof useAdminTabScope>;
  onChange?: () => void;
}) {
  const { scope, country, options, globalAdmin, setScope, countries } = selection;
  const currentName = options.find((option) => option.code === country)?.name ?? country;
  return (
    <Field
      label="Filter by country"
      hint={globalAdmin && countries.error ? 'Country list unavailable.' : undefined}
    >
      <select
        value={scope}
        disabled={!globalAdmin}
        onChange={(event) => {
          setScope(event.target.value);
          onChange?.();
        }}
      >
        {globalAdmin && <option value="">All countries</option>}
        {(globalAdmin
          ? options.length
            ? options
            : [{ code: country, name: currentName }]
          : [{ code: country, name: currentName }]
        ).map((option) => (
          <option key={option.code} value={option.code}>
            {option.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function AdminMetrics({
  items,
}: {
  items: { label: string; value: ReactNode; icon: LucideIcon; tone?: string }[];
}) {
  return (
    <div className="admin-tab-metrics">
      {items.map((item) => (
        <Card key={item.label} className="admin-tab-metric">
          <IconTile icon={item.icon} tone={item.tone} />
          <div>
            <span>{item.label}</span>
            <strong>{item.value ?? '—'}</strong>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function AdminPanelHeading({
  title,
  icon,
  description,
}: {
  title: string;
  icon: LucideIcon;
  description?: string;
}) {
  return (
    <div className="admin-tab-panel-heading">
      <IconTile icon={icon} />
      <div>
        <h2>{title}</h2>
        {description && <p className="muted">{description}</p>}
      </div>
    </div>
  );
}

export function ResetAdminFilters({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" onClick={onClick}>
      <RotateCcw size={15} aria-hidden="true" /> Reset filters
    </Button>
  );
}

export function AdminPagination({
  label,
  page,
  total,
  size,
  setPage,
  busy = false,
}: {
  label: string;
  page: number;
  total: number;
  size: number;
  setPage: (page: number) => void;
  busy?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="admin-pagination" role="group" aria-label={label}>
      <Button
        type="button"
        variant="secondary"
        disabled={page <= 1 || busy}
        onClick={() => setPage(page - 1)}
      >
        Previous
      </Button>
      <span aria-live="polite">
        Page {page} of {pages}
      </span>
      <Button
        type="button"
        variant="secondary"
        disabled={page >= pages || busy}
        onClick={() => setPage(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}

export function AdminTimestamp({ value }: { value: string }) {
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Colombo',
      }).format(new Date(value))}
    </time>
  );
}

export function startOfAdminDay() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (kind: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === kind)?.value;
  return new Date(
    `${value('year')}-${value('month')}-${value('day')}T00:00:00+05:30`,
  ).toISOString();
}
