import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, errorMessage, get } from './api';
import { useAuth } from './auth';
import { Badge, Button, Card, Empty, ErrorState, Field, Loading, PageHeader, categories, formatDate } from './components';
import { countryPath } from './crisisOperationsApi';
import { useCountry } from './geography';
import { unitSymbol } from './quantity';

export interface Investigation {
  id: string; requestId?: string; donationId?: string; category: string; evidence: string; severity: string; outcome?: string;
  reviewerUserId?: string; reviewedAt?: string; resolution?: string;
}
interface Forecast {
  record: { id: string; category: string; createdAt: string; forecastFrom: string; forecastTo: string; model: string; estimate?: number };
  evidence: { weeks: DemandWeek[]; observedLow?: number; observedHigh?: number;
    transportReadyItems: number; risk: string; limitations: string; unknownUnitRequests?: number;
    projection?: Projection; interpretation?: { text: string; source: string };
    groups?: { regionId?: string; region?: string; unit: string; weeks: DemandWeek[]; weeklyEstimate?: number; projection?: Projection }[] };
}
interface Projection { lower: number; upper: number; method: string; validationMae: number; baselineMae: number; validationPeriods: number }
interface DemandWeek { from: string; requests: number; requested?: number; fulfilled?: number }
interface Briefing {
  record: { id: string; periodFrom: string; periodTo: string; draft: string; source: string; createdByUserId: string; reviewedAt?: string; reviewNote?: string };
  facts: { newCases: number; activeCases: number; criticalCases: number; outstandingCases: number; escalatedCases: number; lowStockItems: number;
    openShelters: number; capacity: number; occupied: number; reserved: number; activeVolunteerTasks: number; tasksAwaitingReview: number;
    fulfilledCases?: number; partiallyFulfilledCases?: number; completedVolunteerTasks?: number;
    needs: { category: string; cases: number; outstandingQuantity?: number; unit?: string }[] };
}
interface DecisionData {
  name: string; countryCode: string; region?: string; forecasts: Forecast[]; briefings: Briefing[]; flags: Investigation[];
}
const reviewForm = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget));
};

export default function DecisionSupport() {
  const { id } = useParams();
  const country = useCountry();
  const { user } = useAuth();
  const administrative = useLocation().pathname.startsWith('/admin/');
  const client = useQueryClient();
  const path = '/crises/' + id + '/decision-support';
  const key = ['decision-support', country, id];
  const query = useQuery({ queryKey: key, queryFn: () => get<DecisionData>(countryPath(path, country)) });
  const action = useMutation({
    mutationFn: (input: { operation: string; data?: unknown }) => api.post(countryPath(path + input.operation, country), input.data),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const data = query.data;
  const caseBase = administrative ? '/admin/cases/' : '/staff/cases/';
  const isReviewer = user?.roles.some(role => role === 'Administrator' || role === 'CountryAdministrator');
  return <div className="stack">
    <Link to={administrative ? '/admin/crises' : '/staff/crises'}>Back to crisis operations</Link>
    <PageHeader title={data.name + ' decision support'} description={[data.countryCode, data.region].filter(Boolean).join(' · ')} />
    {action.error && <p role="alert">{errorMessage(action.error)}</p>}
    {action.isSuccess && <p role="status">Decision support records updated.</p>}
    <Card><h2>Demand forecasts</h2>
      <p>The eight most recent complete UTC weeks inform the current weekly estimate. Sufficient history is required.</p>
      <form className="form-grid" onSubmit={e => action.mutate({ operation: '/forecasts', data: reviewForm(e) })}>
        <Field label="Resource category"><select name="category">{categories.map(category => <option key={category}>{category}</option>)}</select></Field>
        <Button busy={action.isPending}>Calculate forecast</Button>
      </form>
    </Card>
    {data.forecasts.length > 0 && <ForecastResult forecast={data.forecasts[0]} />}
    {data.forecasts.length > 1 && <details><summary>Earlier forecasts</summary>
      {data.forecasts.slice(1).map(forecast => <ForecastResult key={forecast.record.id} forecast={forecast} />)}</details>}
    <Card><h2>Crisis briefings</h2>
      <form className="form-grid" onSubmit={e => {
        const values = reviewForm(e);
        action.mutate({ operation: '/briefings', data: { days: Number(values.days) } });
      }}>
        <Field label="Reporting period (days)"><input name="days" type="number" min={1} max={90} defaultValue={7} required /></Field>
        <Button busy={action.isPending}>Generate briefing draft</Button>
      </form>
    </Card>
    {data.briefings.map(({ record, facts }) => <Card key={record.id}>
      <h3>{formatDate(record.periodFrom)} to {formatDate(record.periodTo)}</h3>
      <h4>Recorded facts</h4>
      <p className="muted">Sources · case records, verified inventory, shelter occupancy and volunteer task records in this response scope.</p>
      <ul>
        <li>{facts.newCases} new cases in the period. Current snapshot has {facts.activeCases} active, {facts.criticalCases} critical and {facts.escalatedCases} escalated.</li>
        <li>{facts.outstandingCases} cases with outstanding quantities, and {facts.lowStockItems} low-stock or out-of-stock inventory items in scope.</li>
        <li>{facts.occupied} people checked in and {facts.reserved} places reserved across {facts.openShelters} open shelters with {facts.capacity} total places in scope.</li>
        <li>{facts.activeVolunteerTasks} active tasks and {facts.tasksAwaitingReview} volunteer reports awaiting verification.</li>
        {facts.fulfilledCases != null && <li>{facts.fulfilledCases} fulfilled cases, {facts.partiallyFulfilledCases} partially fulfilled cases and {facts.completedVolunteerTasks} completed volunteer tasks.</li>}
      </ul>
      {!!facts.needs.length && <ul>{facts.needs.map(need => <li key={need.category + (need.unit ?? '')}>
        {need.category} · {need.cases} cases · {need.unit ? `${need.outstandingQuantity} ${unitSymbol(need.unit)} outstanding` : 'unit clarification required'}
      </li>)}</ul>}
      <h4>Draft interpretation · {record.source}</h4><p>{record.draft}</p>
      {record.reviewedAt ? <p>Reviewed {formatDate(record.reviewedAt)} · {record.reviewNote}</p> : <p>Independent administrator review pending. Internal briefing.</p>}
      {isReviewer && user?.id !== record.createdByUserId && !record.reviewedAt &&
        <form className="stack" onSubmit={e => action.mutate({ operation: '/briefings/' + record.id + '/review', data: reviewForm(e) })}>
          <Field label="Review rationale"><textarea name="reason" maxLength={1000} required /></Field>
          <Button busy={action.isPending}>Record briefing review</Button>
        </form>}
    </Card>)}
    <Card><h2>Investigation queue</h2>
      <p>Indicators require review. Scanning leaves case decisions to staff.</p>
      <Button type="button" busy={action.isPending} onClick={() => action.mutate({ operation: '/investigations/scan' })}>Scan case indicators</Button>
    </Card>
    <InvestigationList flags={data.flags} busy={action.isPending} reference={flag => flag.requestId ? <Link to={caseBase + flag.requestId}>Open scoped case</Link> : null}
      review={(flag, values) => action.mutate({ operation: '/investigations/' + flag + '/review', data: values })} />
  </div>;
}

function ForecastResult({ forecast }: { forecast: Forecast }) {
  const { record, evidence } = forecast;
  const chart = evidence.weeks.map(w => ({ ...w, week: new Date(w.from).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }) }));
  return <Card><h3>{record.category} · {formatDate(record.createdAt)}</h3>
    <p>{record.estimate == null ? 'Insufficient history for a forecast.' : `Estimated ${record.estimate} requests · observed range ${evidence.observedLow}–${evidence.observedHigh}`}</p>
    <p>Period {record.forecastFrom.slice(0, 10)} to {record.forecastTo.slice(0, 10)} UTC, end exclusive · Statistical · {record.model}</p>
    {evidence.projection && <ProjectionEvidence projection={evidence.projection} />}
    {evidence.interpretation && <div className="recommendation">
      <strong>Interpretation · {evidence.interpretation.source}</strong><p>{evidence.interpretation.text}</p>
    </div>}
    <p>{evidence.risk} · {evidence.transportReadyItems} transport-ready inventory items</p>
    <div aria-hidden="true" style={{ height: 230, minWidth: 0 }}>
      <ResponsiveContainer width="100%" height="100%"><BarChart data={chart}>
        <XAxis dataKey="week" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="requests" name="Requests" fill="#147a74" />
      </BarChart></ResponsiveContainer>
    </div>
    <div className="table-scroll"><table>
      <caption>Observed weekly request counts</caption>
      <thead><tr><th>Week of</th><th>Requests</th></tr></thead>
      <tbody>{chart.map(w => <tr key={w.from}><td>{w.week}</td><td>{w.requests}</td></tr>)}</tbody>
    </table></div>
    {(evidence.unknownUnitRequests ?? 0) > 0 && <p>{evidence.unknownUnitRequests} requests need unit clarification.</p>}
    {evidence.groups?.map(group => <details key={(group.regionId ?? '-') + group.unit}>
      <summary>{group.region ?? 'Region unrecorded'} · {unitSymbol(group.unit)}
        {group.weeklyEstimate == null ? ' · Insufficient history for a quantity forecast' : ` · ${group.weeklyEstimate} ${unitSymbol(group.unit)} estimated next week`}
      </summary>
      {group.projection && <ProjectionEvidence projection={group.projection} />}
      <div className="table-scroll"><table>
        <thead><tr><th>Week of</th><th>Requested ({unitSymbol(group.unit)})</th><th>Received ({unitSymbol(group.unit)})</th></tr></thead>
        <tbody>{group.weeks.map(w => <tr key={w.from}><td>{w.from.slice(0, 10)}</td><td>{w.requested}</td><td>{w.fulfilled}</td></tr>)}</tbody>
      </table></div>
    </details>)}
    <p>{evidence.groups ? evidence.limitations : 'This historical forecast records weekly request counts. Recalculate for a breakdown by measurement unit.'}</p>
  </Card>;
}

function ProjectionEvidence({ projection }: { projection: Projection }) {
  return <p>Empirical range {projection.lower}–{projection.upper} · {projection.method} ·
    Mean absolute error {projection.validationMae} across {projection.validationPeriods} validation weeks
    {' '}({projection.baselineMae} for the full-history mean).</p>;
}

export function InvestigationList({ flags, busy, reference, review }: {
  flags: Investigation[]; busy: boolean; reference: (f: Investigation) => React.ReactNode;
  review: (id: string, values: Record<string, FormDataEntryValue>) => void;
}) {
  if (!flags.length) return <Empty title="No flags recorded" />;
  return <>{flags.map(flag => <Card key={flag.id}>
    <h3>{flag.category} <Badge value={flag.severity} /></h3>
    <small>Rules-based investigation indicator · {flag.reviewedAt ? 'Reviewed' : 'Review pending'}</small>
    <p>{flag.evidence}</p>{reference(flag)}
    {flag.outcome ? <p>{flag.outcome} · {flag.resolution} · {flag.reviewedAt && formatDate(flag.reviewedAt)}</p>
      : <form className="form-grid" onSubmit={e => review(flag.id, reviewForm(e))}>
        <Field label="Investigation decision"><select name="outcome">
          <option value="Dismissed">Dismiss</option><option>Monitor</option><option value="ActionRecorded">Action recorded</option>
        </select></Field>
        <Field label="Review reason"><textarea name="reason" required maxLength={1000} /></Field>
        <Button busy={busy}>Record investigation decision</Button>
      </form>}
  </Card>)}</>;
}
