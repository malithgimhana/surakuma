import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Flag, Search, Users } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { get } from './api';
import { caseAmounts } from './CaseManagerUi';
import { Badge, Button, Empty, ErrorState, Field, formatDate, Loading, PageHeader } from './components';
import { CoordinatorMetrics, CoordinatorPanel, coordinatorCase, coordinatorCases, useCoordinatorOverview } from './CoordinatorOverview';
import { countryPath, dashboardRefreshInterval } from './crisisOperationsApi';
import { useCountry } from './geography';
import type { AidRequest, Page, Priority, Status } from './types';

const views = [
  ['', 'All cases'], ['critical', 'Critical'], ['approved', 'Approved'],
  ['unassigned', 'Unassigned'], ['follow-ups', 'Follow-up'],
] as const;
const operationalViews = [
  ['escalated', 'Pending escalations'], ['shortages', 'Stock shortages'], ['overdue', 'Overdue cases'], ['assigned', 'Assigned cases'],
] as const;
const statuses: Status[] = ['Submitted', 'UnderReview', 'Verified', 'Approved', 'InProgress',
  'PartiallyFulfilled', 'Fulfilled', 'Closed', 'Rejected', 'Cancelled'];
const priorities: Priority[] = ['Critical', 'Urgent', 'High', 'Medium', 'Normal', 'Low'];
const assessment: Record<string, string> = {
  Pending: 'Processing', Completed: 'Ready', Failed: 'Unavailable', Skipped: 'Skipped',
};
type CaseResults = Page<AidRequest> & { legacyAssessmentIds: string[] };

export default function CoordinatorCases() {
  const country = useCountry();
  const { search } = useLocation();
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') ?? '';
  const term = params.get('search') ?? '';
  const status = params.get('status') ?? '';
  const priority = params.get('priority') ?? '';
  const page = params.get('page') ?? '1';
  const summary = useCoordinatorOverview(country);
  const metrics = summary.data?.metrics;
  const query = useQuery({
    queryKey: ['cases', 'Coordinator', country, view, term, status, priority, page],
    queryFn: () => get<CaseResults>(countryPath('/requests/coordinator', country, {
      staffRole: 'Coordinator', view, search: term, status: view === 'approved' ? '' : status, priority, page,
    })),
    refetchInterval: dashboardRefreshInterval,
  });
  function change(fields: Record<string, string>) {
    setParams(current => {
      const next = new URLSearchParams(current);
      next.set('role', 'Coordinator');
      next.delete('page');
      for (const [name, value] of Object.entries(fields)) {
        if (value) next.set(name, value);
        else next.delete(name);
      }
      return next;
    });
  }
  const secondaryView = operationalViews.find(([key]) => key === view);
  const results = query.data;
  const pages = results ? Math.ceil(results.total / results.pageSize) : 0;
  return <div className="coord-page">
    <PageHeader title="Cases & AI Review" description="Monitor case decisions, escalations and fulfilment across assigned crises." />
    <CoordinatorMetrics label="Case summary" items={[
      { label: 'All cases', value: metrics?.cases, icon: ClipboardList, to: coordinatorCases() },
      { label: 'Critical cases', value: metrics?.critical, icon: AlertTriangle, tone: 'red', to: coordinatorCases('critical') },
      { label: 'Approved cases', value: metrics?.approved, icon: CheckCircle2, tone: 'green', to: coordinatorCases('approved') },
      { label: 'Unassigned cases', value: metrics?.unassigned, icon: Users, tone: 'amber', to: coordinatorCases('unassigned') },
      { label: 'Pending escalations', value: metrics?.escalated, icon: Flag, tone: 'coral', to: coordinatorCases('escalated') },
    ]} />
    {summary.error && <ErrorState error={summary.error} retry={() => void summary.refetch()} />}
    <CoordinatorPanel title="Case records" action={results && <span className="muted" role="status">{results.total.toLocaleString()} {results.total === 1 ? 'result' : 'results'}</span>}>
      <nav className="coord-tabs" aria-label="Case views">
        {[...views, ...(secondaryView ? [secondaryView] : [])].map(([key, label]) => (
          <Link key={key} to={coordinatorCases(key || undefined)} aria-current={view === key ? 'page' : undefined}>{label}</Link>
        ))}
      </nav>
      <form className="coord-filters coord-case-filters" key={term} onSubmit={event => {
        event.preventDefault();
        change({ search: String(new FormData(event.currentTarget).get('search') ?? '').trim() });
      }}>
        <Field label="Search cases"><input name="search" defaultValue={term} placeholder="Reference, request or location" /></Field>
        <Field label="Status">
          <select value={view === 'approved' ? 'Approved' : status} disabled={view === 'approved'} onChange={e => change({ status: e.target.value })}>
            <option value="">All statuses</option>{statuses.map(state => <option key={state} value={state}>{t('status.' + state)}</option>)}
          </select>
        </Field>
        <Field label="Priority"><select value={priority} onChange={e => change({ priority: e.target.value })}>
          <option value="">All priorities</option>{priorities.map(value => <option key={value}>{value}</option>)}
        </select></Field>
        <Field label="Operational queue"><select value={secondaryView?.[0] ?? ''} onChange={e => change({ view: e.target.value })}>
          <option value="">Any queue</option>{operationalViews.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></Field>
        <Button variant="secondary"><Search size={17} /> Search</Button>
      </form>
      {query.isPending ? <Loading /> : query.error ? <ErrorState error={query.error} retry={() => void query.refetch()} /> :
        !results?.items.length ? <Empty title="No cases match this view" description="Change the search or select another case view." /> : <>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Case results">
            <table className="coord-table">
              <thead><tr><th>Case</th><th>Requested aid</th><th>Priority</th><th>AI assessment</th><th>Status</th><th>Submitted</th></tr></thead>
              <tbody>{results.items.map(row => <tr key={row.id}>
                <td><Link className="coord-record-link" to={coordinatorCase(row.id)}
                  state={{ caseQueue: '/staff/cases' + search }}>{row.reference}<ArrowRight size={15} aria-hidden="true" /></Link>
                  <small>{row.locationText}</small></td>
                <td>{t('category.' + row.category)}<small>{caseAmounts(row).requested}</small></td>
                <td><Badge value={row.priority} />{row.priorityScore != null && <small>Score {row.priorityScore}</small>}</td>
                <td>{row.assessmentState ? assessment[row.assessmentState] ?? 'Unavailable' :
                  results.legacyAssessmentIds.includes(row.id) ? 'Ready' : '—'}</td>
                <td><Badge value={row.status} />{row.escalated && <small className="coord-case-flags">Escalated</small>}</td>
                <td>{formatDate(row.createdAt)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {pages > 1 && <div className="coord-pager">
            <Button variant="secondary" disabled={results.pageNumber <= 1} onClick={() => change({ page: String(results.pageNumber - 1) })}>Previous</Button>
            <span>Page {results.pageNumber} of {pages}</span>
            <Button variant="secondary" disabled={results.pageNumber >= pages} onClick={() => change({ page: String(results.pageNumber + 1) })}>Next</Button>
          </div>}
        </>}
    </CoordinatorPanel>
  </div>;
}
