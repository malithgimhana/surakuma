import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, FileText, Info, Megaphone } from 'lucide-react';
import { errorMessage, get } from './api';
import { Badge, Button, Card, ErrorState, Field, Loading } from './components';
import { WorkspaceDialog } from './OrganisationDialog';
import {
  countryPath,
  dashboardRefreshInterval,
  useCrisisOperationsWrite,
  useOperationalAreas,
} from './crisisOperationsApi';
import type { Country } from './geography';
import type { Alert, Crisis } from './types';

const severities = ['Information', 'Advisory', 'Warning', 'Critical'];
const statuses = ['All', 'Draft', 'PendingReview', 'Approved', 'Returned', 'Published', 'EmergencyPublished', 'EmergencyReview', 'Expired', 'Withdrawn'] as const;
type AlertStatus = Exclude<(typeof statuses)[number], 'All'>;
const statusLabel = (status: string) => ({ PendingReview: 'Pending review', EmergencyPublished: 'Emergency published', EmergencyReview: 'Emergency review' } as Record<string, string>)[status] ?? status;
type Translation = { title: string; message: string };
const emptyTranslation: Translation = { title: '', message: '' };
const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
const languageLabels: Record<string, [string, string]> = {
  si: ['සිංහල මාතෘකාව', 'සිංහල උපදෙස්'],
  ta: ['தமிழ் தலைப்பு', 'தமிழ் அறிவுறுத்தல்கள்'],
};

export function requiredAlertLanguages(policy: Country) {
  return [
    ...new Set([
      'en',
      ...policy.requiredAlertLanguages
        .split(',')
        .map((code) => code.trim())
        .filter(Boolean),
    ]),
  ];
}

export interface AlertDraft {
  crisisId: string;
  severity: string;
  area: string;
  authority: string;
  expiresAt: string;
  translations: Record<string, Translation>;
}

export const emptyAlertDraft: AlertDraft = {
  crisisId: '',
  severity: 'Information',
  area: '',
  authority: '',
  expiresAt: '',
  translations: {},
};

type AlertPreview = AlertDraft & { crisisName: string };

export function CrisisAlertComposer({
  country,
  policy,
  crises,
  draft,
  setDraft,
  loading,
  failed,
  editingId,
  onSaved,
}: {
  country: string;
  policy?: Country;
  crises: Crisis[];
  draft: AlertDraft;
  setDraft: (draft: AlertDraft) => void;
  loading: boolean;
  failed: boolean;
  editingId?: string;
  onSaved?: () => void;
}) {
  const selected = draft.crisisId
    ? crises.find((crisis) => crisis.id === draft.crisisId)
    : crises[0];
  const areas = useOperationalAreas(country, selected?.id);
  const areaOptions = [
    ...new Set(
      [selected?.district, ...(areas.data?.map((area) => area.name) ?? [])].filter(Boolean),
    ),
  ];
  const listId = useId();
  const [preview, setPreview] = useState<AlertPreview>();
  const [reviewed, setReviewed] = useState(false);
  const [validation, setValidation] = useState('');
  const [published, setPublished] = useState(false);
  const write = useCrisisOperationsWrite(country);
  const required = policy ? requiredAlertLanguages(policy) : [];
  const optional = policy
    ? [...new Set(policy.languages.split(',').map((code) => code.trim()))].filter(
        (code) => code && !required.includes(code),
      )
    : [];
  const disabled = !policy || !crises.length || loading || failed;

  function setField<K extends keyof AlertDraft>(key: K, value: AlertDraft[K]) {
    setDraft({ ...draft, crisisId: selected?.id ?? draft.crisisId, [key]: value });
    setValidation('');
    setPublished(false);
  }

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || disabled) return;
    const translations: Record<string, Translation> = {};
    for (const code of [...required, ...optional]) {
      const text = draft.translations[code] ?? emptyTranslation;
      const title = text.title.trim(),
        message = text.message.trim();
      if ((required.includes(code) || title || message) && (!title || !message)) {
        setValidation(`Provide a title and instructions in ${languageNames.of(code)}.`);
        return;
      }
      if (title && message) translations[code] = { title, message };
    }
    if (!draft.area.trim() || !draft.authority.trim() || !severities.includes(draft.severity)) {
      setValidation('Enter an affected area, issuing authority and valid severity.');
      return;
    }
    if (!(new Date(draft.expiresAt).getTime() > Date.now())) {
      setValidation('Choose a future expiry date and time.');
      return;
    }
    write.reset();
    setReviewed(false);
    setPreview({
      ...draft,
      area: draft.area.trim(),
      authority: draft.authority.trim(),
      crisisId: selected.id,
      crisisName: selected.name,
      translations,
    });
  }

  function saveDraft() {
    if (!preview || !reviewed || write.isPending) return;
    const {
      translations: { en, si, ta, ...other },
      crisisId,
      area,
      authority,
      severity,
      expiresAt,
    } = preview;
    write.mutate(
      {
        path: editingId ? `/alerts/${editingId}` : '/alerts',
        method: editingId ? 'put' : 'post',
        data: {
          crisisId,
          area,
          authority,
          severity,
          expiresAt: new Date(expiresAt).toISOString(),
          title: en.title,
          message: en.message,
          sinhalaTitle: si?.title ?? '',
          sinhalaMessage: si?.message ?? '',
          tamilTitle: ta?.title ?? '',
          tamilMessage: ta?.message ?? '',
          translationsJson: JSON.stringify(other),
        },
      },
      {
        onSuccess: () => {
          setPreview(undefined);
          setDraft(emptyAlertDraft);
          setPublished(true);
          onSaved?.();
        },
      },
    );
  }

  function translationFields(code: string, required: boolean) {
    const value = draft.translations[code] ?? emptyTranslation;
    const name = languageNames.of(code);
    const [titleLabel, messageLabel] = languageLabels[code] ?? [
      `${name} title`,
      `${name} instructions`,
    ];
    const update = (key: keyof Translation, text: string) =>
      setField('translations', { ...draft.translations, [code]: { ...value, [key]: text } });
    return (
      <div className="crisis-form-pair" key={code}>
        <Field label={titleLabel}>
          <input
            lang={code}
            disabled={disabled}
            required={required}
            value={value.title}
            maxLength={150}
            onChange={(event) => update('title', event.target.value)}
          />
        </Field>
        <Field label={messageLabel}>
          <textarea
            lang={code}
            disabled={disabled}
            required={required}
            value={value.message}
            maxLength={2000}
            onChange={(event) => update('message', event.target.value)}
            rows={1}
          />
        </Field>
      </div>
    );
  }

  return (
    <Card className="crisis-composer">
      <h2 className="crisis-panel-heading">
        <Megaphone aria-hidden="true" />
        {editingId ? 'Edit public alert draft' : 'Public alert composer'}
      </h2>
      {published && (
        <p className="success-text" role="status">
          Draft saved. Open the alert history to submit it for review.
        </p>
      )}
      {disabled && (
        <p className="muted" role="status">
          {failed
            ? 'Alert composition is unavailable. Retry loading the country data.'
            : loading
              ? 'Loading crises and alert requirements…'
              : 'Create or reopen a crisis to prepare an alert.'}
        </p>
      )}
      <form className="crisis-composer-form" onSubmit={prepare}>
        <div className="crisis-form-pair">
          <Field label="Crisis">
            <select
              required
              disabled={disabled || !!editingId}
              value={selected?.id ?? ''}
              onChange={(event) => {
                setDraft({ ...draft, crisisId: event.target.value, area: '' });
                setValidation('');
                setPublished(false);
              }}
            >
              {!selected && <option value="">Select an active crisis</option>}
              {crises.map((crisis) => (
                <option key={crisis.id} value={crisis.id}>
                  {crisis.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Severity">
            <select
              required
              disabled={disabled}
              value={draft.severity}
              onChange={(event) => setField('severity', event.target.value)}
            >
              {severities.map((severity) => (
                <option key={severity}>{severity}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="crisis-form-pair">
          <Field label="Affected area">
            <input
              required
              disabled={disabled}
              list={listId}
              value={draft.area}
              maxLength={150}
              onChange={(event) => setField('area', event.target.value)}
            />
          </Field>
          <datalist id={listId}>
            {areaOptions.map((area) => (
              <option key={area} value={area} />
            ))}
          </datalist>
          <Field label="Issuing authority">
            <input
              required
              disabled={disabled}
              value={draft.authority}
              maxLength={150}
              onChange={(event) => setField('authority', event.target.value)}
            />
          </Field>
        </div>
        {(required.length ? required : ['en']).map((code) => translationFields(code, true))}
        {optional.length > 0 && (
          <details className="crisis-optional-translations">
            <summary>
              Optional translations ({optional.map((code) => languageNames.of(code)).join(', ')})
            </summary>
            {optional.map((code) => translationFields(code, false))}
          </details>
        )}
        <div className="crisis-form-pair crisis-expiry">
          <Field label="Expires at">
            <input
              type="datetime-local"
              required
              disabled={disabled}
              value={draft.expiresAt}
              onInput={(event) => setField('expiresAt', event.currentTarget.value)}
            />
          </Field>
          <p className="crisis-form-note muted">
            <Info size={16} aria-hidden="true" />
            Review translations in the preview before saving. Expiry uses your device’s local
            time.
          </p>
        </div>
        {validation && (
          <p className="field-error" role="alert">
            {validation}
          </p>
        )}
        <Button disabled={disabled || !selected}>Preview alert draft</Button>
      </form>
      {preview && (
        <WorkspaceDialog
          title="Preview public alert"
          context={`${policy?.name ?? country} · ${preview.crisisName}`}
          className="crisis-dialog"
          busy={write.isPending}
          onDismiss={() => setPreview(undefined)}
        >
          <AlertContent alert={preview} translations={preview.translations} />
          <label className="checkbox-label crisis-review-check">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            I reviewed the public wording and translations.
          </label>
          {write.error && (
            <p className="field-error" role="alert">
              {errorMessage(write.error)}
            </p>
          )}
          <div className="organisation-dialog-actions">
            <Button
              variant="secondary"
              disabled={write.isPending}
              onClick={() => setPreview(undefined)}
            >
              Back to edit
            </Button>
            <Button busy={write.isPending} disabled={!reviewed} onClick={saveDraft}>
              Save draft
            </Button>
          </div>
        </WorkspaceDialog>
      )}
    </Card>
  );
}

interface AlertHistoryRow {
  alert: Alert;
  status: AlertStatus;
  isAuthor?: boolean;
  canReview?: boolean;
  needsEmergencyReview?: boolean;
}
interface AlertHistoryPage {
  publishedCount: number;
  total: number;
  page: number;
  items: AlertHistoryRow[];
  reviewer?: boolean;
}
const initialFilters = { search: '', severity: '', status: 'All', crisisId: '' };
const recentFilters = { ...initialFilters, status: 'Published' };

export function useCrisisAlertHistory(country: string, staff = false) {
  const [expanded, setExpanded] = useState(false);
  const [filters, setFilters] = useState(initialFilters);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(filters.search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [filters.search]);
  const pageSize = expanded ? 10 : 4;
  const request = expanded ? { ...filters, search } : recentFilters;
  const query = useQuery({
    queryKey: ['crisis-operations', country, 'alerts', staff, request, page, pageSize],
    queryFn: () =>
      get<AlertHistoryPage>(
        countryPath(staff ? '/staff/alert-workflow' : '/admin/crisis-operations/alerts', country, {
          ...request,
          page: String(page),
          pageSize: String(pageSize),
        }),
      ),
    placeholderData: keepPreviousData,
    refetchInterval: dashboardRefreshInterval,
  });
  return {
    query,
    filters,
    expanded,
    pageSize,
    setPage,
    searching: expanded && search !== filters.search.trim(),
    updateFilter: (name: keyof typeof filters, value: string) => {
      setFilters({ ...filters, [name]: value });
      setPage(1);
    },
    showReview: () => {
      setExpanded(true);
      setFilters({ ...initialFilters, status: 'PendingReview' });
      setPage(1);
    },
    toggleExpanded: () => {
      setExpanded(!expanded);
      setPage(1);
    },
  };
}

function savedTranslations(alert: Alert): Record<string, Translation> {
  let other: Record<string, Translation> = {};
  try {
    other = JSON.parse(alert.translationsJson ?? '{}') ?? {};
  } catch {
    /* Legacy alerts may lack translations. */
  }
  const translations = {
    en: { title: alert.title, message: alert.message },
    si: { title: alert.sinhalaTitle, message: alert.sinhalaMessage },
    ta: { title: alert.tamilTitle, message: alert.tamilMessage },
    ...Object.fromEntries(
      Object.entries(other).filter(([code]) => !['en', 'si', 'ta'].includes(code)),
    ),
  };
  return Object.fromEntries(
    Object.entries(translations).filter(([, text]) => text?.title?.trim() && text?.message?.trim()),
  );
}

function alertDate(date: string) {
  return new Date(date).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function AlertContent({
  alert,
  translations,
}: {
  alert: Pick<Alert, 'severity' | 'area' | 'authority' | 'expiresAt'>;
  translations: Record<string, Translation>;
}) {
  return (
    <div className="crisis-alert-content">
      <Badge value={alert.severity} />
      <dl>
        <div>
          <dt>Affected area</dt>
          <dd>{alert.area || 'Unavailable'}</dd>
        </div>
        <div>
          <dt>Issuing authority</dt>
          <dd>{alert.authority || 'Unavailable'}</dd>
        </div>
        <div>
          <dt>Expires at</dt>
          <dd>
            <time dateTime={alert.expiresAt}>{alertDate(alert.expiresAt)}</time>
          </dd>
        </div>
      </dl>
      {Object.entries(translations).map(([code, text]) => (
        <section key={code}>
          <small className="muted">{languageNames.of(code)}</small>
          <h3 lang={code}>{text.title}</h3>
          <p lang={code}>{text.message}</p>
        </section>
      ))}
    </div>
  );
}

export function CrisisPublishedAlerts({
  country,
  crises,
  history,
  policy,
}: {
  country: string;
  crises: Crisis[];
  history: ReturnType<typeof useCrisisAlertHistory>;
  policy?: Country;
}) {
  const { query, expanded, filters, pageSize, updateFilter, setPage, toggleExpanded, searching, showReview } =
    history;
  const [detail, setDetail] = useState<AlertHistoryRow>();
  const [action, setAction] = useState('');
  const [reason, setReason] = useState('');
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState(emptyAlertDraft);
  const write = useCrisisOperationsWrite(country);
  const results = query.data;
  const activity = useQuery({
    queryKey: ['alert-history', country, detail?.alert.id],
    queryFn: () => get<{ id: string; action: string; detail: string; actorId: string; actorName?: string; createdAt: string }[]>(countryPath(`/alerts/${detail!.alert.id}/history`, country)),
    enabled: !!detail && !!country,
  });
  const actions: { value: string; label: string; reason?: boolean }[] = [];
  if (detail) {
    if (detail.isAuthor && ['Draft', 'Returned'].includes(detail.status))
      actions.push({ value: 'submit', label: 'Submit for review' });
    if (detail.status === 'PendingReview' && detail.canReview)
      actions.push({ value: 'approve', label: 'Approve alert', reason: true }, { value: 'return', label: 'Return for changes', reason: true });
    if (detail.status === 'Approved' && (detail.isAuthor || results?.reviewer))
      actions.push({ value: 'publish', label: 'Publish alert' });
    if (results?.reviewer && detail.alert.severity === 'Critical' && ['Draft', 'Returned', 'PendingReview'].includes(detail.status))
      actions.push({ value: 'emergency-publish', label: 'Emergency publication', reason: true });
    if (detail.needsEmergencyReview && detail.canReview)
      actions.push({ value: 'post-review', label: 'Complete emergency review', reason: true });
    if (detail.alert.published && (detail.isAuthor || results?.reviewer))
      actions.push({ value: 'unpublish', label: 'Withdraw alert', reason: true });
  }
  if (editingId) return <div className="stack">
    <Button variant="secondary" onClick={() => setEditingId(undefined)}>Back to alert history</Button>
    <CrisisAlertComposer country={country} policy={policy} crises={crises} draft={draft} setDraft={setDraft}
      editingId={editingId} onSaved={() => setEditingId(undefined)} loading={false} failed={false} />
  </div>;

  return (
    <Card className="crisis-alert-history">
      <div className="crisis-panel-bar">
        <h2 className="crisis-panel-heading">
          <FileText aria-hidden="true" />
          {expanded ? 'Public alert history' : 'Published alerts'}
        </h2>
        {results?.reviewer && <button type="button" className="crisis-panel-link" onClick={showReview}>Review queue</button>}
        <button
          type="button"
          className="crisis-panel-link"
          onClick={toggleExpanded}
          aria-expanded={expanded}
        >
          {expanded ? 'Show recent alerts' : 'View all alerts'}{' '}
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <div className="crisis-alert-filters">
          <Field label="Search public alerts">
            <input
              type="search"
              value={filters.search}
              onChange={(event) => updateFilter('search', event.target.value)}
            />
          </Field>
          <Field label="Filter by severity">
            <select
              value={filters.severity}
              onChange={(event) => updateFilter('severity', event.target.value)}
            >
              <option value="">All severities</option>
              {severities.map((severity) => (
                <option key={severity}>{severity}</option>
              ))}
            </select>
          </Field>
          <Field label="Filter by status">
            <select
              value={filters.status}
              onChange={(event) => updateFilter('status', event.target.value)}
            >
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status === 'All' ? 'All statuses' : statusLabel(status)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Filter by crisis">
            <select
              value={filters.crisisId}
              onChange={(event) => updateFilter('crisisId', event.target.value)}
            >
              <option value="">All crises</option>
              {crises.map((crisis) => (
                <option key={crisis.id} value={crisis.id}>
                  {crisis.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {query.isPending || query.isPlaceholderData || searching ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !results?.items?.length ? (
        <p className="muted crisis-empty">
          {expanded ? 'No alerts match these filters.' : 'No published alerts in this country.'}
        </p>
      ) : (
        <div
          className="table-wrap crisis-alert-table"
          role="region"
          aria-label="Public alert results"
          tabIndex={0}
        >
          <table aria-label="Public alert history">
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Severity</th>
                <th scope="col">Languages</th>
                <th scope="col">Status</th>
                <th scope="col">Published at</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {results.items.map((row) => {
                const { alert, status } = row;
                return (
                  <tr key={alert.id}>
                    <th scope="row">{alert.title}</th>
                    <td>
                      <Badge value={alert.severity} />
                    </td>
                    <td>
                      {Object.keys(savedTranslations(alert))
                        .map((code) => code.toUpperCase())
                        .join(' · ') || '—'}
                    </td>
                    <td>
                      <span
                        className={`badge ${status === 'Published' ? 'green' : status === 'Expired' ? 'amber' : 'blue'}`}
                      >
                        {statusLabel(status)}
                      </span>
                    </td>
                    <td>
                      {alert.publishedAt ? <time dateTime={alert.publishedAt}>{alertDate(alert.publishedAt)}</time> : '—'}
                    </td>
                    <td>
                      <button
                        className="crisis-panel-link"
                        type="button"
                        aria-label={`View alert: ${alert.title}`}
                        onClick={() => {
                          setDetail(row);
                          setAction('');
                          setReason('');
                          write.reset();
                        }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {expanded &&
        results &&
        !query.isPlaceholderData &&
        !searching &&
        results.total > pageSize && (
          <nav className="crisis-pagination" aria-label="Alert pages">
            <Button
              type="button"
              variant="secondary"
              disabled={results.page === 1}
              onClick={() => setPage(results.page - 1)}
            >
              Previous
            </Button>
            <span>
              Page {results.page} of {Math.ceil(results.total / pageSize)}
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={results.page * pageSize >= results.total}
              onClick={() => setPage(results.page + 1)}
            >
              Next
            </Button>
          </nav>
        )}
      {detail && (
        <WorkspaceDialog
          title={detail.alert.title}
          context={crises.find((crisis) => crisis.id === detail.alert.crisisId)?.name}
          className="crisis-dialog"
          busy={write.isPending}
          onDismiss={() => setDetail(undefined)}
        >
          <p className="muted">{statusLabel(detail.status)}</p>
          <AlertContent alert={detail.alert} translations={savedTranslations(detail.alert)} />
          <details>
            <summary>Review and publication history</summary>
            {activity.isPending && <Loading />}
            {activity.error && <ErrorState error={activity.error} />}
            {Array.isArray(activity.data) && <ol className="stack">{activity.data.map((event) => (
              <li key={event.id}>{event.action.replace('PublicAlert', '')} · {alertDate(event.createdAt)} · {event.actorName || event.actorId}
                {event.detail && <p>{event.detail}</p>}
              </li>
            ))}</ol>}
          </details>
          {action && <Field label="Reason">
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} />
          </Field>}
          {write.error && <p className="field-error" role="alert">{errorMessage(write.error)}</p>}
          <div className="organisation-dialog-actions">
            {detail.isAuthor && policy && ['Draft', 'Returned'].includes(detail.status) && !action &&
              <Button variant="secondary" onClick={() => {
                const expiresAt = new Date(detail.alert.expiresAt);
                expiresAt.setMinutes(expiresAt.getMinutes() - expiresAt.getTimezoneOffset());
                setDraft({
                  crisisId: detail.alert.crisisId, severity: detail.alert.severity, authority: detail.alert.authority,
                  area: detail.alert.area, expiresAt: expiresAt.toISOString().slice(0, 16), translations: savedTranslations(detail.alert),
                });
                setEditingId(detail.alert.id);
                setDetail(undefined);
              }}>Edit draft</Button>}
            {actions.filter((entry) => !action || action === entry.value).map((entry) =>
              <Button key={entry.value} busy={write.isPending}
                disabled={action === entry.value && reason.trim().length < 5}
                variant={entry.value === 'unpublish' || entry.value === 'emergency-publish' ? 'danger' : 'secondary'}
                onClick={() => {
                  if (entry.reason && action !== entry.value) {
                    setAction(entry.value);
                    return;
                  }
                  write.mutate({ path: `/alerts/${detail.alert.id}/${entry.value}`, data: { reason } },
                    { onSuccess: () => setDetail(undefined) });
                }}>{entry.label}</Button>,
            )}
            <Button variant="secondary" disabled={write.isPending} onClick={() => {
              if (action) { setAction(''); setReason(''); }
              else setDetail(undefined);
            }}>{action ? 'Cancel action' : 'Close'}</Button>
          </div>
        </WorkspaceDialog>
      )}
    </Card>
  );
}
