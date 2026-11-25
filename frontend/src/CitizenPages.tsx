import { Fragment, useEffect, useRef, useState } from 'react';
import { RegionField, useCountry, useDivisions } from './geography';
import { isAxiosError } from 'axios';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BrowserPushSettings } from './BrowserPushSettings';
import { RequestCategoryHelp } from './RequestCategoryHelp';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import {
  Accessibility,
  ArrowLeft,
  ArrowRight,
  Bell,
  Bus,
  Check,
  CheckCircle2,
  ClipboardList,
  Eye,
  EyeOff,
  Heart,
  House,
  MapPin,
  MoreHorizontal,
  Plus,
  Siren,
  Tent,
  ShieldCheck,
  Stethoscope,
  Trash2,
  Utensils,
} from 'lucide-react';
import { api, errorMessage, get } from './api';
import { landing, loginDestination, useAuth } from './auth';
import { coordinatorPath, donorWorkspace, notificationInboxRole, shelterPath } from './countryScope';
import { locationSearchSchema, type LocationResult } from './locationSearch';
import {
  Badge,
  Button,
  Card,
  categories,
  Empty,
  ErrorState,
  Field,
  formatDate,
  IconTile,
  Loading,
  NextLink,
  PageHeader,
} from './components';
import { CommunityArt } from './CommunityArt';
import { CaseDispatches } from './CaseDispatches';
import { countryMapCenters, MapView } from './MapView';
import { isStockUnitForCategory, ResourceUnitSelect, useResourceUnitCatalog } from './ResourceUnitSelect';
import { AlertCard, useAlerts } from './PublicPages';
import { foodItems } from './supplyItems';
import { blankIntake, blankSupplyItem, CitizenIntakeFields, descriptionLabels, IntakeFlags, IntakeQuestion,
  intakeSchema, IntakeSummary, maxSupplyItems, needsQuantity, peopleLabels, validateIntake } from './CitizenIntakeFields';
import { baseUnit, isMeasuredUnit, unitSymbol } from './quantity';
import type {
  AidRequest,
  Category,
  Lookups,
  Notification,
  Page,
  RequestDetail,
  Status,
  User,
} from './types';

export function AuthPage({ register = false, donor = false }: { register?: boolean; donor?: boolean }) {
  const { t, i18n } = useTranslation(),
    { signIn } = useAuth(),
    navigate = useNavigate(),
    location = useLocation();
  const resetLabels: Record<string, string> = { en: 'Forgot password?', si: 'මුරපදය අමතකද?', ta: 'கடவுச்சொல் மறந்துவிட்டதா?', ne: 'पासवर्ड बिर्सनुभयो?', hi: 'पासवर्ड भूल गए?' };
  const [error, setError] = useState<string | null>(null);
  const action = register ? 'register' : 'login';
  const donorAction = t(register ? 'donorRegister' : 'donorLogin');
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => setShowPassword(false), [register]);
  const {
    register: field,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<{ name: string; email: string; password: string; organisationName?: string }>();
  async function submit(values: { name: string; email: string; password: string; organisationName?: string }) {
    setError(null);
    try {
      const user = await signIn(`/auth/${donor ? 'donor/' : ''}${action}`, {
        ...values,
        language: i18n.language,
      });
      navigate(loginDestination(user, (location.state as { from?: string } | null)?.from, donor ? donorWorkspace : undefined), { replace: donor });
    } catch (failure) {
      const status = isAxiosError(failure) ? failure.response?.status : undefined;
      setError(status === 429 ? t('authThrottle') : donor && status !== 401 ? errorMessage(failure) :
        t(donor ? 'donorAuthError' : 'authError'));
    }
  }
  return (
    <div className="container auth-page">
      <div className="auth-story">
        <span className="eyebrow">{t(donor ? 'donation' : 'communityTag')}</span>
        <h1>
          {donor ? t('donationTitle') : <>{t('heroTitle')}<br /><span className="coral-text">{t('heroAccent')}</span></>}
        </h1>
        <CommunityArt />
        <p>{t(donor ? 'donationDescription' : 'footerTag')}</p>
      </div>
      <Card className="auth-card">
        <IconTile icon={Heart} tone="coral" />
        <h1>{donor ? donorAction : t(register ? 'register' : 'welcomeBack')}</h1>
        <p className="muted auth-subtitle">{t(donor ? register ? 'donorRegisterSubtitle' : 'donorLoginSubtitle' : register ? 'registerSubtitle' : 'loginSubtitle')}</p>
        <form onSubmit={handleSubmit(submit)} className="stack">
          {register && (
            <Field label={t('name')} error={errors.name ? t('checkFields') : undefined}>
              <input autoComplete="name" {...field('name', { required: true, maxLength: 100 })} />
            </Field>
          )}
          {register && donor && <Field label={t('donorOrganisation')}>
            <input autoComplete="organization" maxLength={150} {...field('organisationName')} />
          </Field>}
          <Field label={t('email')} error={errors.email ? t('checkFields') : undefined}>
            <input type="email" autoComplete="email" {...field('email', { required: true })} />
          </Field>
          <Field
            label={t('password')}
            labelAction={
              !register && (
                <Link className="auth-recovery-link" to={donor ? '/donation/forgot-password' : '/forgot-password'}>
                  {resetLabels[i18n.resolvedLanguage || i18n.language] || resetLabels.en}
                </Link>
              )
            }
            hint={register ? t('passwordHint') : undefined}
            error={errors.password ? t('checkFields') : undefined}
            endAdornment={
              <button type="button" className="staff-password-toggle" aria-label={t(showPassword ? 'hidePassword' : 'showPassword')} aria-pressed={showPassword} onClick={() => setShowPassword((shown) => !shown)}>
                {showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
              </button>
            }
          >
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete={register ? 'new-password' : 'current-password'}
              {...field('password', { required: true, minLength: register ? 10 : 1 })}
            />
          </Field>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" busy={isSubmitting}>
            {donor ? donorAction : t(action)}
            <ArrowRight size={18} />
          </Button>
        </form>
        <p className="auth-switch">
          {t(register ? 'haveAccount' : 'noAccount')}{' '}
          <Link to={(donor ? '/donation' : '') + (register ? '/login' : '/register')} state={location.state}>
            {t(donor ? register ? 'donorLogin' : 'donorRegister' : register ? 'login' : 'register')}
          </Link>
        </p>
        {register && (
          <div className="privacy-note">
            <ShieldCheck size={17} />
            {t('privacyText')}
          </div>
        )}
      </Card>
    </div>
  );
}
const requestStatuses = ['Submitted', 'UnderReview', 'Verified', 'Approved', 'InProgress',
  'PartiallyFulfilled', 'Fulfilled', 'Closed', 'Rejected', 'Cancelled'] as const satisfies readonly Status[];
const activeStatuses: ReadonlySet<Status> = new Set(requestStatuses.slice(0, 6));

function RequestProgress({ request }: { request: AidRequest }) {
  const { t } = useTranslation();
  if (!request.quantity || request.unitRequiresClarification || (request.intake?.supplyItems?.length ?? 0) > 1) return null;
  const unit = request.category === 'Shelter' ? t('shelterQuantity') : unitSymbol(request.unit);
  const people = baseUnit(request.unit) === 'persons';
  return <div className="citizen-request-progress">
    <small>{t(people ? 'intake.peopleProgress' : 'deliveredAmount', { delivered: request.deliveredQuantity, requested: request.quantity, unit })}</small>
    <progress aria-label={t(people ? 'intake.peopleHelped' : 'delivered')} value={Math.min(request.deliveredQuantity, request.quantity)} max={request.quantity} />
  </div>;
}

export function RequestRows({ items }: { items: AidRequest[] }) {
  const { t, i18n } = useTranslation();
  return (
    <ul className="citizen-request-list">
      {items.map((r) => (
        <li key={r.id}>
          <Link to={`/app/requests/${r.id}`} className="citizen-request-row">
            <IconTile icon={icons[categories.indexOf(r.category)] ?? ClipboardList}
              tone={r.category === 'Shelter' ? 'yellow' : r.category === 'Medical' ? 'blue' : 'coral'} />
            <div className="citizen-request-identity">
              <strong>{t('category.' + r.category)}</strong>
              <small>{r.reference} · <time dateTime={r.createdAt}>{formatDate(r.createdAt, i18n.language)}</time></small>
            </div>
            <Badge value={r.status} />
            <RequestProgress request={r} />
            <span className="citizen-request-link">{t('viewDetails')} <ArrowRight size={16} aria-hidden="true" /></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
export function CitizenOverview() {
  const { user } = useAuth(),
    { t, i18n } = useTranslation(), country = useCountry();
  const q = useQuery({
    queryKey: ['requests', 'mine', country],
    queryFn: () => get<Page<AidRequest>>('/requests/mine'),
  });
  const summary = useQuery({ queryKey: ['requests', 'mine', 'summary', country],
    queryFn: () => get<{ status: Status; count: number }[]>('/requests/mine/summary') });
  const notifications = useQuery({ queryKey: ['notifications', 'list', user?.id, country, 'Citizen', 'all'],
    queryFn: () => get<Notification[]>(`/notifications?${new URLSearchParams({ inboxRole: 'Citizen', countryCode: country })}`), refetchInterval: 15000 });
  const alerts = useAlerts();
  const counts = new Map(summary.data?.map(item => [item.status, item.count]));
  const activeCount = [...counts].reduce((total, [status, count]) => total + (activeStatuses.has(status) ? count : 0), 0);
  return (
    <div className="citizen-page">
      <section className="citizen-welcome citizen-dashboard-hero">
        <div>
          <span className="eyebrow">{t('dashboard')}</span>
          <h1>{t('welcome', { name: user?.name.split(' ')[0] })}</h1>
          <p>{t('overviewSubtitle')}</p>
          <div className="inline citizen-hero-actions">
            <Link to="/app/requests/new" className="button primary"><Plus size={19} aria-hidden="true" />{t('newRequest')}</Link>
            <Link to="/app/shelters" className="button secondary"><Tent size={19} aria-hidden="true" />{t('shelters')}</Link>
          </div>
        </div>
        <CommunityArt />
      </section>
      <Card className="citizen-summary">
        <h2>{t('requestStatusOverview')}</h2>
        {summary.isPending ? <Loading /> : summary.error ? <ErrorState error={summary.error} retry={() => void summary.refetch()} /> : (
          <dl className="citizen-summary-counts">
            <div className="citizen-active-count"><dt>{t('activeRequests')}</dt><dd>{activeCount}</dd></div>
            {requestStatuses.filter(status => counts.has(status)).map(status => <div key={status}>
              <dt>{t('status.' + status)}</dt><dd>{counts.get(status)}</dd>
            </div>)}
          </dl>
        )}
      </Card>
      <section>
        <div className="section-heading">
          <h2>{t('recentRequests')}</h2>
          <NextLink to="/app/requests">{t('myRequests')}</NextLink>
        </div>
        {q.isPending ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} retry={() => void q.refetch()} />
        ) : q.data?.items.length ? (
          <Card className="flush">
            <RequestRows items={q.data.items.slice(0, 5)} />
          </Card>
        ) : (
          <Card>
            <Empty title={t('noRequests')} description={t('noRequestsDesc')} />
          </Card>
        )}
      </section>
      <div className="citizen-dashboard-updates">
        <section>
          <div className="section-heading"><h2><Bell size={20} aria-hidden="true" /> {t('recentNotifications')}</h2>
            <NextLink to="/app/notifications">{t('notifications')}</NextLink></div>
          {notifications.isPending ? <Loading /> : notifications.error ? <ErrorState error={notifications.error} retry={() => void notifications.refetch()} /> :
            notifications.data?.length ? <Card className="citizen-update-card"><ul>{notifications.data.slice(0, 3).map(n =>
              <li key={n.id}><p>{notificationMessage(n, i18n.language)}</p>
                <time className="muted" dateTime={n.createdAt}>{formatDate(n.createdAt, i18n.language)}</time></li>)}</ul></Card> :
              <Card><Empty title={t('noNotifications')} /></Card>}
        </section>
        <section>
          <div className="section-heading"><h2><Siren size={20} aria-hidden="true" /> {t('alerts')}</h2>
            <NextLink to="/app/alerts">{t('allAlerts')}</NextLink></div>
          {alerts.isPending ? <Loading /> : alerts.error ? <ErrorState error={alerts.error} retry={() => void alerts.refetch()} /> :
            alerts.data?.length ? <div className="stack">{alerts.data.slice(0, 2).map(alert => <AlertCard alert={alert} key={alert.id} />)}</div> :
              <Card><Empty title={t('noAlerts')} /></Card>}
        </section>
      </div>
    </div>
  );
}
export function MyRequests() {
  const { t } = useTranslation(), country = useCountry();
  const [page, setPage] = useState(1),
    [status, setStatus] = useState(''),
    [searchInput, setSearchInput] = useState(''),
    [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['requests', 'mine', country, page, status, search],
    queryFn: () => get<Page<AidRequest>>(`/requests/mine?page=${page}&status=${status}${search ? '&search=' + encodeURIComponent(search) : ''}`),
  });
  const pageNumber = q.data?.pageNumber ?? page;
  const pageCount = Math.max(1, Math.ceil((q.data?.total ?? 0) / (q.data?.pageSize || 20)));
  function clearFilters() { setStatus(''); setSearch(''); setSearchInput(''); setPage(1); }
  return (
    <div className="citizen-page">
      <PageHeader
        title={t('myRequests')}
        action={
          <Link className="button primary" to="/app/requests/new">
            <Plus size={18} />
            {t('newRequest')}
          </Link>
        }
      />
      <Card><form className="citizen-request-filters" role="search" onSubmit={(event) => {
        event.preventDefault();
        setPage(1);
        setSearch(searchInput.trim());
      }}>
        <Field label={t('requestSearchLabel')}><input type="search" value={searchInput} onChange={(event) => {
          setSearchInput(event.target.value);
          if (!event.target.value) { setSearch(''); setPage(1); }
        }} /></Field>
        <Field label={t('requestStatus')}><select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>
          <option value="">{t('all')}</option>
          {requestStatuses.map(value => <option key={value} value={value}>{t('status.' + value)}</option>)}
        </select></Field>
        <Button type="submit" variant="secondary">{t('searchRequests')}</Button>
      </form></Card>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : q.data?.items.length ? (
        <>
          <Card className="flush">
            <RequestRows items={q.data.items} />
          </Card>
          <div className="pagination">
            <Button variant="secondary" disabled={pageNumber === 1} onClick={() => setPage(pageNumber - 1)}>
              {t('back')}
            </Button>
            <span role="status">{t('pageOf', { page: pageNumber, total: pageCount })}</span>
            <Button
              variant="secondary"
              disabled={pageNumber >= pageCount}
              onClick={() => setPage(pageNumber + 1)}
            >
              {t('next')}
            </Button>
          </div>
        </>
      ) : (
        <Card><Empty title={search || status ? t('noMatchingRequests') : t('noRequests')}
          description={search || status ? t('noMatchingRequestsDescription') : t('noRequestsDesc')}
          action={search || status ? <Button variant="secondary" onClick={clearFilters}>{t('clearFilters')}</Button> : undefined} /></Card>
      )}
    </div>
  );
}
const requestSchema = z.object({
  category: z.preprocess((value: Category | null) => value ?? undefined, z.enum(categories)),
  intake: intakeSchema,
  description: z.string().min(10).max(4000),
  categoryReceipt: z.string().max(2048).nullish(),
  locationText: z.string().min(3).max(500),
  householdSize: z.number().int().min(1).max(50),
  quantity: z.number().min(0.01).max(100000),
  unit: z.string(),
  administrativeDivisionId: z.string().nullable(),
  accessibilityNeeds: z.string().max(500),
  crisisId: z.string().min(1),
  organisationId: z.string(),
  requestedForSomeoneElse: z.boolean(),
  requesterRelationship: z.string().max(200),
  requesterContact: z.string().max(500),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  synthetic: z.boolean(),
}).superRefine((input, ctx) => {
  validateIntake(input.category, input.intake, ctx);
});
type RequestForm = z.infer<typeof requestSchema>;
type RequestFormInput = z.input<typeof requestSchema>;
type SavedRequestDraft = { key: string; values: Partial<RequestForm>; requestId?: string };

function readDraftStorage<T>(key: string, fallback: T): T {
  try { return JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? fallback; }
  catch { return fallback; }
}

function listDrafts(key: string): SavedRequestDraft[] {
  const drafts = readDraftStorage<SavedRequestDraft[]>(key, []);
  return Array.isArray(drafts) ? drafts.filter(draft => draft && typeof draft.key === 'string' &&
    categories.includes(draft.values?.category as Category)) : [];
}

function saveDrafts(key: string, drafts: SavedRequestDraft[]) {
  try { sessionStorage.setItem(key, JSON.stringify(drafts)); return true; }
  catch { return false; }
}

function migrateLegacyDraft(key: string, legacyKey: string, draft: SavedRequestDraft) {
  if (!saveDrafts(key, [draft])) return;
  try {
    sessionStorage.removeItem(legacyKey);
    sessionStorage.removeItem(legacyKey + '.key');
  } catch { /* The new draft remains available. */ }
}
const icons = [Utensils, Stethoscope, House, Bus, Accessibility, MoreHorizontal];
export function NewRequest() {
  const country = useCountry();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const category = params.get('category') as Category | null;
  const requestedCategory = category && categories.includes(category) ? category : undefined;
  if (!user) return null;
  return <RequestDraftGate key={`${user.id}:${country}:${requestedCategory ?? ''}`} user={user}
    country={country} requestedCategory={requestedCategory} />;
}

function RequestDraftGate({ user, country, requestedCategory }: { user: User; country: string; requestedCategory?: Category }) {
  const { t } = useTranslation();
  const key = `surakuma.draft.${user.id}.${country}`;
  const legacyKey = `surakuma.draft.${user.id}`;
  const [saved, setSaved] = useState(() => listDrafts(key));
  const [legacy] = useState(() => readDraftStorage<Partial<RequestForm>>(legacyKey, {}));
  const [choice, setChoice] = useState<SavedRequestDraft | null>();
  const lookup = useQuery({ queryKey: ['lookups', country], queryFn: () => get<Lookups>('/public/lookups') });
  const legacyExists = !saved.length && categories.includes(legacy.category as Category);
  const legacyMatchesCountry = legacy.crisisId
    ? lookup.data?.crises.some(crisis => crisis.id === legacy.crisisId)
    : !legacy.locationText && legacy.latitude == null && legacy.longitude == null && !legacy.administrativeDivisionId;
  const [legacyDraft] = useState(() => {
    let previousKey: string | null = null;
    try { previousKey = sessionStorage.getItem(legacyKey + '.key'); } catch { /* Storage may be disabled. */ }
    return { key: previousKey || crypto.randomUUID(), values: legacy };
  });
  const available = legacyExists && legacyMatchesCountry ? [legacyDraft] : saved;
  const active = available[0];
  const conflicting = !!(active && requestedCategory && active.values.category !== requestedCategory);
  function selectDraft(draft: SavedRequestDraft | null) {
    setSaved(listDrafts(key));
    setChoice(draft);
  }
  useEffect(() => {
    if (legacyExists && legacyMatchesCountry) migrateLegacyDraft(key, legacyKey, legacyDraft);
  }, [key, legacyKey, legacyDraft, legacyExists, legacyMatchesCountry]);

  if (legacyExists && legacy.crisisId && lookup.isPending) return <Loading />;
  if (legacyExists && legacy.crisisId && lookup.isError) return <ErrorState error={lookup.error} retry={() => void lookup.refetch()} />;
  if (conflicting && choice === undefined) return (
    <div className="form-page citizen-request-page">
      <PageHeader title={t('newRequest')} description={t('requestSubtitle')} />
      <Card className="stack citizen-draft-choice">
        <h2>{t('draftConflict')}</h2>
        <p>{t('draftConflictDescription', { saved: t('category.' + active.values.category), requested: t('category.' + requestedCategory) })}</p>
        <div className="form-actions">
          <Button variant="secondary" onClick={() => selectDraft(active)}>{t('continueDraft')}</Button>
          <Button onClick={() => selectDraft(available.find(draft => draft.values.category === requestedCategory) ?? null)}>
            {t('openCategoryDraft', { category: t('category.' + requestedCategory) })}
          </Button>
        </div>
      </Card>
    </div>
  );
  const selected = choice === undefined ? active : choice ?? undefined;
  return <RequestWizard key={selected?.key ?? 'new'} country={country} user={user} saved={selected}
    requestedCategory={requestedCategory} draftKey={key} lookup={lookup}
    otherDrafts={available.filter(draft => draft.key !== selected?.key)} selectDraft={selectDraft} />;
}

function RequestWizard({ country, user, requestedCategory, saved, draftKey, lookup, otherDrafts, selectDraft }: {
  country: string; user: User; requestedCategory?: Category; saved?: SavedRequestDraft; draftKey: string;
  lookup: ReturnType<typeof useQuery<Lookups>>; otherDrafts: SavedRequestDraft[]; selectDraft(draft: SavedRequestDraft): void;
}) {
  const divisions = useDivisions(country);
  const { t } = useTranslation(), navigate = useNavigate(), client = useQueryClient();
  const [step, setStep] = useState(saved?.requestId ? 3 : 0),
    [error, setError] = useState(''),
    [file, setFile] = useState<File | null>(null),
    [fileError, setFileError] = useState(false),
    [draftAvailable, setDraftAvailable] = useState(true),
    [locating, setLocating] = useState(false),
    [searching, setSearching] = useState(false),
    [reverseSearching, setReverseSearching] = useState(false),
    [reverseResults, setReverseResults] = useState(false),
    [geoSearch, setGeoSearch] = useState(''),
    [geoMessage, setGeoMessage] = useState(''),
    [geoResults, setGeoResults] = useState<LocationResult[]>([]),
    [submittedId, setSubmittedId] = useState(saved?.requestId ?? null);
  const [submissionKey] = useState(() => saved?.key ?? crypto.randomUUID());
  const [categoryHelpDescription, setCategoryHelpDescription] = useState('');
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const evidenceInput = useRef<HTMLInputElement>(null);
  const errorSummary = useRef<HTMLParagraphElement>(null);
  const stepChanged = useRef(false);
  const defaults: RequestFormInput = {
    category: requestedCategory ?? null,
    intake: blankIntake,
    description: '',
    locationText: '',
    householdSize: (saved?.values.category ?? requestedCategory) === 'Shelter' ? user.householdSize || 1 : 1,
    quantity: 1,
    unit: '',
    administrativeDivisionId: null,
    accessibilityNeeds: user?.accessibilityNeeds || '',
    crisisId: '',
    organisationId: '',
    requestedForSomeoneElse: false,
    requesterRelationship: '',
    requesterContact: '',
    latitude: null,
    longitude: null,
    synthetic: false,
  };
  const stored = saved?.values;
  const hasOldGpsLabel = !saved?.requestId && stored?.latitude != null && stored.longitude != null &&
    stored.locationText === `${stored.latitude.toFixed(5)}, ${stored.longitude.toFixed(5)}`;
  const initialCategory = stored?.category ?? defaults.category;
  const initialIntake = { ...blankIntake, ...stored?.intake, supplyItems: stored?.intake?.supplyItems ?? [] };
  if (initialCategory && needsQuantity(initialCategory, initialIntake) && !initialIntake.supplyItems?.length) {
    initialIntake.supplyItems = [{
      item: initialCategory === 'FoodWater' ? initialIntake.need : stored?.unit ? t('intake.Medical supplies') : '',
      quantity: stored?.quantity || 1,
      unit: stored?.unit ?? '',
    }];
  }
  const {
    control,
    register,
    watch,
    setFocus,
    setValue,
    getValues,
    trigger,
    handleSubmit,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<RequestFormInput, undefined, RequestForm>({
    resolver: zodResolver(requestSchema),
    defaultValues: { ...defaults, ...stored, intake: initialIntake,
      locationText: hasOldGpsLabel ? '' : stored?.locationText ?? defaults.locationText },
  });
  const { fields: supplyFields, append: addSupply, remove: removeSupply, replace: replaceSupplies } =
    useFieldArray({ control, name: 'intake.supplyItems' });
  const values = watch();
  const category = values.category;
  const userMeasuresQuantity = category !== null && needsQuantity(category, values.intake);
  const stockUnits = useResourceUnitCatalog(userMeasuresQuantity).data;
  const categoryIndex = category === null ? -1 : categories.indexOf(category);
  useEffect(() => {
    if (!category || !userMeasuresQuantity || !Array.isArray(stockUnits)) return;
    values.intake.supplyItems.forEach((line, index) => {
      if (line.unit && !stockUnits.some(unit => unit.code === line.unit && isStockUnitForCategory(unit, category)))
        setValue(`intake.supplyItems.${index}.unit`, '');
    });
  }, [stockUnits, userMeasuresQuantity, category, values.intake.supplyItems, setValue]);
  useEffect(() => {
    if (values.administrativeDivisionId && Array.isArray(divisions.data) &&
        !divisions.data.some(division => division.id === values.administrativeDivisionId))
      setValue('administrativeDivisionId', null);
    if (values.crisisId && lookup.data && !lookup.data.crises.some(crisis => crisis.id === values.crisisId))
      setValue('crisisId', '');
  }, [values.administrativeDivisionId, values.crisisId, divisions.data, lookup.data, setValue]);
  function persistDraft(values: RequestForm, requestId?: string) {
    const draft = { key: submissionKey, values, requestId };
    return saveDrafts(draftKey, [draft, ...listDrafts(draftKey).filter(item => item.key !== draft.key)]);
  }
  useEffect(() => {
    if (category && !submittedId && (isDirty || step > 0 || saved)) {
      setDraftAvailable(persistDraft({ ...values, category }));
    }
  }, [values, category, isDirty, step, submittedId, saved, draftKey, submissionKey]);
  useEffect(() => {
    if (!stepChanged.current) return;
    stepHeading.current?.focus({ preventScroll: true });
    stepHeading.current?.scrollIntoView?.({ block: 'start' });
  }, [step]);
  function goToStep(nextStep: number) {
    setError('');
    stepChanged.current = true;
    setStep(nextStep);
  }
  function resetCategoryFields(category: Category) {
    setValue('intake', blankIntake);
    replaceSupplies(category === 'FoodWater' ? [blankSupplyItem] : []);
    setValue('quantity', 1);
    setValue('unit', '');
    setValue('householdSize', category === 'Shelter' ? user.householdSize || 1 : 1);
  }
  function applyCategoryHelpDescription() {
    if (!getValues('description').trim() && categoryHelpDescription.trim()) {
      setValue('description', categoryHelpDescription, { shouldDirty: true });
    }
  }
  async function next() {
    if (step === 2 && fileError) { evidenceInput.current?.focus(); return; }
    const fields: (keyof RequestForm)[][] = [
      ['category'],
      ['crisisId', 'organisationId', 'intake', 'householdSize', 'quantity', 'unit', 'description', 'requesterRelationship', 'requesterContact'],
      ['locationText', 'intake'],
      [],
    ];
    if (await trigger(fields[step])) {
      if (step === 0) applyCategoryHelpDescription();
      goToStep(step + 1);
    } else {
      setError(t('checkFields'));
      requestAnimationFrame(() => {
        const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)');
        (invalid ?? errorSummary.current)?.focus();
      });
    }
  }
  function locate() {
    setError('');
    setGeoMessage('');
    setGeoResults([]);
    if (!navigator.geolocation) {
      setGeoMessage('locationDenied');
      return;
    }
    const [latitude, longitude, locationText] = getValues(['latitude', 'longitude', 'locationText']);
    const pointIsUnchanged = () => getValues('latitude') === latitude && getValues('longitude') === longitude;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        if (!pointIsUnchanged()) return;
        setValue('latitude', coords.latitude, { shouldDirty: true });
        setValue('longitude', coords.longitude, { shouldDirty: true });
        const useGpsAddress = getValues('locationText') === locationText;
        if (useGpsAddress) setValue('locationText', '', { shouldDirty: true });
        void findAddress(coords.latitude, coords.longitude, useGpsAddress ? '' : locationText);
      },
      () => {
        setLocating(false);
        if (pointIsUnchanged()) setGeoMessage('locationDenied');
      },
      { timeout: 10000 },
    );
  }
  function selectLocationResult(result: LocationResult, useCoordinates: boolean) {
    if (useCoordinates) {
      const [longitude, latitude] = result.geometry.coordinates;
      setValue('longitude', longitude);
      setValue('latitude', latitude);
    }
    setValue('locationText', result.properties.label, { shouldValidate: true, shouldDirty: true });
    setGeoMessage('');
    setGeoResults([]);
  }
  function applyLocationMatches(features: LocationResult[], useCoordinates: boolean, canFill: boolean) {
    if (!features.length) {
      setGeoMessage(useCoordinates ? 'locationNotFound' : 'addressNotFound');
      return;
    }
    if (!canFill) {
      setGeoResults(features);
      return;
    }
    const [match, ...alternatives] = features;
    selectLocationResult(match, useCoordinates);
    if (alternatives.length) {
      setGeoResults(alternatives);
      setGeoMessage('locationBestMatch');
    }
  }
  async function searchLocation() {
    const query = geoSearch.trim();
    if (query.length < 3 || locating || searching || reverseSearching) return;
    const [latitude, longitude, locationText] = getValues(['latitude', 'longitude', 'locationText']);
    setSearching(true);
    setGeoMessage('');
    setGeoResults([]);
    setReverseResults(false);
    try {
      const result = await get<unknown>(
        `/maps/geocode?query=${encodeURIComponent(query)}&countryCode=${encodeURIComponent(country)}`,
      );
      const parsed = locationSearchSchema.safeParse(result);
      if (!parsed.success) {
        setGeoMessage('locationSearchUnavailable');
        return;
      }
      applyLocationMatches(parsed.data.features, true, getValues('latitude') === latitude &&
        getValues('longitude') === longitude && getValues('locationText') === locationText);
    } catch {
      setGeoMessage('locationSearchUnavailable');
    } finally {
      setSearching(false);
    }
  }
  async function findAddress(latitude: number, longitude: number, locationText: string) {
    const pointIsUnchanged = () => getValues('latitude') === latitude && getValues('longitude') === longitude;
    setGeoMessage('');
    setGeoResults([]);
    setReverseSearching(true);
    try {
      const result = await api.post<unknown>(`/maps/reverse-geocode?countryCode=${encodeURIComponent(country)}`, {
        latitude,
        longitude,
      });
      if (!pointIsUnchanged()) return;
      const parsed = locationSearchSchema.safeParse(result.data);
      if (!parsed.success) {
        setGeoMessage('addressNotFound');
        return;
      }
      setReverseResults(true);
      applyLocationMatches(parsed.data.features, false, getValues('locationText') === locationText);
    } catch {
      if (pointIsUnchanged()) setGeoMessage('addressNotFound');
    } finally {
      setReverseSearching(false);
    }
  }
  async function submit(input: RequestForm) {
    setError('');
    try {
      let id = submittedId;
      if (!id) {
        const supplyItems = needsQuantity(input.category, input.intake) ? input.intake.supplyItems : undefined;
        const firstSupply = supplyItems?.[0];
        const r = (await api.post<AidRequest>('/requests', { ...input,
          intake: { ...input.intake, supplyItems },
          quantity: firstSupply?.quantity ?? (input.category === 'Shelter' ? 1 : input.householdSize),
          unit: firstSupply?.unit ?? (input.category === 'Shelter' ? 'household' : 'persons'),
          organisationId: null, submissionKey })).data;
        id = r.id;
        persistDraft(input, id);
        setSubmittedId(id);
      }
      if (file) {
        const body = new FormData();
        body.append('file', file);
        await api.post(`/requests/${id}/attachments`, body);
      }
      saveDrafts(draftKey, listDrafts(draftKey).filter(draft => draft.key !== submissionKey));
      await Promise.all([
        client.invalidateQueries({ queryKey: ['requests'] }),
        client.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
      navigate(`/app/requests/${id}`, { state: { created: true } });
    } catch {
      setError(t('submitError'));
    }
  }
  const descriptionField = <Field
    label={category && descriptionLabels[category] ? t(`intake.description.${category}`, { defaultValue: descriptionLabels[category] }) : t('description')}
    hint={t('descriptionHint')} error={errors.description ? t('checkFields') : undefined}>
    <textarea rows={3} {...register('description')} />
  </Field>;
  return (
    <div className="form-page citizen-request-page">
      <PageHeader title={t('newRequest')} description={t('requestSubtitle')} />
      <ol className="form-steps" aria-label={t('tracking')}>
        {[1, 2, 3, 4].map((n, index) => (
          <li
            key={n}
            className={index <= step ? 'active' : ''}
            aria-current={step === index ? 'step' : undefined}
          >
            <span>{index < step ? <Check size={16} /> : n}</span>
            <small>{t('step' + n)}</small>
          </li>
        ))}
      </ol>
      <Card>
        {step === 0 && !!otherDrafts.length && <details className="citizen-other-drafts">
          <summary>{t('otherSavedDrafts')}</summary>
          <div className="inline">{otherDrafts.map(draft => <Button key={draft.key} variant="secondary"
            onClick={() => selectDraft(draft)}>{t('openCategoryDraft', { category: t('category.' + draft.values.category) })}</Button>)}</div>
        </details>}
        <form ref={formRef} onSubmit={event => {
          if (step === 3) void handleSubmit(submit, () => {
            setError(t('checkFields'));
            requestAnimationFrame(() => errorSummary.current?.focus());
          })(event);
          else event.preventDefault();
        }} className="stack">
          {step === 0 && (
            <>
              <h2 ref={stepHeading} tabIndex={-1}>{t('helpTitle')}</h2>
              <RequestCategoryHelp country={country} draftKey={submissionKey} description={categoryHelpDescription}
                onDescription={setCategoryHelpDescription}
                onReceipt={receipt => setValue('categoryReceipt', receipt, { shouldDirty: true })}
                onChoose={category => {
                  applyCategoryHelpDescription();
                  if (getValues('category') !== category) {
                    setValue('category', category, { shouldDirty: true });
                    resetCategoryFields(category);
                  }
                  goToStep(1);
                }} />
              <div className="category-options">
                {categories.map((category, index) => {
                  const Icon = icons[index];
                  return (
                    <label
                      className={`category-option ${values.category === category ? 'selected' : ''}`}
                      key={category}
                    >
                      <input type="radio" value={category} {...register('category', { onChange: () => {
                        const selected = getValues('category');
                        if (selected) resetCategoryFields(selected);
                      } })} />
                      <IconTile
                        icon={Icon}
                        tone={['coral', 'blue', 'yellow', 'green', 'purple', 'blue'][index]}
                      />
                      <span>
                        <strong>{t('category.' + category)}</strong>
                        <small>
                          {t('desc.' + category)}
                        </small>
                      </span>
                      <ArrowRight size={19} />
                    </label>
                  );
                })}
              </div>
            </>
          )}
          {step === 1 && category && (
            <>
              <div className="citizen-intake-heading">
                <h2 ref={stepHeading} tabIndex={-1}>{t('step2')}</h2>
                <IconTile icon={icons[categoryIndex] ?? MoreHorizontal} tone={['coral', 'blue', 'yellow', 'green', 'purple', 'blue'][categoryIndex]} />
                <strong>{t('category.' + values.category)}</strong>
              </div>
              {lookup.isPending ? (
                <Loading />
              ) : lookup.error ? (
                <ErrorState error={lookup.error} retry={() => void lookup.refetch()} />
              ) : (
                <div className="form-grid">
                  <Field label={t('crisis')} error={errors.crisisId ? t('checkFields') : undefined}>
                    <select {...register('crisisId')}>
                      <option value="">{t('selectOption')}</option>
                      {lookup.data?.crises.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}
              {values.category === 'Other' && descriptionField}
              <CitizenIntakeFields category={category} value={values.intake}
                flagControls={<IntakeFlags category={category} register={register} />}
                renderField={question => <IntakeQuestion question={question} register={register}
                  onNeedChange={values.category === 'Medical' ? need => {
                    setValue('intake.timing', '');
                    replaceSupplies(need === 'MedicalSupplies' ? [blankSupplyItem] : []);
                  } : undefined}
                  error={errors.intake?.[question.key] ? t('checkFields') : undefined} />}
                people={<Field label={t(`intake.people.${category}`, { defaultValue: peopleLabels[category] })}
                  error={errors.householdSize ? t('checkFields') : undefined}>
                  <input type="number" min={1} max={50} {...register('householdSize', { valueAsNumber: true })} />
                </Field>}
                supplies={userMeasuresQuantity && <section className="citizen-supplies" aria-labelledby="citizen-supplies-title">
                <div>
                  <h3 id="citizen-supplies-title">{t('intake.requestedItems')}</h3>
                  <p className="muted">{t('intake.supplyLimit')}</p>
                </div>
                <div className="citizen-supply-list">
                  {supplyFields.map((field, index) => {
                    const name = `intake.supplyItems.${index}` as const;
                    const line = values.intake.supplyItems[index] ?? field;
                    const errorsForItem = errors.intake?.supplyItems?.[index];
                    const step = isMeasuredUnit(line.unit) ? 0.01 : 1;
                    return <fieldset key={field.id} className="citizen-supply-row">
                      <legend>{t('intake.supplyItemNumber', { number: index + 1 })}</legend>
                      <Field label={t(values.category === 'FoodWater' ? 'intake.Which item do you need?' : 'intake.supplyName')}
                        error={errorsForItem?.item ? t('intake.supplyItemError') : undefined}>
                        {values.category === 'FoodWater' ?
                          <select {...register(`${name}.item`)}>
                            <option value="">{t('selectOption')}</option>
                            {Object.entries(foodItems).map(([code, label]) => <option key={code} value={code}
                              disabled={values.intake.supplyItems.some((other, i) => i !== index && other.item === code)}>
                              {t(`intake.${label}`)}
                            </option>)}
                          </select> :
                          <input maxLength={120} {...register(`${name}.item`)} />}
                      </Field>
                      <Field label={t('quantity')} error={errorsForItem?.quantity ? t('checkFields') : undefined}>
                        <input type="number" min={step} max={100000} step={step}
                          {...register(`${name}.quantity`, { valueAsNumber: true })} />
                      </Field>
                      <Field label={t('measurementUnit')} error={errorsForItem?.unit ? t('selectMeasurementUnit') : undefined}>
                        <ResourceUnitSelect {...register(`${name}.unit`)} category={category} value={line.unit} />
                      </Field>
                      {supplyFields.length > 1 && <Button type="button" variant="ghost"
                        className="button ghost citizen-supply-remove" aria-label={t('intake.removeSupplyNumber', { number: index + 1 })}
                        onClick={() => {
                          removeSupply(index);
                          requestAnimationFrame(() => setFocus(`intake.supplyItems.${Math.min(index, supplyFields.length - 2)}.item`));
                        }}>
                        <Trash2 size={16} aria-hidden="true" />{t('intake.removeSupply')}
                      </Button>}
                    </fieldset>;
                  })}
                </div>
                <Button type="button" variant="secondary" disabled={supplyFields.length >= maxSupplyItems}
                  onClick={() => addSupply(blankSupplyItem, { focusName: `intake.supplyItems.${supplyFields.length}.item` })}>
                  <Plus size={18} aria-hidden="true" />{t('intake.addSupply')}
                </Button>
                </section>}
              />
              {values.category === 'Transportation' && <p className="muted">
                {t('intake.transportLocationHint', { defaultValue: 'Add your pickup point and destination in Location.' })}
              </p>}
              {values.category !== 'Other' && descriptionField}
              <label className="checkbox-label">
                <input type="checkbox" {...register('requestedForSomeoneElse')} />
                <span>{t('requestForSomeoneElse')}</span>
              </label>
              {values.requestedForSomeoneElse && (
                <div className="form-grid">
                  <Field label={t('requesterRelationship')} error={errors.requesterRelationship ? t('checkFields') : undefined}>
                    <input maxLength={200} {...register('requesterRelationship')} />
                  </Field>
                  <Field label={t('requesterContact')} error={errors.requesterContact ? t('checkFields') : undefined}>
                    <input maxLength={500} {...register('requesterContact')} />
                  </Field>
                </div>
              )}
            </>
          )}
          {step === 2 && (
            <>
              <h2 ref={stepHeading} tabIndex={-1}>{t('location')}</h2>
              <RegionField key={country} initialDivisionId={values.administrativeDivisionId} hideDistrictSuffix
                onChange={id => setValue('administrativeDivisionId', id)} />
              <Field
                label={values.category === 'Transportation' ? t('intake.pickup', { defaultValue: 'Pickup point' }) : t('location')}
                hint={t('locationHint')}
                error={errors.locationText ? t('checkFields') : undefined}
              >
                <input {...register('locationText')} />
              </Field>
              {values.category === 'Transportation' && <Field label={t('intake.destination', { defaultValue: 'Destination' })}
                hint={t('intake.destinationHint', { defaultValue: 'Add an address or landmark if you know where you need to go.' })}
                error={errors.intake?.destination ? t('checkFields') : undefined}>
                <input maxLength={500} {...register('intake.destination')} />
              </Field>}
              <div className="inline">
                <Button variant="secondary" type="button" busy={locating} disabled={searching || reverseSearching} onClick={locate}>
                  <MapPin size={18} />
                  {t('locateMe')}
                </Button>
                {values.latitude != null && values.longitude != null && (
                  <Button variant="secondary" type="button" busy={reverseSearching} disabled={locating || searching}
                    onClick={() => {
                      const [latitude, longitude, label] = getValues(['latitude', 'longitude', 'locationText']);
                      if (latitude != null && longitude != null) void findAddress(latitude, longitude, label);
                    }}>
                    {t('findAddress')}
                  </Button>
                )}
              </div>
              {reverseSearching && <p className="muted" role="status">{t('findingAddress')}</p>}
              <div className="inline">
                <input
                  aria-label={t('searchLocation')}
                  placeholder={t('searchLocation')}
                  value={geoSearch}
                  maxLength={150}
                  readOnly={searching}
                  onChange={(e) => {
                    setGeoSearch(e.target.value);
                    setGeoMessage('');
                    setGeoResults([]);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void searchLocation();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  busy={searching}
                  disabled={geoSearch.trim().length < 3 || locating || reverseSearching}
                  onClick={() => void searchLocation()}
                >
                  {t('searchLocation')}
                </Button>
              </div>
              {geoMessage && <p className={geoMessage === 'locationBestMatch' ? 'muted' : 'field-error'} role="status">{t(geoMessage)}</p>}
              {!!geoResults.length && !geoMessage && <p className="muted" role="status">
                {t(reverseResults ? 'chooseAddressResult' : 'chooseLocationResult')}
              </p>}
              {geoResults.map((r, index) => (
                <button
                  className="location-result"
                  type="button"
                  key={index}
                  onClick={() => selectLocationResult(r, !reverseResults)}
                >
                  {r.properties.label}
                </button>
              ))}
              <MapView
                initialCenter={country === 'LK' ? undefined : countryMapCenters[country]}
                initialZoom={country === 'IN' ? 5 : country === 'NP' ? 7 : 12}
                point={values.latitude !== null ? [values.latitude, values.longitude!] : undefined}
                onPick={(lat, lng) => {
                  setGeoMessage('');
                  setGeoResults([]);
                  setValue('latitude', lat);
                  setValue('longitude', lng);
                }}
              />
              <Field label={t('evidence')} hint={t('evidenceHint')} error={fileError ? t('invalidEvidence') : undefined}>
                <input
                  type="file"
                  ref={evidenceInput}
                  accept="image/png,image/jpeg"
                  onChange={(e) => {
                    const selected = e.target.files?.[0];
                    const invalid = !!selected && (selected.size < 8 || selected.size > 4 * 1024 * 1024 ||
                      !['image/png', 'image/jpeg'].includes(selected.type));
                    setFileError(invalid);
                    setFile(invalid ? null : selected ?? null);
                    if (invalid) e.target.value = '';
                  }}
                />
              </Field>
              {file && <div className="inline citizen-selected-file"><span>{file.name}</span>
                <Button type="button" variant="ghost" onClick={() => {
                  setFile(null);
                  const input = evidenceInput.current;
                  if (input) { input.value = ''; input.focus(); }
                }}>{t('removeEvidence')}</Button></div>}
              {fileError && <Button type="button" variant="ghost" onClick={() => setFileError(false)}>{t('continueWithoutEvidence')}</Button>}
            </>
          )}
          {step === 3 && category && (
            <>
              <h2 ref={stepHeading} tabIndex={-1}>{t('reviewTitle')}</h2>
              <dl className="review-grid">
                <dt>{t('step1')}</dt>
                <dd>{t('category.' + values.category)}</dd>
                <dt>{t('crisis')}</dt>
                <dd>{lookup.data?.crises.find((crisis) => crisis.id === values.crisisId)?.name || '—'}</dd>
                <dt>{t('description')}</dt>
                <dd>{values.description}</dd>
                <IntakeSummary category={category} value={values.intake} />
                <dt>{t(`intake.people.${category}`, { defaultValue: peopleLabels[category] })}</dt>
                <dd>{values.householdSize}</dd>
                {values.requestedForSomeoneElse && <>
                  <dt>{t('requesterRelationship')}</dt><dd>{values.requesterRelationship || '—'}</dd>
                  <dt>{t('requesterContact')}</dt><dd>{values.requesterContact || '—'}</dd>
                </>}
                <dt>{t(values.category === 'Transportation' ? 'intake.pickup' : 'location')}</dt>
                <dd>{values.locationText}</dd>
                {values.administrativeDivisionId && Array.isArray(divisions.data) && <>
                  <dt>{t('administrativeRegion')}</dt>
                  <dd>{divisions.data.find(d => d.id === values.administrativeDivisionId)?.name}</dd>
                </>}
                <dt>{t('evidence')}</dt>
                <dd>{file?.name || '—'}</dd>
              </dl>
              <p className="privacy-note">
                <ShieldCheck size={18} />
                {t('privacyText')}
              </p>
            </>
          )}
          {error && (
            <p className="field-error" role="alert" ref={errorSummary} tabIndex={-1}>
              {error}
            </p>
          )}
          <div className="form-actions">
            {step > 0 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => goToStep(step - 1)}
                disabled={isSubmitting || !!submittedId}
              >
                <ArrowLeft size={17} />
                {t('back')}
              </Button>
            )}
            {step < 3 ? (
              <Button
                key="continue"
                type="button"
                busy={step === 1 && lookup.isPending}
                disabled={(step === 0 && !category) || (step === 1 && !lookup.isSuccess)}
                onClick={(event) => {
                  event.preventDefault();
                  void next();
                }}
              >
                {t('next')}
                <ArrowRight size={18} />
              </Button>
            ) : (
              <Button key="submit" type="submit" busy={isSubmitting}>
                {t('submitRequest')}
                <Check size={18} />
              </Button>
            )}
          </div>
          {!draftAvailable && <small className="muted center">{t('draftUnavailable')}</small>}
          {submittedId && error && (
            <NextLink to={`/app/requests/${submittedId}`}>{t('viewRequest')}</NextLink>
          )}
        </form>
      </Card>
    </div>
  );
}
export function RequestTracking() {
  const { id } = useParams(),
    { t, i18n } = useTranslation(),
    location = useLocation(),
    client = useQueryClient(), country = useCountry();
  const queryKey = ['request', id, country];
  const query = useQuery({
    queryKey,
    queryFn: () => get<RequestDetail>(`/requests/${id}`),
    refetchInterval: query => query.state.data?.request.assessmentState === 'Pending' ? 2500 :
      query.state.data && activeStatuses.has(query.state.data.request.status) ? 30000 : false,
  });
  const [error, setError] = useState(false);
  const mutation = useMutation({
    mutationFn: async (e: HTMLFormElement) => {
      const f = new FormData(e);
      const response = await api.post<NonNullable<RequestDetail['feedback']>[number]>(`/requests/${id}/feedback`, {
        rating: Number(f.get('rating')),
        received: f.get('received') === 'on',
        problem: f.get('problem') === 'on',
        comment: f.get('comment'),
      });
      return response.data;
    },
    onSuccess: (feedback) => {
      client.setQueryData<RequestDetail>(queryKey, current => current && { ...current, feedback: [feedback] });
      void client.invalidateQueries({ queryKey: ['request', id] });
    },
  });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const data = query.data!,
    r = data.request;
  const people = baseUnit(r.unit) === 'persons';
  const displayUnit = people ? '' : r.category === 'Shelter' ? t('shelterQuantity') : unitSymbol(r.unit);
  const feedback = data.feedback?.[0];
  async function download(fileId: string, name: string) {
    setError(false);
    try {
      const response = await api.get(`/requests/${id}/attachments/${fileId}`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(true);
    }
  }
  return (
    <div className="citizen-page citizen-tracking">
      <NextLink to="/app/requests">{t('myRequests')}</NextLink>
      {(location.state as { created?: boolean } | null)?.created && (
        <div className="success-banner" role="status">
          <CheckCircle2 />
          {t('requestSaved')} · {r.reference}
        </div>
      )}
      <PageHeader
        title={t('category.' + r.category)}
        description={`${r.reference} · ${formatDate(r.createdAt, i18n.language)}`}
        action={<Badge value={r.status} />}
      />
      {r.status === 'Verified' && <p className="muted">{t('verifiedAwaitingCaseApproval')}</p>}
      {data.consolidations?.map(link => link.originalId === r.id
        ? <p key={link.originalId}>Follow the active request <Link to={`/app/requests/${link.primaryId}`}>{link.primaryReference}</Link>.</p>
        : <p key={link.originalId}>Consolidated original request <Link to={`/app/requests/${link.originalId}`}>{link.originalReference}</Link>.</p>)}
      <div className="citizen-tracking-columns">
        <div className="stack">
          <Card>
            <h2>{t('details')}</h2>
            <p>{r.description}</p>
            <dl className="review-grid">
              <dt>{t(r.category === 'Transportation' ? 'intake.pickup' : 'location')}</dt>
              <dd>{r.locationText}</dd>
              {data.administrativeRegion && <>
                <dt>{t('administrativeRegion')}</dt><dd>{data.administrativeRegion}</dd>
              </>}
              <dt>{t('householdSize')}</dt>
              <dd>{r.householdSize}</dd>
              <dt>{t('priority')}</dt>
              <dd>
                <Badge value={r.priority} />
              </dd>
              {data.items?.length ? data.items.map(item => <Fragment key={item.id}>
                <dt>{r.category === 'FoodWater' ? t(`intake.${item.name}`, { defaultValue: item.name }) : item.name}</dt>
                <dd>{t(baseUnit(item.unit) === 'persons' ? 'intake.peopleProgress' : 'deliveredAmount', { delivered: item.deliveredQuantity,
                  requested: item.approvedQuantity || item.requiredQuantity, unit: unitSymbol(item.unit) })}
                  <br /><small>{t('outstanding')} {Number((Math.max(0, (item.approvedQuantity || item.requiredQuantity) - item.deliveredQuantity)).toFixed(5))} {unitSymbol(item.unit)}</small></dd>
              </Fragment>) : <><dt>{t(people ? 'intake.peopleHelped' : 'delivered')}</dt>
              <dd>
                {r.deliveredQuantity} / {r.quantity} {displayUnit}
              </dd>
              <dt>{t(people ? 'intake.peopleWaiting' : 'outstanding')}</dt>
              <dd>{Number((Math.max(0, r.quantity - r.deliveredQuantity)).toFixed(5))} {displayUnit}</dd>
              {r.unitRequiresClarification && <dd>{t('unitRequiresClarification')}</dd>}</>}
            </dl>
            {!data.items?.length && <RequestProgress request={r} />}
            {r.intake && <details className="citizen-submitted-answers">
              <summary>{t('intake.submittedAnswers')}</summary>
              <dl className="review-grid"><IntakeSummary category={r.category} value={r.intake} /></dl>
            </details>}
            {!r.requiresCentreHandover && data.allocations.filter((a) => a.status !== 'Cancelled').length > 0 && (
              <section aria-label={t('deliverySteps')}>
                <h3>{t('deliverySteps')}</h3>
                {data.allocations.filter((a) => a.status !== 'Cancelled').map((a) => (
                  <p key={a.id}>{a.confirmedQuantity ?? a.quantity} {unitSymbol(a.unit)} · {t('delivery.' + a.status)}</p>
                ))}
              </section>
            )}
            {!!data.placements?.length && <section className="citizen-placement-list" aria-label={t('shelterPlacements')}>
              <h3>{t('shelterPlacements')}</h3>
              <ul>{data.placements.map(placement => <li key={placement.id}>
                <span>{placement.shelterName ?? t('shelters')} · {t('peopleCount', { count: placement.people })}</span>
                <Badge value={placement.status} />
              </li>)}</ul>
            </section>}
            {data.attachments.length > 0 && (
              <>
                <h3>{t('attachments')}</h3>
                {data.attachments.map((a) => (
                  <Button
                    key={a.id}
                    variant="secondary"
                    onClick={() => void download(a.id, a.originalName)}
                  >
                    {a.originalName}
                  </Button>
                ))}
              </>
            )}
          </Card>
          {r.requiresCentreHandover && <CaseDispatches id={r.id} mode="citizen" />}
          {(feedback || ['PartiallyFulfilled', 'Fulfilled', 'Closed'].includes(r.status)) && (
            <Card>
              <h2>{t('feedback')}</h2>
              {feedback ? (
                <div className="citizen-feedback-receipt" role="status">
                  <p className="success-text">{t('feedbackSaved')}</p>
                  <time dateTime={feedback.createdAt}>{formatDate(feedback.createdAt, i18n.language)}</time>
                  {feedback.problem && <p>{t('problemRecorded')}</p>}
                </div>
              ) : (
                <form
                  className="stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    mutation.mutate(e.currentTarget);
                  }}
                >
                  <Field label={t('rating')}>
                    <select name="rating">
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </Field>
                  <label className="checkbox-label">
                    <input type="checkbox" name="received" />
                    {t('received')}
                  </label>
                  <label className="checkbox-label">
                    <input type="checkbox" name="problem" />
                    {t('reportProblem')}
                  </label>
                  <Field label={t('comment')}>
                    <textarea name="comment" maxLength={2000} />
                  </Field>
                  <Button busy={mutation.isPending}>{t('sendFeedback')}</Button>
                  {mutation.error && <ErrorState error={mutation.error} />}
                </form>
              )}
            </Card>
          )}
        </div>
        <Card className="citizen-tracking-timeline">
          <h2>{t('tracking')}</h2>
          <ol className="timeline">
            {data.history.map((h, index) => (
              <li key={h.id}>
                <span className="timeline-dot">
                  {index === data.history.length - 1 ? <Check size={13} /> : null}
                </span>
                <Badge value={h.status} />
                <time dateTime={h.createdAt}>{formatDate(h.createdAt, i18n.language)}</time>
                <p>{i18n.language === 'en' ? h.note : t('status.' + h.status)}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {t('serviceError')}
        </p>
      )}
    </div>
  );
}

function notificationMessage(notification: Notification, language: string) {
  const localised = language === 'si' ? notification.sinhalaMessage : language === 'ta' ? notification.tamilMessage :
    language === 'hi' ? notification.hindiMessage : language === 'ne' ? notification.nepaliMessage : undefined;
  return localised || notification.message.replace(/: Aid allocation: Cancel\.$/, ': A stock reservation was released.');
}
export function NotificationsPage() {
  const { user } = useAuth();
  const location = useLocation();
  const inboxRole = notificationInboxRole(user, location.pathname, location.search);
  const donor = inboxRole === 'Donor', funding = inboxRole === 'FundingOfficer';
  const fundingInbox = donor || funding;
  const volunteerCoordinator = inboxRole === 'VolunteerCoordinator';
  const coordinator = inboxRole === 'Coordinator';
  const logistics = inboxRole === 'Logistics';
  const citizen = inboxRole === 'Citizen';
  const isAdministrator = inboxRole === 'Administrator' || inboxRole === 'CountryAdministrator';
  const country = useCountry();
  const adminAlerts = useQuery({ queryKey: ['admin-alerts-bell', country], enabled: isAdministrator, queryFn: () => get<{ acknowledgedAt?: string; resolvedAt?: string }[]>(`/admin/alerts?countryCode=${country}`), refetchInterval: 60000 });
  const attention = Array.isArray(adminAlerts.data) ? adminAlerts.data.filter(a => !a.acknowledgedAt && !a.resolvedAt).length : 0;
  const { t, i18n } = useTranslation(),
    client = useQueryClient();
  const [showRead, setShowRead] = useState(false);
  const inboxScope = { inboxRole, countryCode: country };
  const q = useQuery({
    queryKey: ['notifications', 'list', user?.id, country, inboxRole, showRead ? 'all' : 'unread'],
    queryFn: () => get<Notification[]>(`/notifications?${new URLSearchParams({ ...inboxScope, ...(!showRead && { unreadOnly: 'true' }) })}`),
    refetchInterval: 15000,
  });
  const unread = useQuery({
    queryKey: ['notifications', 'unread', user?.id, country, inboxRole],
    queryFn: () => get<{ count: number }>(`/notifications/unread-count?${new URLSearchParams(inboxScope)}`),
  });
  const hasUnread = (unread.data?.count ?? 0) > 0 || q.data?.some((n) => !n.read);
  const mutation = useMutation({
    mutationFn: (id?: string) =>
      api.post(id ? `/notifications/${id}/read` : '/notifications/read-all', undefined, {
        params: inboxScope,
      }),
    onSuccess: (_, id) => {
      if (id === undefined) setShowRead(false);
      return client.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  const showReadControl = <label className="checkbox-label">
    <input type="checkbox" checked={showRead} onChange={event => setShowRead(event.target.checked)} disabled={mutation.isPending} />
    {t('showReadNotifications')}
  </label>;
  return (
    <div className={citizen ? 'citizen-page citizen-notifications' : fundingInbox ? 'funding-inbox' : undefined}>
      <PageHeader
        title={t('notifications')}
        action={
          <Button
            type="button"
            variant="secondary"
            onClick={() => mutation.mutate(undefined)}
            disabled={!hasUnread || mutation.isPending}
            busy={mutation.isPending && mutation.variables === undefined}
          >
            {t('markAllRead')}
          </Button>
        }
      />
      <BrowserPushSettings />
      {isAdministrator && <Card><h2>Administrator alerts</h2><p>{attention} operational issues need attention.</p><Link to="/admin?section=alerts">Review administrator alerts</Link></Card>}
      {citizen ? <div className="filter-tabs" role="group" aria-label={t('notifications')}>
        <button type="button" aria-pressed={!showRead} className={!showRead ? 'selected' : ''}
          disabled={mutation.isPending} onClick={() => setShowRead(false)}>{t('unreadNotifications')}
          {!!unread.data?.count && <span className="citizen-notification-count">{unread.data.count}</span>}</button>
        <button type="button" aria-pressed={showRead} className={showRead ? 'selected' : ''}
          disabled={mutation.isPending} onClick={() => setShowRead(true)}>{t('allNotifications')}</button>
      </div> : fundingInbox ? <div className="funding-inbox-tools">{showReadControl}
        <Link to={donor ? '/donor/activity' : '/funding/manage/activity'}>View donation activity</Link>
      </div> : showReadControl}
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : q.data?.length ? (
        <div className={fundingInbox ? 'funding-panel funding-inbox-list' : 'stack'}>
          {q.data.map((n) => {
            const shipment = n.allocationId && new URLSearchParams({ tab: 'dispatches', record: n.allocationId });
            const shipmentLink = shipment && (coordinator && n.requestId
              ? coordinatorPath(`/cases/${n.requestId}`, { shipment: n.allocationId! })
              : isAdministrator || logistics
                ? `${isAdministrator && !logistics ? '/admin' : '/staff'}/resources?${shipment}${logistics ? '&role=Logistics' : ''}`
                : null);
            return (
            <Card key={n.id} className={n.read ? 'notification read' : 'notification'}>
              {fundingInbox ? <span className="funding-inbox-marker" data-unread={!n.read} aria-hidden="true" /> : <IconTile icon={Bell} />}
              <div>
                {citizen && <div className="citizen-notification-meta"><strong>{t(n.requestId ? 'requestUpdate' : n.crisisId ? 'crisisUpdate' : 'notifications')}</strong>
                  <small>{t(n.read ? 'notificationRead' : 'unreadNotifications')}</small></div>}
                <p>{notificationMessage(n, i18n.language)}</p>
                {n.communicationSource && <small className="muted">{n.communicationSource} · Reviewed</small>}
                {!fundingInbox && <time className="muted" dateTime={n.createdAt}>{formatDate(n.createdAt, i18n.language)}</time>}
                {isAdministrator && n.scopeOrganisationId && (n.scopeRole === 'Administrator' || n.scopeRole === 'CountryAdministrator') ? (
                  <NextLink to={`/admin?section=organisations&organisation=${encodeURIComponent(n.scopeOrganisationId)}`}>View partner registration</NextLink>
                ) : n.scopeRole === 'Donor' ? (
                  !donor && <NextLink to="/donor/donations">View donations and pledges</NextLink>
                ) : n.scopeRole === 'FundingOfficer' ? (
                  <NextLink to={isAdministrator ? '/admin/funding/donations' : '/funding/manage/donations'}>View donations and pledges</NextLink>
                ) : n.scopeRole === 'Partner' ? (
                  <NextLink to={isAdministrator ? '/admin/partner-commitments' : n.crisisId ? '/partner/work' : '/partner/contributions'}>
                    {isAdministrator ? 'Partner commitments' : n.crisisId ? 'Assigned work' : 'Contributions & commitments'}
                  </NextLink>
                ) : inboxRole === 'ShelterAdmin' ? (
                  <NextLink to={shelterPath(n.requestId ? '/shelters' : '/supply-support')}>{n.requestId ? t('staffShelters') : 'Supply support'}</NextLink>
                ) : n.scopeRole === 'Logistics' ? (
                  !shipmentLink && <NextLink to={n.requestId ? `/staff/cases/${n.requestId}?role=Logistics` : '/staff/resources?role=Logistics'}>{t(n.requestId ? 'viewRequest' : 'staffResources')}</NextLink>
                ) : volunteerCoordinator && (n.taskId || n.scopeRole === 'VolunteerCoordinator' && !n.scopeCountryCode) ? (
                  <NextLink to="/staff/volunteers?role=VolunteerCoordinator&view=reports">Reports awaiting verification</NextLink>
                ) : volunteerCoordinator && n.requestId ? (
                  <NextLink to={`/staff/volunteers?role=VolunteerCoordinator&view=assign&case=${encodeURIComponent(n.requestId)}`}>View case for assignment</NextLink>
                ) : coordinator && (n.requestId || n.crisisId) ? (
                  <NextLink to={n.requestId ? coordinatorPath(`/cases/${n.requestId}`) :
                    coordinatorPath('/crises', { crisisId: n.crisisId! })}>{t(n.requestId ? 'viewRequest' : 'staffCrises')}</NextLink>
                ) : (n.taskId || n.requestId || n.crisisId) && (
                  <NextLink to={n.taskId ? '/volunteer' : n.requestId ? `${n.isInternal ? isAdministrator ? '/admin/cases' : '/staff/cases' : '/app/requests'}/${n.requestId}${inboxRole === 'CaseManager' ? '?role=CaseManager' : ''}` :
                    isAdministrator ? '/admin/crises' : '/staff/crises'}>{t(n.taskId ? 'staffVolunteers' : n.requestId ? 'viewRequest' : 'staffCrises')}</NextLink>
                )}
                {shipmentLink && <NextLink to={shipmentLink}>View shipment</NextLink>}
              </div>
              {fundingInbox && <time className="muted" dateTime={n.createdAt}>{formatDate(n.createdAt, i18n.language)}</time>}
              {!n.read && (
                <Button
                  variant="ghost"
                  onClick={() => mutation.mutate(n.id)}
                  disabled={mutation.isPending}
                  busy={mutation.isPending && mutation.variables === n.id}
                >
                  {t('markRead')}
                </Button>
              )}
            </Card>
            );
          })}
          {donor && <div className="funding-inbox-footer"><NextLink to="/donor/donations">View donations and pledges</NextLink></div>}
        </div>
      ) : (
        <Card><Empty title={t(showRead ? 'noNotifications' : 'noUnreadNotifications')} /></Card>
      )}
      {mutation.error && <ErrorState error={mutation.error} />}
    </div>
  );
}
