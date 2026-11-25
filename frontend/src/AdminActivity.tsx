import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useSearchParams } from 'react-router-dom';
import {
  Activity,
  Bell,
  ChartNoAxesCombined,
  CircleCheck,
  FileText,
  MailWarning,
  TriangleAlert,
} from 'lucide-react';
import { get } from './api';
import {
  AdminMetrics,
  AdminPagination,
  AdminPanelHeading,
  AdminScopeField,
  AdminTimestamp,
  ResetAdminFilters,
  startOfAdminDay,
  useAdminTabScope,
} from './AdminTabUi';
import { DeliveryRecovery } from './AdministrationWorkflows';
import { Button, Card, DateInput, ErrorState, Field, Loading, PageHeader } from './components';
import type { Page } from './types';

type AuditEvent = {
  id: string;
  action: string;
  actorId: string;
  actorName?: string;
  countryCode?: string;
  detail: string;
  createdAt: string;
  entityType: string;
  entityId: string;
};
type Delivery = {
  id: string;
  state: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  eventMessage: string;
  recipientName: string | null;
  caseReference: string | null;
  provider: string | null;
  inAppStored: boolean;
  recovered: boolean;
};
type AuditPage = Page<AuditEvent> & {
  summary: { eventsToday: number; highRiskToday: number } | null;
};
type DeliveryPage = Page<Delivery> & {
  summary: {
    failed: number;
    recovered: number;
    retrying: number;
    causes: { reason: string | null; count: number }[];
  };
};
const pageSize = 10;
const previewSize = 5;
const day = 86_400_000;
const states = [
  'Failed',
  'Review',
  'Retry',
  'Pending',
  'Processing',
  'Sent',
  'Captured',
  'Skipped',
];
const deliveryLabel: Record<string, string> = {
  Sent: 'Accepted',
  Retry: 'Retrying',
  Review: 'Needs review',
  Captured: 'Captured locally',
};
const initialFilters = { action: '', actor: '', state: '', from: '', to: '', search: '' };

async function historyPage<T extends Page<unknown>>(path: string): Promise<T> {
  const result = await get<T>(path);
  if (!Array.isArray(result?.items) || typeof result.total !== 'number') {
    throw new Error('The API needs to be restarted to load activity page totals.');
  }
  return result;
}

export function AdminActivity({
  actionLabel,
  actionOptions,
}: {
  actionLabel: (value: string) => string;
  actionOptions: string[];
}) {
  const selection = useAdminTabScope(true);
  const [params, setParams] = useSearchParams();
  const { hash } = useLocation();
  const selectedDelivery = params.get('deliveryId') ?? '';
  const focusId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(selectedDelivery)
    ? selectedDelivery
    : undefined;
  const view =
    params.get('view') === 'delivery'
      ? 'delivery'
      : params.get('view') === 'audit'
        ? 'audit'
        : 'overview';
  const [filters, setFilters] = useState(initialFilters);
  const [search, setSearch] = useState({ actor: '', search: '' });
  const [auditPage, setAuditPage] = useState(1);
  const [deliveryPage, setDeliveryPage] = useState(1);
  useEffect(() => {
    if (search.actor === filters.actor.trim() && search.search === filters.search.trim()) return;
    const timer = window.setTimeout(() => {
      setSearch({ actor: filters.actor.trim(), search: filters.search.trim() });
      setAuditPage(1);
      setDeliveryPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [filters.actor, filters.search, search.actor, search.search]);
  useEffect(() => {
    if (hash === '#audit-history' || (hash === '#delivery-recovery' && view === 'delivery')) {
      document.getElementById(hash.slice(1))?.scrollIntoView?.();
    }
  }, [hash, view]);
  const dateError = [filters.from, filters.to].some((date) => date.length > 10)
    ? 'Enter a year with four digits.'
    : filters.from && filters.to && filters.from > filters.to
      ? 'End date must be on or after the start date.'
      : undefined;
  function historyParams(page: number, relevant: Record<string, string>) {
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      includeTotal: 'true',
      countryCode: selection.scope,
      ...relevant,
    });
    const from = Date.parse(filters.from + 'T00:00:00+05:30');
    const to = Date.parse(filters.to + 'T00:00:00+05:30');
    if (filters.from && Number.isFinite(from) && filters.from !== '0001-01-01')
      query.set('from', new Date(from).toISOString());
    if (filters.to && Number.isFinite(to)) query.set('to', new Date(to + day).toISOString());
    if (search.search) query.set('search', search.search);
    return query;
  }
  const auditQuery = historyParams(auditPage, { today: startOfAdminDay() });
  if (filters.action) auditQuery.set('action', filters.action);
  if (search.actor) auditQuery.set('actor', search.actor);
  const deliveryQuery = historyParams(deliveryPage, { dashboard: 'true' });
  if (filters.state) deliveryQuery.set('state', filters.state);
  const audit = useQuery({
    queryKey: ['audit', auditQuery.toString()],
    enabled: !dateError,
    queryFn: () => historyPage<AuditPage>(`/admin/audit?${auditQuery}`),
  });
  const delivery = useQuery({
    queryKey: ['deliveries', deliveryQuery.toString()],
    enabled: !dateError,
    queryFn: () => historyPage<DeliveryPage>(`/admin/deliveries?${deliveryQuery}`),
  });
  const a = audit.data?.summary;
  const d = delivery.data?.summary;
  const countryName = (code?: string) =>
    code ? (selection.options.find((c) => c.code === code)?.name ?? code) : 'Global / unscoped';
  function changeView(next: string) {
    const copy = new URLSearchParams(params);
    if (next === 'overview') copy.delete('view');
    else copy.set('view', next);
    setParams(copy);
  }
  function changeFilter(name: keyof typeof filters, value: string) {
    setFilters({ ...filters, [name]: value });
    if (name !== 'actor' && name !== 'search') {
      setAuditPage(1);
      setDeliveryPage(1);
    }
  }
  function changeScope() {
    setAuditPage(1);
    setDeliveryPage(1);
  }
  return (
    <div className="admin-tab admin-tab-stack">
      <PageHeader
        title="Activity"
        description="Review audit events and notification delivery across the platform."
      />
      <AdminMetrics
        items={[
          {
            label: 'Audit events today',
            value: a?.eventsToday ?? (audit.isSuccess && a === null ? 0 : undefined),
            icon: FileText,
          },
          { label: 'Failed deliveries', value: d?.failed, icon: MailWarning, tone: 'coral' },
          { label: 'Recovered deliveries', value: d?.recovered, icon: CircleCheck, tone: 'green' },
          {
            label: 'High-risk changes today',
            value: a?.highRiskToday ?? (audit.isSuccess && a === null ? 0 : undefined),
            icon: TriangleAlert,
            tone: 'coral',
          },
        ]}
      />
      <Card className="admin-tab-stack">
        <div className="admin-tab-switch" role="group" aria-label="Activity view">
          <button
            type="button"
            aria-pressed={view === 'overview'}
            onClick={() => changeView('overview')}
          >
            <Activity size={17} />
            Overview
          </button>
          <button type="button" aria-pressed={view === 'audit'} onClick={() => changeView('audit')}>
            <FileText size={17} />
            Audit history
          </button>
          <button
            type="button"
            aria-pressed={view === 'delivery'}
            onClick={() => changeView('delivery')}
          >
            <Bell size={17} />
            Notification delivery
          </button>
        </div>
        <div className="admin-tab-filters">
          <AdminScopeField selection={selection} onChange={changeScope} />
          {view !== 'delivery' && (
            <>
              <Field label="Event type">
                <select
                  value={filters.action}
                  onChange={(e) => changeFilter('action', e.target.value)}
                >
                  <option value="">All event types</option>
                  {actionOptions.map((action) => (
                    <option value={action} key={action}>
                      {actionLabel(action)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Actor">
                <input
                  type="search"
                  value={filters.actor}
                  placeholder="Any actor"
                  onChange={(e) => changeFilter('actor', e.target.value)}
                />
              </Field>
            </>
          )}
          {view !== 'audit' && (
            <Field label="Delivery state">
              <select value={filters.state} onChange={(e) => changeFilter('state', e.target.value)}>
                <option value="">All states</option>
                {states.map((state) => (
                  <option value={state} key={state}>
                    {deliveryLabel[state] || state}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Start date">
            <DateInput
              type="date"
              value={filters.from}
              onChange={(e) => changeFilter('from', e.target.value)}
            />
          </Field>
          <Field label="End date" error={dateError}>
            <DateInput
              type="date"
              value={filters.to}
              onChange={(e) => changeFilter('to', e.target.value)}
            />
          </Field>
          <Field label="Search activity">
            <input
              type="search"
              placeholder="Search records"
              value={filters.search}
              onChange={(e) => changeFilter('search', e.target.value)}
            />
          </Field>
          <ResetAdminFilters
            onClick={() => {
              setFilters(initialFilters);
              setSearch({ actor: '', search: '' });
              selection.setScope(selection.country);
              changeScope();
            }}
          />
        </div>
        <small className="muted">Dates are inclusive. Times use Sri Lanka time (UTC+05:30).</small>
      </Card>
      <div className={`admin-tab-activity-grid ${view === 'overview' ? 'overview' : ''}`}>
        {view !== 'delivery' && (
          <Card className="admin-tab-stack">
            <div className="admin-tab-section-bar">
              <h2 id="audit-history">Audit history</h2>
              {audit.data && !dateError && (
                <small className="muted">
                  Showing{' '}
                  {view === 'overview'
                    ? Math.min(previewSize, audit.data.items.length)
                    : audit.data.items.length}{' '}
                  of {audit.data.total} events
                </small>
              )}
              {view === 'overview' && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setAuditPage(1);
                    changeView('audit');
                  }}
                >
                  View all events
                </Button>
              )}
            </div>
            {dateError ? (
              <p className="muted">Correct the date range to view results.</p>
            ) : audit.isPending ? (
              <Loading />
            ) : audit.error ? (
              <ErrorState error={audit.error} retry={() => void audit.refetch()} />
            ) : audit.data.items.length ? (
              <div>
                {audit.data.items
                  .slice(0, view === 'overview' ? previewSize : pageSize)
                  .map((event) => (
                    <article className="admin-tab-activity-row" key={event.id}>
                      <div>
                        <strong>{actionLabel(event.action)}</strong>
                        <small>
                          {event.actorName?.trim() ||
                            (event.actorId
                              ? `Account ${event.actorId.slice(0, 8)}`
                              : 'Unknown actor')}
                        </small>
                        <AdminTimestamp value={event.createdAt} />
                      </div>
                      <div>
                        <small>Affected entity</small>
                        <strong>{event.entityType || 'Not recorded'}</strong>
                        <small>{countryName(event.countryCode)}</small>
                      </div>
                      <div>
                        <p className="admin-tab-excerpt">
                          {event.detail?.trim() || 'No description recorded.'}
                        </p>
                        <details>
                          <summary>Event details</summary>
                          {event.entityId && <p>Entity ID: {event.entityId}</p>}
                          {event.detail?.trim() && <p>{event.detail}</p>}
                        </details>
                      </div>
                    </article>
                  ))}
              </div>
            ) : (
              <p className="muted">No audit events match these filters.</p>
            )}
            {view === 'audit' && audit.data && !dateError && (
              <AdminPagination
                label="Audit event pages"
                page={auditPage}
                size={pageSize}
                total={audit.data.total}
                setPage={setAuditPage}
              />
            )}
          </Card>
        )}
        {view !== 'audit' && (
          <Card className="admin-tab-stack">
            <div className="admin-tab-section-bar">
              <h2>Notification delivery</h2>
              {delivery.data && !dateError && (
                <small className="muted">
                  Showing{' '}
                  {view === 'overview'
                    ? Math.min(previewSize, delivery.data.items.length)
                    : delivery.data.items.length}{' '}
                  of {delivery.data.total} email records
                </small>
              )}
              {view === 'overview' && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDeliveryPage(1);
                    changeView('delivery');
                  }}
                >
                  View all deliveries
                </Button>
              )}
            </div>
            <small className="muted">
              Accepted means the email provider accepted the message. In-app stored means it was
              added to the recipient’s inbox.
            </small>
            {dateError ? (
              <p className="muted">Correct the date range to view results.</p>
            ) : delivery.isPending ? (
              <Loading />
            ) : delivery.error ? (
              <ErrorState error={delivery.error} retry={() => void delivery.refetch()} />
            ) : delivery.data.items.length ? (
              <div>
                {delivery.data.items
                  .slice(0, view === 'overview' ? previewSize : pageSize)
                  .map((item) => (
                    <article className="admin-tab-activity-row delivery" key={item.id}>
                      <div>
                        <span
                          className={`badge ${['Sent', 'Captured'].includes(item.state) ? 'green' : item.state === 'Failed' ? 'red' : item.state === 'Review' ? 'amber' : 'blue'}`}
                        >
                          {item.recovered ? 'Recovered' : deliveryLabel[item.state] || item.state}
                        </span>
                        {item.recovered && <small>Accepted by provider</small>}
                      </div>
                      <div>
                        <strong>{item.caseReference || 'Case reference unavailable'}</strong>
                        <small>
                          {item.provider ? `${item.provider} · Email` : 'Email'} ·{' '}
                          {item.recipientName || 'Recipient unavailable'}
                        </small>
                        <AdminTimestamp value={item.createdAt} />
                        <p className="admin-tab-excerpt">
                          {item.eventMessage || 'Message unavailable'}
                        </p>
                        <details>
                          <summary>Delivery details</summary>
                          <p>
                            {deliveryLabel[item.state] || item.state} · {item.attempts} attempt(s)
                          </p>
                          {item.inAppStored && <p>In-app notification stored.</p>}
                          <p>{item.eventMessage || 'Message unavailable'}</p>
                          <small>
                            Event message in English; the delivered language may differ.
                          </small>
                          {item.lastError && <p>{item.lastError}</p>}
                        </details>
                      </div>
                    </article>
                  ))}
              </div>
            ) : (
              <p className="muted">No delivery events match these filters.</p>
            )}
            {view === 'delivery' && delivery.data && !dateError && (
              <AdminPagination
                label="Notification delivery pages"
                page={deliveryPage}
                size={pageSize}
                total={delivery.data.total}
                setPage={setDeliveryPage}
              />
            )}
          </Card>
        )}
        <Card>
          <AdminPanelHeading icon={ChartNoAxesCombined} title="Delivery recovery" />
          <p className="muted">
            Email attempts for the selected country scope. Recovery requires evidence of provider
            acceptance.
          </p>
          {[
            ['Failed deliveries', d?.failed],
            ['Recovered deliveries', d?.recovered],
            ['In retry', d?.retrying],
          ].map(([label, value]) => (
            <div className="admin-tab-count" key={label}>
              <span>{label}</span>
              <strong>{value ?? '—'}</strong>
            </div>
          ))}
          {!!d?.causes.length && (
            <>
              <h3>Top failure causes</h3>
              {d.causes.map((cause) => (
                <div className="admin-tab-meter" key={cause.reason ?? ''}>
                  <div>
                    <strong>{cause.reason || 'Reason not recorded'}</strong>
                    <span>{cause.count}</span>
                  </div>
                  <progress
                    value={cause.count}
                    max={d.failed}
                    aria-label={cause.reason || 'Reason not recorded'}
                  />
                </div>
              ))}
            </>
          )}
          {view !== 'delivery' && (
            <Button variant="secondary" type="button" onClick={() => changeView('delivery')}>
              View delivery report
            </Button>
          )}
        </Card>
      </div>
      {view === 'delivery' && (
        <DeliveryRecovery
          key={`${selection.scope}:${focusId ?? ''}`}
          countryCode={selection.scope}
          focusId={focusId}
        />
      )}
    </div>
  );
}
