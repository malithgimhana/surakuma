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
const statuses = ['Published', 'Expired', 'Withdrawn', 'Draft', 'All'] as const;
type AlertStatus = Exclude<(typeof statuses)[number], 'All'>;
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
}: {
  country: string;
  policy?: Country;
  crises: Crisis[];
  draft: AlertDraft;
  setDraft: (draft: AlertDraft) => void;
  loading: boolean;
  failed: boolean;
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

  function publish() {
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
        path: '/alerts',
        data: {
          crisisId,
          area,
          authority,
          severity,
          expiresAt: new Date(expiresAt).toISOString(),
          published: true,
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
        Public alert composer
      </h2>
      {published && (
        <p className="success-text" role="status">
          Public alert published.
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
              disabled={disabled}
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
            Review translations in the preview before publishing. Expiry uses your device’s local
            time.
          </p>
        </div>
        {validation && (
          <p className="field-error" role="alert">
            {validation}
          </p>
        )}
        <Button disabled={disabled || !selected}>Publish verified alert</Button>
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
            I reviewed the public wording and translations and confirm they are ready to publish.
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
            <Button busy={write.isPending} disabled={!reviewed} onClick={publish}>
              Publish alert
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
}
interface AlertHistoryPage {
  publishedCount: number;
  total: number;
  page: number;
  items: AlertHistoryRow[];
}
const initialFilters = { search: '', severity: '', status: 'All', crisisId: '' };
const recentFilters = { ...initialFilters, status: 'Published' };

export function useCrisisAlertHistory(country: string) {
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
    queryKey: ['crisis-operations', country, 'alerts', request, page, pageSize],
    queryFn: () =>
      get<AlertHistoryPage>(
        countryPath('/admin/crisis-operations/alerts', country, {
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
}: {
  country: string;
  crises: Crisis[];
  history: ReturnType<typeof useCrisisAlertHistory>;
}) {
  const { query, expanded, filters, pageSize, updateFilter, setPage, toggleExpanded, searching } =
    history;
  const [detail, setDetail] = useState<AlertHistoryRow>();
  const [withdrawing, setWithdrawing] = useState(false);
  const write = useCrisisOperationsWrite(country);
  const results = query.data;

  return (
    <Card className="crisis-alert-history">
      <div className="crisis-panel-bar">
        <h2 className="crisis-panel-heading">
          <FileText aria-hidden="true" />
          Published alerts
        </h2>
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
                  {status === 'All' ? 'All statuses' : status}
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
      ) : !results?.items.length ? (
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
                        {status}
                      </span>
                    </td>
                    <td>
                      {status === 'Draft' ? (
                        '—'
                      ) : (
                        <time dateTime={alert.createdAt}>{alertDate(alert.createdAt)}</time>
                      )}
                    </td>
                    <td>
                      <button
                        className="crisis-panel-link"
                        type="button"
                        aria-label={`View alert: ${alert.title}`}
                        onClick={() => {
                          setDetail(row);
                          setWithdrawing(false);
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
          title={withdrawing ? 'Withdraw public alert?' : detail.alert.title}
          context={crises.find((crisis) => crisis.id === detail.alert.crisisId)?.name}
          className="crisis-dialog"
          busy={write.isPending}
          onDismiss={() => setDetail(undefined)}
        >
          {withdrawing ? (
            <p>
              This removes the alert from the public feed. The alert and its history remain
              available here.
            </p>
          ) : (
            <>
              <p className="muted">{detail.status}</p>
              <AlertContent alert={detail.alert} translations={savedTranslations(detail.alert)} />
            </>
          )}
          {write.error && (
            <p className="field-error" role="alert">
              {errorMessage(write.error)}
            </p>
          )}
          <div className="organisation-dialog-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={write.isPending}
              onClick={() => {
                if (withdrawing) setWithdrawing(false);
                else setDetail(undefined);
              }}
            >
              {withdrawing ? 'Cancel' : 'Close'}
            </Button>
            {withdrawing ? (
              <Button
                variant="danger"
                busy={write.isPending}
                onClick={() =>
                  write.mutate(
                    {
                      path: `/alerts/${detail.alert.id}/unpublish`,
                    },
                    { onSuccess: () => setDetail(undefined) },
                  )
                }
              >
                Withdraw alert
              </Button>
            ) : (
              detail.status === 'Published' && (
                <Button variant="secondary" onClick={() => setWithdrawing(true)}>
                  Withdraw alert
                </Button>
              )
            )}
          </div>
        </WorkspaceDialog>
      )}
    </Card>
  );
}
