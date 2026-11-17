import { PartnerVerification, type Verification } from './AdministrationWorkflows';
import { useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, CircleCheck, Clock, Plus, Search, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, get } from './api';
import { useOptionalAuth } from './auth';
import { Button, Card, ErrorState, Field, Loading, PageHeader } from './components';
import { CountryAdministration } from './CountryAdministration';
import { useCountries, useCountry } from './geography';
import { OrganisationDialog, organisationIdPattern } from './OrganisationDialog';

interface PartnerOrganisation {
  id: string;
  name: string;
  enabled: boolean;
  verification?: Verification;
  primaryCrises: { id: string; name: string }[];
}

export function usePartnerDirectory(countryCode: string, enabled: boolean) {
  return useQuery({
    queryKey: ['admin-organisations', countryCode],
    queryFn: () => get<PartnerOrganisation[]>(`/admin/organisations?countryCode=${countryCode}`),
    enabled,
  });
}

export function OrganisationsPage({ globalAdmin }: { globalAdmin: boolean }) {
  const countryCode = useCountry();
  const countries = useCountries();
  const auth = useOptionalAuth();
  const country = (Array.isArray(countries.data) ? countries.data.find((item) => item.code === countryCode)?.name : undefined)
    ?? ({ LK: 'Sri Lanka', NP: 'Nepal', IN: 'India' }[countryCode] || countryCode);
  const canManageCountry = globalAdmin || auth?.user?.memberships.some(
    (membership) => membership.role === 'CountryAdministrator' && membership.countryCode === countryCode && !membership.crisisId,
  );
  return <OrganisationsWorkspace key={countryCode} {...{ globalAdmin, countryCode, country }} canManageCountry={!!canManageCountry} />;
}

interface OrganisationScope {
  globalAdmin: boolean;
  countryCode: string;
  country: string;
}

function OrganisationsWorkspace({ globalAdmin, countryCode, country, canManageCountry }: OrganisationScope & { canManageCountry: boolean }) {
  const [params] = useSearchParams();
  const view = params.get('view');
  const tabs = [
    { label: 'Partner organisations', key: null, to: '/admin?section=organisations' },
    { label: 'Country settings', key: 'country', to: '/admin?section=organisations&view=country' },
  ];
  const current = tabs.find((tab) => tab.key === view) ?? tabs[0];
  const [adding, setAdding] = useState(false);

  return (
    <section className="organisation-page">
      <PageHeader
        title="Organisations"
        description="Set up partners to receive cases and assign staff in the selected country."
        action={globalAdmin && current.key === null && (
          <Button type="button" aria-haspopup="dialog" onClick={() => setAdding(true)}>
            <Plus size={18} aria-hidden="true" /> Add organisation
          </Button>
        )}
      />
      <nav className="organisation-tabs" aria-label="Organisation settings">
        {tabs.map((tab) => (
          <Link key={tab.label} to={tab.to} aria-current={tab === current ? 'page' : undefined} onClick={() => setAdding(false)}>
            {tab.label}
          </Link>
        ))}
      </nav>
      {!canManageCountry ? (
        <Card><p>You don’t administer {country}. Select a country you manage using the country menu above.</p></Card>
      ) : current.key === 'country' ? <CountryAdministration /> : (
        <PartnerDirectory {...{ globalAdmin, countryCode, country, adding }} onDismiss={() => setAdding(false)} />
      )}
    </section>
  );
}

function PartnerDirectory({ globalAdmin, countryCode, country, adding, onDismiss }: OrganisationScope & {
  adding: boolean;
  onDismiss: () => void;
}) {
  const partners = usePartnerDirectory(countryCode, true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [notice, setNotice] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const results = partners.data?.filter((partner) => partner.name.toLowerCase().includes(search.trim().toLowerCase())) ?? [];
  const selected = results.find((partner) => partner.id === selectedId) ?? results[0];
  const count = partners.data?.length;

  return (
    <>
      {adding && globalAdmin && <AddOrganisation country={country} countryCode={countryCode} onDismiss={onDismiss} onAdded={(name, message, id) => {
        setSearch(name);
        setSelectedId(id);
        setNotice(message);
        onDismiss();
      }} />}
      {notice && <p className="organisation-notice" role="status"><CircleCheck size={18} aria-hidden="true" />{notice}</p>}
      <Card className="partner-split">
        <section className="partner-directory" aria-labelledby="partner-directory-title">
          <h2 id="partner-directory-title">Partner directory</h2>
          <p className="muted partner-country">{country}{count !== undefined && ` · ${count} organisation${count === 1 ? '' : 's'}`}</p>
          <label className="organisation-search">
            <span className="sr-only">Search organisations</span>
            <Search size={19} aria-hidden="true" />
            <input ref={searchInput} type="search" placeholder="Search organisations" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          {partners.isPending ? <Loading /> : partners.error && !partners.data ? (
            <ErrorState error={partners.error} retry={() => void partners.refetch()} />
          ) : results.length ? (
            <ul className="partner-list">
              {results.map((partner) => (
                <li key={partner.id}>
                  <button type="button" className="partner-choice" aria-pressed={selected?.id === partner.id} onClick={() => setSelectedId(partner.id)}>
                    <strong>{partner.name}</strong>
                    <PartnerStatus state={partner.verification?.verificationState} />
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="muted partner-empty">{search.trim() ? 'No organisations match your search.' : `No partner organisations available in ${country}.`}</p>}
        </section>
        {selected ? <PartnerDetails key={selected.id} partner={selected} {...{ country, countryCode, globalAdmin }} onDeleted={(archived, countryOnly) => {
          setSearch('');
          setSelectedId(undefined);
          setNotice(`“${selected.name}” was ${countryOnly ? `removed from ${country}.` : archived ? 'archived in all countries.' : 'deleted.'}`);
          requestAnimationFrame(() => searchInput.current?.focus());
        }} /> : (
          <div className="partner-details partner-empty-detail">
            <p className="muted">{search.trim() ? 'Try another search to find a partner.' : 'Partner details will appear here.'}</p>
          </div>
        )}
      </Card>
    </>
  );
}

function PartnerStatus({ state }: { state?: string }) {
  if (state === 'Verified') return <span className="partner-status verified"><CircleCheck size={19} aria-hidden="true" />Verified</span>;
  if (state === 'LegacyActive') return <span className="partner-status"><Clock size={19} aria-hidden="true" />Legacy active — review required</span>;
  if (state === 'Rejected') return <span className="partner-status rejected"><CircleAlert size={19} aria-hidden="true" />Rejected</span>;
  return <span className="partner-status"><Clock size={19} aria-hidden="true" />Pending verification</span>;
}

function PartnerDetails({ partner, country, countryCode, globalAdmin, onDeleted }: OrganisationScope & {
  partner: PartnerOrganisation;
  onDeleted: (archived: boolean, countryOnly: boolean) => void;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [removalScope, setRemovalScope] = useState<'country' | 'all'>();
  const heading = useRef<HTMLHeadingElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const movedFocus = useRef(false);
  useLayoutEffect(() => {
    if (reviewing) {
      movedFocus.current = true;
      heading.current?.focus();
    } else if (movedFocus.current) reviewButton.current?.focus();
  }, [reviewing]);

  const state = partner.verification?.verificationState;
  const operational = state === 'Verified' || state === 'LegacyActive';

  return (
    <section className="partner-details" aria-labelledby="partner-details-title">
      {reviewing ? (
        <>
          <button type="button" className="organisation-link partner-back" onClick={() => setReviewing(false)}>
            <ArrowLeft size={18} aria-hidden="true" /> Back to partner
          </button>
          <h2 id="partner-details-title" ref={heading} tabIndex={-1}>Verification in {country}</h2>
          <p className="partner-review-name">{partner.name}</p>
          <PartnerStatus state={state} />
          <PartnerVerification id={partner.id} verification={partner.verification} global={globalAdmin} />
        </>
      ) : (
        <>
          <h2 id="partner-details-title">{partner.name}</h2>
          <p className="muted partner-country">{country}</p>
          <dl className="partner-facts">
            <div>
              <dt>Verification</dt>
              <dd>
                <PartnerStatus state={state} />
                <button className="organisation-link" type="button" ref={reviewButton} onClick={() => setReviewing(true)}>
                  {state === 'Verified' ? 'View verification' : 'Review verification'}
                </button>
              </dd>
            </div>
            <div>
              <dt>Crisis routing</dt>
              <dd>{operational
                ? partner.primaryCrises.length
                  ? `Primary centre for ${partner.primaryCrises.map((crisis) => crisis.name).join(', ')}`
                  : 'No active crises as primary centre'
                : 'Unavailable until verified'}</dd>
            </div>
          </dl>
          {operational ? (
            <div className="organisation-actions">
              <Link to={`/admin?section=users&organisation=${encodeURIComponent(partner.id)}`}>Assign staff</Link>
              <Link to={`/admin/crises?centre=${encodeURIComponent(partner.id)}`}>Set crisis routing</Link>
            </div>
          ) : <p className="partner-routing-note muted">Verify this partner before assigning staff or routing new cases.</p>}
          <div className="partner-admin-details">
            {globalAdmin && <details className="partner-id"><summary>Organisation ID</summary><code>{partner.id}</code></details>}
            <button type="button" className="organisation-link organisation-delete" aria-haspopup="dialog" onClick={() => setRemovalScope('country')}>
              <Trash2 size={17} aria-hidden="true" /> Remove from {country}
            </button>
            {globalAdmin && (
              <button type="button" className="organisation-link organisation-delete" aria-haspopup="dialog" onClick={() => setRemovalScope('all')}>
                <Trash2 size={17} aria-hidden="true" /> Delete organisation
              </button>
            )}
          </div>
          {removalScope && (
            <DeleteOrganisation partner={partner} country={country} countryCode={removalScope === 'country' ? countryCode : undefined}
              onDismiss={() => setRemovalScope(undefined)} onDeleted={onDeleted} />
          )}
        </>
      )}
    </section>
  );
}

function DeleteOrganisation({ partner, country, countryCode, onDismiss, onDeleted }: {
  partner: PartnerOrganisation;
  country: string;
  countryCode?: string;
  onDismiss: () => void;
  onDeleted: (archived: boolean, countryOnly: boolean) => void;
}) {
  const client = useQueryClient();
  const path = '/admin/organisations/' + encodeURIComponent(partner.id) + (countryCode ? `/countries/${encodeURIComponent(countryCode)}` : '');
  const impact = useQuery({
    queryKey: ['organisation-deletion', partner.id, countryCode],
    queryFn: () => get<{ countries: string[]; blockers: string[] }>(path + '/deletion'),
    staleTime: 0,
  });
  const remove = useMutation({
    mutationFn: (archiveLinked: boolean) => api.delete(archiveLinked && !countryCode ? path + '?archiveLinked=true' : path),
    onError: () => void impact.refetch(),
    onSuccess: (_, archived) => {
      client.setQueriesData<PartnerOrganisation[]>({ queryKey: countryCode ? ['admin-organisations', countryCode] : ['admin-organisations'] }, (current) =>
        current?.filter((item) => item.id !== partner.id));
      onDismiss();
      onDeleted(archived, !!countryCode);
      for (const key of ['admin-organisations', 'lookups', 'audit', 'triage', 'crises', 'admin-users', 'approvals', 'shelters']) {
        void client.invalidateQueries({ queryKey: [key] });
      }
    },
  });
  const blocked = !!impact.data?.blockers.length;

  return (
    <OrganisationDialog title={countryCode ? `Remove from ${country}?` : 'Delete organisation?'} context={partner.name} busy={remove.isPending} onDismiss={onDismiss}>
      <div className="stack">
        {impact.isLoading && <Loading />}
        {impact.error && <ErrorState error={impact.error} retry={() => void impact.refetch()} />}
        {impact.data && (
          <>
            {countryCode ? <p>This removes the organisation from the {country} directory. Its staff access ends and open cases return to the unassigned queue in {country}. Linked records and case history are kept.</p>
              : !blocked && <p>This permanently deletes the organisation and its country registrations.</p>}
            {!countryCode && impact.data.countries.length > 0 && <p><strong>Countries affected</strong> · {impact.data.countries.join(', ')}</p>}
            {blocked && (
              <div>
                <strong>Linked records</strong>
                <ul className="organisation-delete-blockers">
                  {impact.data.blockers.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              </div>
            )}
            {blocked && !countryCode && (
              <p>
                Archiving removes this organisation from every country’s directory and ends its staff access.
                Open cases return to the unassigned queue. Linked records and case history are kept.
              </p>
            )}
          </>
        )}
        {remove.error && <ErrorState error={remove.error} />}
        <div className="organisation-dialog-actions organisation-delete-anyway">
          <Button type="button" variant="secondary" autoFocus disabled={remove.isPending} onClick={onDismiss}>Cancel</Button>
          <Button type="button" variant="danger" busy={remove.isPending} disabled={!impact.isSuccess || impact.isFetching} onClick={() => remove.mutate(blocked)}>
            {countryCode ? `Remove from ${country}` : blocked ? 'Archive organisation' : 'Delete organisation'}
          </Button>
        </div>
      </div>
    </OrganisationDialog>
  );
}

function AddOrganisation({ country, countryCode, onDismiss, onAdded }: {
  country: string;
  countryCode: string;
  onDismiss: () => void;
  onAdded: (search: string, notice: string, id: string) => void;
}) {
  const [existing, setExisting] = useState(false);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: async (value: string) => {
      if (existing) {
        await api.put(`/admin/organisations/${encodeURIComponent(value)}/countries/${countryCode}`);
        return { id: value, search: '', notice: `The organisation is now enabled in ${country}.` };
      }
      const { data } = await api.post<{ id: string; name: string }>('/admin/organisations', { name: value, countryCode });
      return { id: data.id, search: data.name, notice: `${data.name} was added and enabled in ${country}.` };
    },
    onSuccess: ({ search, notice, id }) => {
      onAdded(search, notice, id);
      return client.invalidateQueries();
    },
  });

  return (
    <OrganisationDialog title="Add organisation" context={country} busy={save.isPending} onDismiss={onDismiss}>
      <form className="stack" onSubmit={(event) => {
        event.preventDefault();
        const value = String(new FormData(event.currentTarget).get('organisation') ?? '').trim();
        if (value) save.mutate(value);
      }}>
        <fieldset className="organisation-dialog-fields" disabled={save.isPending}>
          <Field label="Organisation setup">
            <select autoFocus value={existing ? 'existing' : 'new'} onChange={(event) => {
              setExisting(event.target.value === 'existing');
              save.reset();
            }}>
              <option value="new">Create an organisation</option>
              <option value="existing">Use an existing organisation ID</option>
            </select>
          </Field>
          {existing ? <Field label="Organisation ID" hint="Use the ID from the organisation’s existing country directory.">
            <input key="id" name="organisation" placeholder="Paste organisation ID" required pattern={organisationIdPattern} />
          </Field> : <Field label="Organisation name" hint={`New partners need verification in ${country} before receiving work.`}>
            <input key="name" name="organisation" required maxLength={150} pattern=".*\S.*" />
          </Field>}
        </fieldset>
        {save.error && <ErrorState error={save.error} />}
        <div className="organisation-dialog-actions">
          <Button type="button" variant="secondary" disabled={save.isPending} onClick={onDismiss}>Cancel</Button>
          <Button busy={save.isPending}>{existing ? `Enable in ${country}` : 'Create organisation'}</Button>
        </div>
      </form>
    </OrganisationDialog>
  );
}
