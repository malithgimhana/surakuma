import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Ban, ChevronDown, CirclePause, CirclePlay, Mail, Trash2, UserMinus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api, errorMessage, get } from './api';
import { useOptionalAuth } from './auth';
import { useCountry } from './geography';
import { Button, Card, ErrorState, Field, Loading, PageHeader, formatDate } from './components';

function useAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ path, data, method }: { path: string; data?: unknown; method?: 'delete' }) =>
      method === 'delete' ? api.delete(path, { data }) : api.post(path, data),
    onSuccess: () => client.invalidateQueries(),
  });
}
function Outcome({ action }: { action: ReturnType<typeof useAction> }) {
  return (
    <>
      {action.error && <ErrorState error={action.error} />}
      {action.isSuccess && <p role="status">Change recorded.</p>}
    </>
  );
}
interface StaffRoleGrant {
  id: string;
  role: string;
  organisationId?: string | null;
  countryCode?: string;
  suspended?: boolean;
}

interface AccountAction {
  label: string;
  path: string;
  icon: LucideIcon;
  kind: 'reset' | 'status' | 'revoke' | 'delete';
  active?: boolean;
  scope?: string;
  disabled?: boolean;
}

export function StaffLifecycle({
  user,
  global,
  organisations = [],
}: {
  user: { id: string; name?: string; email?: string; disabled?: boolean; isSystemAdministrator?: boolean; memberships: StaffRoleGrant[] };
  global: boolean;
  organisations?: { id: string; name: string }[];
}) {
  const action = useAction();
  const country = useCountry();
  const isOwnAccount = useOptionalAuth()?.user?.id === user.id;
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<AccountAction | null>(null);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const staffGrants = user.memberships.filter(
    (grant) => grant.role !== 'Citizen' && (global || !['Administrator', 'CountryAdministrator'].includes(grant.role)),
  );
  const canChangeAccount = global && !isOwnAccount;
  const accountPath = `/admin/users/${user.id}`;
  const staffPath = `${accountPath}/staff-status?countryCode=${country}`;
  const accountActions: AccountAction[] = [
    {
      label: 'Send password reset email',
      path: `${accountPath}/password-reset`,
      icon: Mail,
      kind: 'reset',
      disabled: user.disabled,
    },
  ];
  if (!isOwnAccount && staffGrants.some((grant) => !grant.suspended)) {
    accountActions.push({ label: 'Suspend staff access', path: staffPath, icon: CirclePause, kind: 'status', active: false });
  }
  if (!isOwnAccount && staffGrants.some((grant) => grant.suspended)) {
    accountActions.push({ label: 'Reactivate staff access', path: staffPath, icon: CirclePlay, kind: 'status', active: true });
  }
  if (canChangeAccount) {
    accountActions.push({
      label: user.disabled ? 'Reactivate account' : 'Disable whole account',
      path: `${accountPath}/account-status`,
      icon: user.disabled ? CirclePlay : Ban,
      kind: 'status',
      active: !!user.disabled,
    });
  }
  const roleActions: AccountAction[] = isOwnAccount ? [] : staffGrants.map((grant) => {
    const role = grant.role.replace(/([a-z])([A-Z])/g, '$1 $2');
    const organisation = grant.organisationId ? organisations.find((item) => item.id === grant.organisationId)?.name || 'Organisation unavailable' : '';
    return {
      label: `Revoke ${role}`,
      path: `/admin/memberships/${grant.id}`,
      icon: UserMinus,
      kind: 'revoke',
      scope: [organisation, grant.countryCode].filter(Boolean).join(' · '),
    };
  });
  if (canChangeAccount && user.isSystemAdministrator) {
    roleActions.unshift({ label: 'Revoke System Administrator', path: `${accountPath}/system-administrator`, icon: UserMinus, kind: 'revoke', scope: 'All countries' });
  }
  const deleteAction: AccountAction = { label: 'Delete account', path: accountPath, icon: Trash2, kind: 'delete' };

  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    const anchor = trigger.current;
    const popup = panel.current;
    const margin = 12;

    function position() {
      const bounds = anchor.getBoundingClientRect();
      const below = bounds.bottom + 4;
      const above = bounds.top - popup.offsetHeight - 4;
      const maxTop = window.innerHeight - popup.offsetHeight - margin;
      const top = below > maxTop && above >= margin ? above : Math.min(below, maxTop);
      const left = Math.min(bounds.right - 16, window.innerWidth - popup.offsetWidth - margin);
      popup.style.top = `${Math.max(margin, top)}px`;
      popup.style.left = `${Math.max(margin, left)}px`;
    }

    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !popup.contains(event.target) && !anchor.contains(event.target)) {
        setOpen(false);
      }
    }

    position();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
    observer?.observe(popup);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    document.addEventListener('pointerdown', dismissOutside);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      document.removeEventListener('pointerdown', dismissOutside);
    };
  }, [open]);

  useEffect(() => {
    if (open) (panel.current?.querySelector<HTMLElement>('input, button:not(:disabled)') ?? panel.current)?.focus();
  }, [open, selected]);

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }

  function start(item: AccountAction) {
    action.reset();
    if (item.kind === 'reset') {
      action.mutate({ path: item.path });
      return;
    }
    setReason('');
    setConfirmation('');
    setSelected(item);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || action.isPending) return;
    if (selected.kind === 'revoke') {
      action.mutate({ path: selected.path, method: 'delete' }, { onSuccess: () => setSelected(null) });
    } else if (selected.kind === 'delete' && reason.trim() && confirmation === 'DELETE') {
      action.mutate({ path: selected.path, method: 'delete', data: { confirmation, reason: reason.trim() } });
    } else if (selected.kind === 'status' && reason.trim()) {
      action.mutate({ path: selected.path, data: { active: selected.active, reason: reason.trim() } }, {
        onSuccess: () => setSelected(null),
      });
    }
  }

  function renderItem(item: AccountAction, showScope = false) {
    const Icon = item.icon;
    return (
      <button
        key={item.path + item.label}
        type="button"
        className={`account-action-item${item.kind === 'revoke' || item.kind === 'delete' ? ' destructive' : ''}`}
        onClick={() => start(item)}
        disabled={item.disabled || action.isPending}
      >
        <Icon size={16} aria-hidden="true" />
        <span>{item.label}{showScope && <small>{item.scope}</small>}</span>
      </button>
    );
  }

  const needsReason = selected?.kind === 'status' || selected?.kind === 'delete';
  const deleting = selected?.kind === 'delete';
  const target = user.name || user.email || 'this account';

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="account-actions-trigger"
        aria-label={user.name ? `Actions for ${user.name}` : 'Account actions'}
        aria-expanded={open}
        aria-controls={panelId}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault();
            close();
          }
        }}
        onClick={() => {
          if (open) return close();
          if (!action.isPending) {
            setSelected(null);
            action.reset();
          }
          setOpen(true);
        }}
      >
        Actions <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={panel}
          id={panelId}
          className="account-actions-panel"
          role="group"
          aria-label={`Account actions for ${target}`}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            } else if (event.key === 'Tab') {
              const controls = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
              const edge = event.shiftKey ? controls[0] : controls[controls.length - 1];
              if (!edge || document.activeElement === edge) {
                if (event.shiftKey) event.preventDefault();
                close();
              }
            }
          }}
        >
          {selected ? (
            <form className="account-action-confirm" onSubmit={submit}>
              <strong>{selected.label}</strong>
              <p className="muted">
                {deleting
                  ? `Permanently delete ${target} and its sign-in access? This cannot be undone. Accounts linked to assistance or volunteer records are protected.`
                  : selected.kind === 'revoke'
                    ? `Remove this role from ${target}? ${selected.scope}`
                    : `Apply this change to ${target}?`}
              </p>
              {needsReason && (
                <Field label="Reason">
                  <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} disabled={action.isPending} required />
                </Field>
              )}
              {deleting && (
                <Field label="Type DELETE to confirm">
                  <input autoComplete="off" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={action.isPending} required />
                </Field>
              )}
              <div className="account-action-buttons">
                <Button type="button" variant="secondary" disabled={action.isPending} onClick={() => { action.reset(); setSelected(null); }}>
                  {deleting ? 'Cancel deletion' : 'Cancel'}
                </Button>
                <Button type="submit" variant={selected.kind === 'status' && selected.active ? 'primary' : 'danger'} busy={action.isPending}
                  disabled={(needsReason && !reason.trim()) || (deleting && confirmation !== 'DELETE')}>
                  {deleting ? 'Permanently delete account' : selected.kind === 'revoke' ? 'Confirm revoke' : 'Apply change'}
                </Button>
              </div>
            </form>
          ) : (
            <>
              {accountActions.map((item) => renderItem(item))}
              {user.disabled && <p className="account-action-note">Reactivate this disabled account before sending a password reset email.</p>}
              {isOwnAccount && <p className="account-action-note">Ask another administrator to change your access.</p>}
              {roleActions.length > 0 && (
                <div className="account-action-section">
                  <p>Role access</p>
                  {roleActions.map((item) => renderItem(item, roleActions.length > 1))}
                </div>
              )}
              {canChangeAccount && <div className="account-action-section">{renderItem(deleteAction)}</div>}
            </>
          )}
          {action.error && <p className="account-action-note field-error" role="alert">{errorMessage(action.error)}</p>}
          {action.isSuccess && <p className="account-action-note" role="status">Change recorded.</p>}
        </div>,
        document.body,
      )}
    </>
  );
}
export interface Verification {
  verificationState: string;
  evidence: string;
  decisionReason: string;
  reviewedAt?: string;
}
export function PartnerVerification({
  id,
  verification,
  global,
}: {
  id: string;
  verification?: Verification;
  global: boolean;
}) {
  const country = useCountry(),
    action = useAction();
  const [evidence, setEvidence] = useState(verification?.evidence || ''),
    [reason, setReason] = useState('');
  const submit = (decision: string | null) =>
    action.mutate({
      path: `/admin/organisations/${id}/countries/${country}/verification`,
      data: { evidence, reason, decision },
    }, { onSuccess: () => { if (decision) setReason(''); } });
  const canDecide = !!reason.trim() && !!evidence.trim() && !action.isPending;

  return (
    <div className="stack partner-verification">
      {(verification?.decisionReason || verification?.reviewedAt) && (
        <div className="partner-review-history">
          {verification?.reviewedAt && <small className="muted">Reviewed {formatDate(verification.reviewedAt)}</small>}
          {verification?.decisionReason && <p><strong>Recorded decision reason</strong><br />{verification.decisionReason}</p>}
        </div>
      )}
      <Field label="Evidence and HTTPS source references">
        <textarea
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          maxLength={4000}
          disabled={action.isPending}
        />
      </Field>
      <div>
        <Button type="button" variant="ghost" disabled={action.isPending} onClick={() => submit(null)}>
          Save evidence
        </Button>
      </div>
      {global && (
        <div className="stack partner-verification-decision">
          <Field label="Decision reason" hint="Add evidence and a reason to make a decision.">
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} disabled={action.isPending} />
          </Field>
          <div className="organisation-dialog-actions">
            <Button type="button" disabled={!canDecide} onClick={() => submit('Verified')}>Verify partner</Button>
            <Button type="button" variant="danger" disabled={!canDecide} onClick={() => submit('Rejected')}>Reject verification</Button>
          </div>
        </div>
      )}
      <Outcome action={action} />
    </div>
  );
}
interface ReportRow {
  countryCode: string;
  country: string;
  activeCrises: number;
  open: number;
  unassigned: number;
  overdue: number;
  resolved: number;
}
function ResponseSnapshot({ row }: { row?: ReportRow }) {
  if (!row) return <p className="muted">No response figures are available for the selected country.</p>;

  const metrics = [
    { label: 'Active crises', count: row.activeCrises, to: '/admin/crises', action: 'View crisis operations', flagNonzero: true },
    { label: 'Open cases', count: row.open },
    { label: 'Unassigned cases', count: row.unassigned, to: '/admin?section=cases', action: 'Review requests', flagNonzero: true },
    { label: 'Overdue cases', count: row.overdue },
    { label: 'Resolved cases', count: row.resolved },
  ];

  return (
    <ul className="admin-snapshot-metrics" aria-label="Response figures">
      {metrics.map(({ label, count, to, action, flagNonzero }) => {
        const attention = flagNonzero && count > 0;
        const contents = (
          <>
            <span>{label}</span>
            <strong>
              {count}
              {attention && (
                <>
                  <AlertCircle size={18} aria-hidden="true" />
                  <span className="sr-only">Needs attention</span>
                </>
              )}
            </strong>
          </>
        );
        return (
          <li key={label}>
            {to ? (
              <Link to={to} className={attention ? 'admin-snapshot-metric needs-attention' : 'admin-snapshot-metric'}>
                {contents}
                <small>{action} <span aria-hidden="true">→</span></small>
              </Link>
            ) : (
              <div className="admin-snapshot-metric">{contents}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function AdministrationOverview() {
  const country = useCountry();
  const [selectedCrisis, setSelectedCrisis] = useState({ country, id: '' });
  const crisisId = selectedCrisis.country === country ? selectedCrisis.id : '';
  const params = new URLSearchParams({ scope: 'country', countryCode: country });
  if (crisisId) params.set('crisisId', crisisId);
  const query = useQuery({
    queryKey: ['admin-report', params.toString()],
    queryFn: () => get<{ countries: ReportRow[] }>(`/admin/reports?${params}`),
  });
  const crises = useQuery({
    queryKey: ['report-crises', country],
    queryFn: () => get<{ id: string; name: string }[]>(`/crises?countryCode=${country}`),
  });

  return (
    <Card>
      <h2>Humanitarian response overview</h2>
      <div className="form-grid">
        <Field label="Crisis">
          <select value={crisisId} onChange={(event) => setSelectedCrisis({ country, id: event.target.value })}>
            <option value="">All crises</option>
            {crises.data?.map((crisis) => <option key={crisis.id} value={crisis.id}>{crisis.name}</option>)}
          </select>
        </Field>
      </div>
      {query.isPending ? <Loading /> : query.error ? <ErrorState error={query.error} /> : (
        <ResponseSnapshot row={query.data?.countries?.find(row => row.countryCode === country)} />
      )}
    </Card>
  );
}

interface Proposal {
  id: string;
  state: string;
  requesterUserId: string;
  requesterName?: string;
  reviewerName?: string;
  targetName?: string;
  reason: string;
  decisionReason: string;
  createdAt: string;
  expiresAt: string;
}
function ProposalCard({ p, userId }: { p: Proposal; userId?: string }) {
  const action = useAction(),
    [reason, setReason] = useState('');
  return (
    <Card>
      <h3>{p.targetName || 'System Administrator access request'}</h3>
      <p>
        {p.state} · Requested {formatDate(p.createdAt)}
      </p>
      <p>{p.reason}</p>
      <small>
        Requester: {p.requesterName || p.requesterUserId} · Expires {formatDate(p.expiresAt)}
      </small>
      {p.reviewerName && <p>Reviewed by {p.reviewerName}</p>}
      {p.decisionReason && <p>{p.decisionReason}</p>}
      {p.state === 'Pending' && (
        <>
          <Field label="Decision reason">
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
          </Field>
          {(p.requesterUserId === userId ? ['Cancel'] : ['Approve', 'Reject']).map(
            (label) => (
              <Button
                key={label}
                type="button"
                disabled={!reason || action.isPending}
                onClick={() =>
                  action.mutate({
                    path: `/admin/approvals/${p.id}/decision`,
                    data: { action: label, reason },
                  })
                }
              >
                {label}
              </Button>
            ),
          )}
        </>
      )}
      <Outcome action={action} />
    </Card>
  );
}
export function SystemAdministratorRequests() {
  const auth = useOptionalAuth();
  const q = useQuery({
    queryKey: ['approvals'],
    queryFn: () =>
      get<{ items: Proposal[]; activeGlobalAdministrators: number }>('/admin/approvals?countryCode='),
  });
  return (
    <section className="stack" aria-labelledby="system-administrator-requests">
      <h2 id="system-administrator-requests">System Administrator access requests</h2>
      <p className="muted">A different System Administrator must approve grants of access across all countries.</p>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : (
        <>
          {(q.data?.activeGlobalAdministrators ?? 2) < 2 && (
            <Card>
              <p>
                A second active System Administrator is required to review these requests.
              </p>
            </Card>
          )}
          {!q.data?.items?.length && <Card>No access requests yet.</Card>}
          {q.data?.items?.map((p) => (
            <ProposalCard
              key={p.id}
              p={p}
              userId={auth?.user?.id}
            />
          ))}
        </>
      )}
    </section>
  );
}
interface Alert {
  id: string;
  message: string;
  countryCode?: string;
  link: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  createdAt: string;
}
export function AdministratorAlerts() {
  const country = useCountry();
  const q = useQuery({
      queryKey: ['admin-alerts-bell', country],
      queryFn: () => get<Alert[]>(`/admin/alerts?countryCode=${country}`),
      refetchInterval: 60000,
    }),
    action = useAction();
  return (
    <>
      <PageHeader
        title="Administrator alerts"
        description="Follow up on assignment delays, delivery failures and access issues."
      />
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : !q.data?.length ? (
        <Card>No administrator alerts.</Card>
      ) : (
        q.data.map((a) => (
          <Card key={a.id}>
            <h3>{a.message}</h3>
            <p>
              {a.resolvedAt
                ? 'Resolved'
                : a.acknowledgedAt
                  ? 'Acknowledged — still active'
                  : 'Needs attention'}{' '}
              · {a.countryCode || 'Global'} · {formatDate(a.createdAt)}
            </p>
            <Link to={a.link}>Review issue</Link>
            {!a.acknowledgedAt && !a.resolvedAt && (
              <Button
                type="button"
                disabled={action.isPending}
                onClick={() => action.mutate({ path: `/admin/alerts/${a.id}/acknowledge` })}
              >
                Acknowledge
              </Button>
            )}
          </Card>
        ))
      )}
      <Outcome action={action} />
    </>
  );
}
interface Delivery {
  id: string;
  message: string;
  state: string;
  attempts: number;
  createdAt: string;
  lastError?: string;
  providerReference?: string;
  history: { id: string; number: number; state: string; error?: string; createdAt: string }[];
}
function DeliveryCard({ d }: { d: Delivery }) {
  const action = useAction(),
    [reason, setReason] = useState(''),
    [reference, setReference] = useState(''),
    [checked, setChecked] = useState(false);
  return (
    <Card>
      <h3>
        {d.state} · {d.attempts} attempts
      </h3>
      {d.createdAt && <p className="muted">Created <time dateTime={d.createdAt}>{formatDate(d.createdAt)}</time></p>}
      <p>{d.message}</p>
      <p>{d.lastError}</p>
      <small>{d.providerReference}</small>
      {d.history.length > 0 && (
        <details>
          <summary>Attempt history</summary>
          {d.history.map((h) => (
            <p key={h.id}>
              {h.number} · {h.state} · {formatDate(h.createdAt)} · {h.error}
            </p>
          ))}
        </details>
      )}
      {['Failed', 'Review'].includes(d.state) && (
        <div className="stack">
          <Field label="Reason and provider check">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
          </Field>
          {d.state === 'Review' && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />{' '}
                I checked with the provider and confirmed non-delivery
              </label>
              <Field label="Provider acceptance reference">
                <input value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
              <Button
                type="button"
                disabled={!reason || !reference || action.isPending}
                onClick={() =>
                  action.mutate({
                    path: `/admin/delivery-management/${d.id}`,
                    data: {
                      action: 'Accepted',
                      reason,
                      providerReference: reference,
                      confirmedNotDelivered: false,
                    },
                  })
                }
              >
                Record provider acceptance
              </Button>
            </>
          )}
          <Button
            type="button"
            disabled={!reason || (d.state === 'Review' && !checked) || action.isPending}
            onClick={() =>
              action.mutate({
                path: `/admin/delivery-management/${d.id}`,
                data: { action: 'Retry', reason, confirmedNotDelivered: checked },
              })
            }
          >
            Retry delivery
          </Button>
        </div>
      )}
      <Outcome action={action} />
    </Card>
  );
}
export function DeliveryRecovery() {
  const [filters, setFilters] = useState({ state: 'Failed', startDate: '', endDate: '' });
  const [appliedFilters, setAppliedFilters] = useState<typeof filters | null>(null);
  const [page, setPage] = useState(1);
  const { state, startDate, endDate } = filters;
  const country = useCountry();
  const dateGroupId = useId();
  const lastSupportedDate = '9999-12-31';
  const startError = startDate.length > 10 ? 'Enter a year with four digits.' : undefined;
  let endError: string | undefined;
  if (endDate.length > 10) endError = 'Enter a year with four digits.';
  else if (!startError && startDate && endDate && startDate > endDate) {
    endError = 'Choose an end date on or after the start date.';
  }
  const validDates = !startError && !endError;
  const params = new URLSearchParams({
    countryCode: country,
    state: appliedFilters?.state ?? '',
    page: String(page),
  });
  const sriLankaMidnight = 'T00:00:00+05:30';
  if (appliedFilters?.startDate && appliedFilters.startDate !== '0001-01-01') {
    params.set('from', new Date(appliedFilters.startDate + sriLankaMidnight).toISOString());
  }
  if (appliedFilters?.endDate) {
    const nextDay = new Date(appliedFilters.endDate + sriLankaMidnight);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    params.set('to', nextDay.toISOString());
  }
  const q = useQuery({
    queryKey: ['delivery-management', params.toString()],
    queryFn: () => get<{ items: Delivery[]; total: number }>(`/admin/delivery-management?${params}`),
    enabled: appliedFilters !== null,
  });

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validDates) return;
    if (
      appliedFilters && page === 1 && state === appliedFilters.state &&
      startDate === appliedFilters.startDate && endDate === appliedFilters.endDate
    ) {
      void q.refetch();
      return;
    }
    setAppliedFilters(filters);
    setPage(1);
  }

  function clearDates() {
    setFilters({ ...filters, startDate: '', endDate: '' });
    setAppliedFilters(null);
    setPage(1);
  }

  return (
    <section className="delivery-recovery" aria-labelledby={`${dateGroupId}-heading`}>
      <header className="delivery-recovery-heading">
        <h2 id={`${dateGroupId}-heading`}>Delivery recovery</h2>
        <p>Sent means the provider accepted the message. Verify uncertain outcomes before retrying.</p>
      </header>
      <Card className="delivery-filter-card">
        <form className="delivery-filters" onSubmit={search}>
          <div className="delivery-state-filter">
            <Field label="Delivery state">
              <select value={state} onChange={(e) => setFilters({ ...filters, state: e.target.value })}>
                {['Failed', 'Review', 'Pending', 'Retry', 'Sent', 'Captured'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>
          <div
            className="delivery-date-filter"
            role="group"
            aria-labelledby={dateGroupId}
            aria-describedby={`${dateGroupId}-hint`}
          >
            <div className="delivery-date-heading">
              <strong id={dateGroupId}>Date created</strong>
              <Button
                variant="ghost"
                type="button"
                disabled={!startDate && !endDate && !appliedFilters}
                onClick={clearDates}
              >
                Clear dates
              </Button>
            </div>
            <div className="delivery-date-inputs">
              <Field label="Start date" error={startError}>
                <input
                  type="date"
                  value={startDate}
                  max={endDate.length === 10 ? endDate : lastSupportedDate}
                  onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                />
              </Field>
              <Field label="End date" error={endError}>
                <input
                  type="date"
                  value={endDate}
                  min={startDate.length === 10 ? startDate : undefined}
                  max={lastSupportedDate}
                  onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                />
              </Field>
            </div>
            <p id={`${dateGroupId}-hint`}>Both dates are included (Sri Lanka time).</p>
          </div>
          <div className="delivery-search-action">
            <Button type="submit" disabled={!validDates}>
              Search
            </Button>
            <output className="delivery-search-count">
              {appliedFilters && q.isSuccess && `${q.data.total} ${q.data.total === 1 ? 'result' : 'results'}`}
            </output>
          </div>
        </form>
      </Card>
      {appliedFilters && (
        <>
          {q.isPending ? (
            <Loading />
          ) : q.error ? (
            <ErrorState error={q.error} />
          ) : (
            q.data?.items?.map((d) => <DeliveryCard key={d.id} d={d} />)
          )}
          {(page > 1 || (q.data?.total ?? 0) > 20) && (
            <nav className="admin-pagination" aria-label="Delivery pages">
              <Button variant="secondary" type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span>Page {page}</span>
              <Button
                variant="secondary"
                type="button"
                disabled={page * 20 >= (q.data?.total ?? 0)}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
