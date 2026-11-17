import { useId, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import {
  ChartNoAxesColumnIncreasing, CircleCheck, Clock3, Download, Droplet, FileText, Flame,
  FolderOpen, Globe2, HeartPulse, Info, Layers, Package, Tent, Truck, UsersRound,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api, get } from './api';
import { Button, Card, ErrorState, Field, Loading } from './components';
import { useCountry } from './geography';
import type { Category } from './types';
import './operational-reports.css';

type Counts = Record<'activeCrises' | 'submitted' | 'open' | 'unassigned' | 'overdue' | 'resolved', number>;

interface ReportStockItem {
  countryCode: string;
  category: Category;
  name: string;
  unit: string;
  stock: number;
  reserved: number;
  available: number;
}

interface Report {
  totals: Counts;
  countries: (Counts & { countryCode: string; country: string })[];
  stock: ReportStockItem[];
  generatedAt: string;
  version: string;
  previousPeriod?: { submitted: number; percentChange: number | null } | null;
}

interface ReportFilters {
  isSystemAdministrator: boolean;
  countries: { code: string; name: string }[];
  crises: { id: string; name: string; countryCode: string }[];
}

const metrics = [
  { key: 'activeCrises', label: 'Active crises', column: 'Active crises', icon: Flame, tone: 'coral' },
  { key: 'submitted', label: 'Requests submitted', column: 'Submitted', icon: FileText, tone: 'blue' },
  { key: 'open', label: 'Open cases', column: 'Open', icon: FolderOpen, tone: 'blue' },
  { key: 'unassigned', label: 'Unassigned', column: 'Unassigned', icon: UsersRound, tone: 'violet' },
  { key: 'overdue', label: 'Overdue', column: 'Overdue', icon: Clock3, tone: 'amber' },
  { key: 'resolved', label: 'Resolved', column: 'Resolved', icon: CircleCheck, tone: 'green' },
] as const;

const stockIcons = {
  FoodWater: [Droplet, 'blue'],
  Medical: [HeartPulse, 'coral'],
  Shelter: [Tent, 'amber'],
  Transportation: [Truck, 'blue'],
  Accessibility: [Package, 'violet'],
  Other: [Package, 'violet'],
} as const;

const definitions = [
  ['Open cases', 'Requests excluding fulfilled, closed, rejected and cancelled cases.'],
  ['Unassigned cases', 'Open cases missing a response centre, a case manager, or both.'],
  ['Overdue cases', 'Cases still open more than 24 hours after submission.'],
  ['Resolved cases', 'Requests currently marked fulfilled or closed.'],
] as const;

const reportTimestamp = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
});

function dateOffset(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function ReportKpis({ report, number }: { report: Report; number: Intl.NumberFormat }) {
  return (
    <ul className="report-kpis" aria-label="Operational figures">
      {metrics.map(({ key, label, icon: Icon, tone }) => {
        const change = key === 'submitted' ? report.previousPeriod?.percentChange : null;
        return (
          <li key={key} className="report-kpi">
            <span className="report-icon" data-tone={tone}><Icon size={22} aria-hidden="true" /></span>
            <div className="report-kpi-body">
              <span>{label}</span>
              <strong>{number.format(report.totals[key])}</strong>
              {change != null && (
                <small className="report-comparison">
                  {change > 0 ? '+' : ''}{number.format(change)}% vs previous period
                </small>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function CountryPerformance({ report, multiple, workspace, number }: {
  report: Report; multiple: boolean; workspace: string; number: Intl.NumberFormat;
}) {
  const heading = useId();
  return (
    <section className="report-panel" aria-labelledby={heading}>
      <header className="report-panel-heading">
        <span className="report-icon"><ChartNoAxesColumnIncreasing size={20} aria-hidden="true" /></span>
        <div><h2 id={heading}>Country performance</h2><p>Current case status for requests submitted in the selected period.</p></div>
      </header>
      <div className="report-table-wrap" tabIndex={0}>
        <table className="report-table report-performance" aria-labelledby={heading}>
          <thead><tr><th scope="col">Country</th>{metrics.map(({ key, column }) => <th key={key} scope="col">{column}</th>)}</tr></thead>
          <tbody>
            {report.countries.map(row => (
              <tr key={row.countryCode}>
                <th scope="row">{row.country}</th>
                {metrics.map(({ key }) => {
                  const link = key === 'activeCrises' ? '/admin/crises' : key === 'unassigned' ? '/admin?section=cases' : null;
                  return <td key={key}>{!multiple && row.countryCode === workspace && link
                    ? <Link to={link}>{number.format(row[key])}</Link>
                    : number.format(row[key])}</td>;
                })}
              </tr>
            ))}
          </tbody>
          {multiple && (
            <tfoot><tr><th scope="row">Total</th>{metrics.map(({ key }) => <td key={key}>{number.format(report.totals[key])}</td>)}</tr></tfoot>
          )}
        </table>
      </div>
      {report.totals.submitted === 0 && <p className="report-empty">No requests were submitted for these filters.</p>}
    </section>
  );
}

function StockSnapshot({ report, multiple, number }: {
  report: Report; multiple: boolean; number: Intl.NumberFormat;
}) {
  const { t } = useTranslation();
  const heading = useId();
  const groups = new Map<string, { item: ReportStockItem; countries: Map<string, ReportStockItem> }>();
  for (const item of report.stock) {
    const key = JSON.stringify([item.category, item.name, item.unit]);
    const group = groups.get(key) ?? { item, countries: new Map<string, ReportStockItem>() };
    group.countries.set(item.countryCode, item);
    groups.set(key, group);
  }

  return (
    <section className="report-panel" aria-labelledby={heading}>
      <header className="report-panel-heading">
        <span className="report-icon"><Layers size={20} aria-hidden="true" /></span>
        <div><h2 id={heading}>Current stock snapshot</h2><p>Inventory by resource and country at generation time.</p></div>
      </header>
      {groups.size === 0 ? <p className="report-empty">No stock recorded for the selected countries.</p> : (
        <div className="report-table-wrap" tabIndex={0}>
          <table className="report-table report-stock" aria-labelledby={heading}>
            <thead>
              <tr>
                <th scope="col">Resource</th>
                {multiple
                  ? report.countries.map(country => <th key={country.countryCode} scope="col">{country.country}</th>)
                  : ['Unit', 'On hand', 'Reserved', 'Available'].map(label => <th key={label} scope="col">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {Array.from(groups, ([key, { item, countries }]) => {
                const [Icon, tone] = stockIcons[item.category] ?? stockIcons.Other;
                const category = t(`category.${item.category}`, { defaultValue: t('category.Other') });
                return (
                  <tr key={key}>
                    <th scope="row">
                      <div className="report-resource-name">
                        <span className="report-icon" data-tone={tone}><Icon size={16} aria-hidden="true" /></span>
                        <div>{item.name}<small>{category}</small></div>
                      </div>
                    </th>
                    {multiple ? report.countries.map(country => {
                      const row = countries.get(country.countryCode);
                      return <td key={country.countryCode}>{row ? (
                        <>
                          <strong>{number.format(row.available)} {row.unit} <span className="report-available-label">available</span></strong>
                          <small>{number.format(row.stock)} on hand · {number.format(row.reserved)} reserved</small>
                        </>
                      ) : <span className="muted" aria-label="No stock recorded">—</span>}</td>;
                    }) : (
                      <><td>{item.unit}</td><td>{number.format(item.stock)}</td><td>{number.format(item.reserved)}</td>
                        <td><strong>{number.format(item.available)}</strong></td></>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ReportDefinitions() {
  return (
    <details className="report-definitions" open>
      <summary><span className="report-icon"><Info size={20} aria-hidden="true" /></span>How this report counts cases</summary>
      <div className="report-definition-body">
        <dl>
          {definitions.map(([label, description]) => <div key={label}><dt>{label}</dt><dd>{description}</dd></div>)}
        </dl>
        <p>Submitted counts all requests filed in the UTC period. Active crises and stock reflect the current snapshot. Available stock is on hand minus reserved.</p>
        <p>Submission trends use the preceding period of equal length when it had submissions. Historical case status, crisis activity and stock snapshots are unavailable.</p>
      </div>
    </details>
  );
}

export function OperationalReports() {
  const workspace = useCountry();
  const { i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 2 });
  const choices = useQuery({ queryKey: ['report-filters'], queryFn: () => get<ReportFilters>('/admin/reports/filters?countryCode=') });
  const countries = choices.data?.countries ?? [];
  const [scope, setScope] = useState<'country' | 'all'>('country');
  const [preferred, setPreferred] = useState<{ workspace: string; code: string }>();
  const [chosenCrisis, setChosenCrisis] = useState('');
  const [from, setFrom] = useState(() => dateOffset(-29));
  const [through, setThrough] = useState(() => dateOffset(0));
  const multipleAllowed = !!choices.data?.isSystemAdministrator || countries.length > 1;
  const multiple = multipleAllowed && scope === 'all';
  const current = preferred?.workspace === workspace ? preferred.code : workspace;
  const countryCode = countries.find(c => c.code === current)?.code ?? countries[0]?.code ?? '';
  const crises = (choices.data?.crises ?? []).filter(crisis => multiple || crisis.countryCode === countryCode);
  const crisisId = crises.some(crisis => crisis.id === chosenCrisis) ? chosenCrisis : '';
  const datesComplete = !!from === !!through;
  const ordered = !from || !through || from <= through;
  const validDates = datesComplete && ordered && through < '9999-12-31';
  const query = new URLSearchParams({ scope: multiple ? 'all' : 'country', countryCode: multiple ? '' : countryCode });
  if (crisisId) query.set('crisisId', crisisId);
  if (from && through && validDates) {
    const end = new Date(through + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() + 1);
    query.set('from', from + 'T00:00:00Z');
    query.set('to', end.toISOString());
  }
  const params = query.toString();
  const report = useQuery({
    queryKey: ['admin-report', params],
    queryFn: () => get<Report>(`/admin/reports?${params}`),
    enabled: countries.length > 0 && validDates,
  });
  const download = useMutation({
    mutationFn: async ({ format, parameters, version }: { format: 'csv' | 'pdf'; parameters: string; version: string }) => {
      const exportParams = new URLSearchParams(parameters);
      exportParams.set('version', version);
      const path = format === 'pdf' ? 'export/pdf' : 'export';
      try {
        const response = await api.get<Blob>(`/admin/reports/${path}?${exportParams}`, { responseType: 'blob' });
        const url = URL.createObjectURL(response.data);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = format === 'pdf' ? 'surakuma-operational-report.pdf' : 'surakuma-country-report.csv';
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 409) {
          await report.refetch();
          throw new Error('Report data changed. Review the refreshed figures and download again.');
        }
        throw error;
      }
    },
  });
  const startExport = (format: 'csv' | 'pdf') => {
    if (report.data) download.mutate({ format, parameters: params, version: report.data.version });
  };
  const canExport = validDates && !!report.data && !report.isFetching && !report.isError && !download.isPending;
  const visibleCountries = multiple ? countries : countries.filter(c => c.code === countryCode);
  const allLabel = choices.data?.isSystemAdministrator ? 'All countries' : 'All assigned countries';

  return (
    <Card className="operational-reports">
      <header className="report-heading">
        <span className="report-icon"><ChartNoAxesColumnIncreasing size={28} aria-hidden="true" /></span>
        <div>
          <h1>Operational reports</h1>
          <p>Review humanitarian case activity and current response capacity for the selected scope.</p>
        </div>
        {visibleCountries.length > 0 && <div className="report-scope-pill">
          <Globe2 size={15} aria-hidden="true" />
          <strong>{multiple ? 'Multi-country report' : 'Country report'}</strong>
          <span>{visibleCountries.map(country => country.name).join(' · ')}</span>
        </div>}
      </header>
      {choices.isPending ? <Loading /> : choices.isError ? <ErrorState error={choices.error} retry={() => choices.refetch()} /> : countries.length === 0
        ? <p className="report-empty">No countries are available for reporting.</p>
        : (
          <>
            <div className="report-filters">
              <div className="report-filter-fields">
                {multipleAllowed && <Field label="Report scope">
                  <select value={multiple ? 'all' : 'country'} onChange={event => setScope(event.target.value === 'all' ? 'all' : 'country')}>
                    <option value="country">Selected country</option>
                    <option value="all">{allLabel}</option>
                  </select>
                </Field>}
                <Field label="Report country">
                  <select value={multiple ? '' : countryCode} onChange={event => {
                    const code = event.target.value;
                    if (code) setPreferred({ workspace, code });
                    setScope(code ? 'country' : 'all');
                    setChosenCrisis('');
                  }}>
                    {multipleAllowed && <option value="">{allLabel}</option>}
                    {countries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
                  </select>
                </Field>
                <Field label="Crisis">
                  <select className="report-crisis-select" value={crisisId} onChange={event => setChosenCrisis(event.target.value)}>
                    <option value="">All crises</option>
                    {crises.map(crisis => (
                      <option key={crisis.id} value={crisis.id}>{crisis.name}{multiple ? ` (${crisis.countryCode})` : ''}</option>
                    ))}
                  </select>
                </Field>
                <Field label="From (UTC)">
                  <input type="date" value={from} max="9999-12-30" onChange={event => setFrom(event.target.value)} />
                </Field>
                <Field label="Through (UTC)">
                  <input type="date" value={through} max="9999-12-30" onChange={event => setThrough(event.target.value)} />
                </Field>
              </div>
              <div className="report-export-actions">
                <Button type="button" disabled={!canExport} busy={download.isPending && download.variables?.format === 'csv'} onClick={() => startExport('csv')}>
                  <Download size={16} aria-hidden="true" /> Download CSV
                </Button>
                <Button type="button" variant="secondary" disabled={!canExport} busy={download.isPending && download.variables?.format === 'pdf'} onClick={() => startExport('pdf')}>
                  <FileText size={16} aria-hidden="true" /> Export PDF
                </Button>
              </div>
            </div>
            {download.error && download.variables?.parameters === params && (
              isAxiosError(download.error) ? <ErrorState error={download.error} />
                : <p className="field-error" role="alert">{download.error.message}</p>
            )}
            {!validDates ? (
              <p className="field-error" role="alert">
                {datesComplete ? 'Choose a valid UTC range with the Through date on or after the From date.' : 'Enter both dates, or clear both to report on all submissions.'}
              </p>
            ) : report.isPending ? <Loading /> : report.isError ? (
              <ErrorState error={report.error} retry={() => report.refetch()} />
            ) : (
              <>
                <ReportKpis report={report.data} number={number} />
                <div className="report-panels">
                  <CountryPerformance report={report.data} multiple={multiple} workspace={workspace} number={number} />
                  <StockSnapshot report={report.data} multiple={multiple} number={number} />
                </div>
                <ReportDefinitions />
                <p className="report-timestamp">Snapshot generated <time dateTime={report.data.generatedAt}>{reportTimestamp.format(new Date(report.data.generatedAt))} UTC</time></p>
              </>
            )}
          </>
        )}
    </Card>
  );
}
