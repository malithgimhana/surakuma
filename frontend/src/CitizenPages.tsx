import { useEffect, useState } from 'react';
import { isAxiosError } from 'axios';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
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
  Heart,
  House,
  MapPin,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  Stethoscope,
  Utensils,
} from 'lucide-react';
import { api, get } from './api';
import { landing, loginDestination, useAuth } from './auth';
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
import { MapView } from './MapView';
import type {
  AidRequest,
  Category,
  Lookups,
  Notification,
  Page,
  RequestDetail,
  User,
} from './types';

export function AuthPage({ register = false }: { register?: boolean }) {
  const { t, i18n } = useTranslation(),
    { signIn } = useAuth(),
    navigate = useNavigate(),
    location = useLocation();
  const [error, setError] = useState<'authError' | 'authThrottle' | null>(null);
  const {
    register: field,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<{ name: string; email: string; password: string }>();
  async function submit(values: { name: string; email: string; password: string }) {
    setError(null);
    try {
      const user = await signIn(register ? '/auth/register' : '/auth/login', {
        ...values,
        language: i18n.language,
      });
      navigate(loginDestination(user, (location.state as { from?: string } | null)?.from));
    } catch (failure) {
      setError(
        isAxiosError(failure) && failure.response?.status === 429 ? 'authThrottle' : 'authError',
      );
    }
  }
  return (
    <div className="container auth-page">
      <div className="auth-story">
        <span className="eyebrow">{t('communityTag')}</span>
        <h1>
          {t('heroTitle')}
          <br />
          <span className="coral-text">{t('heroAccent')}</span>
        </h1>
        <CommunityArt />
        <p>{t('footerTag')}</p>
      </div>
      <Card className="auth-card">
        <IconTile icon={Heart} tone="coral" />
        <h1>{t(register ? 'register' : 'welcomeBack')}</h1>
        <p className="muted">{t(register ? 'registerSubtitle' : 'loginSubtitle')}</p>
        <form onSubmit={handleSubmit(submit)} className="stack">
          {register && (
            <Field label={t('name')} error={errors.name ? t('checkFields') : undefined}>
              <input autoComplete="name" {...field('name', { required: true, maxLength: 100 })} />
            </Field>
          )}
          <Field label={t('email')} error={errors.email ? t('checkFields') : undefined}>
            <input type="email" autoComplete="email" {...field('email', { required: true })} />
          </Field>
          <Field
            label={t('password')}
            hint={register ? t('passwordHint') : undefined}
            error={errors.password ? t('checkFields') : undefined}
          >
            <input
              type="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              {...field('password', { required: true, minLength: register ? 10 : 1 })}
            />
          </Field>
          {error && (
            <p className="field-error" role="alert">
              {t(error)}
            </p>
          )}
          <Button type="submit" busy={isSubmitting}>
            {t(register ? 'register' : 'login')}
            <ArrowRight size={18} />
          </Button>
        </form>
        <p className="auth-switch">
          {t(register ? 'haveAccount' : 'noAccount')}{' '}
          <Link to={register ? '/login' : '/register'} state={location.state}>
            {t(register ? 'login' : 'register')}
          </Link>
        </p>
        <div className="privacy-note">
          <ShieldCheck size={17} />
          {t('privacyText')}
        </div>
      </Card>
    </div>
  );
}
export function RequestRows({ items }: { items: AidRequest[] }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="request-list">
      {items.map((r) => (
        <Link key={r.id} to={`/app/requests/${r.id}`} className="request-row">
          <IconTile
            icon={
              r.category === 'Shelter' ? House : r.category === 'Medical' ? Stethoscope : Utensils
            }
            tone={r.category === 'Shelter' ? 'yellow' : r.category === 'Medical' ? 'blue' : 'coral'}
          />
          <div className="request-row-main">
            <strong>{t('category.' + r.category)}</strong>
            <small>
              {r.reference} · {formatDate(r.createdAt, i18n.language)}
            </small>
          </div>
          <Badge value={r.status} />
          <ArrowRight size={18} />
        </Link>
      ))}
    </div>
  );
}
export function CitizenOverview() {
  const { user } = useAuth(),
    { t } = useTranslation();
  const q = useQuery({
    queryKey: ['requests', 'mine'],
    queryFn: () => get<Page<AidRequest>>('/requests/mine'),
  });
  return (
    <>
      <PageHeader
        eyebrow={t('communityTag')}
        title={t('welcome', { name: user?.name.split(' ')[0] })}
        description={t('overviewSubtitle')}
        action={
          <Link to="/app/requests/new" className="button primary">
            <Plus size={19} />
            {t('newRequest')}
          </Link>
        }
      />
      <div className="citizen-welcome">
        <div>
          <span className="eyebrow">{t('careTag')}</span>
          <h2>{t('helpTitle')}</h2>
          <p>{t('helpSubtitle')}</p>
          <NextLink to="/app/requests/new">{t('requestHelp')}</NextLink>
        </div>
        <CommunityArt />
      </div>
      <section className="section-small">
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
    </>
  );
}
export function MyRequests() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1),
    [status, setStatus] = useState('');
  const q = useQuery({
    queryKey: ['requests', 'mine', page, status],
    queryFn: () => get<Page<AidRequest>>(`/requests/mine?page=${page}&status=${status}`),
  });
  return (
    <>
      <PageHeader
        title={t('myRequests')}
        action={
          <Link className="button primary" to="/app/requests/new">
            <Plus size={18} />
            {t('newRequest')}
          </Link>
        }
      />
      <div className="filter-tabs">
        {['', 'Submitted', 'InProgress', 'Fulfilled', 'Closed'].map((value) => (
          <button
            key={value}
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
            className={status === value ? 'selected' : ''}
          >
            {value ? t('status.' + value) : t('all')}
          </button>
        ))}
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : q.data?.items.length ? (
        <>
          <Card className="flush">
            <RequestRows items={q.data.items} />
          </Card>
          <div className="pagination">
            <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
              {t('back')}
            </Button>
            <span>{page}</span>
            <Button
              variant="secondary"
              disabled={page * 20 >= (q.data?.total || 0)}
              onClick={() => setPage(page + 1)}
            >
              {t('next')}
            </Button>
          </div>
        </>
      ) : (
        <Empty title={t('noRequests')} description={t('noRequestsDesc')} />
      )}
    </>
  );
}
const requestSchema = z.object({
  category: z.enum(['FoodWater', 'Medical', 'Shelter', 'Transportation', 'Accessibility', 'Other']),
  priority: z.enum(['Low', 'Normal', 'High', 'Critical']),
  description: z.string().min(10).max(4000),
  locationText: z.string().min(3).max(500),
  householdSize: z.number().min(1).max(50),
  quantity: z.number().positive().max(100000),
  accessibilityNeeds: z.string().max(500),
  crisisId: z.string().min(1),
  organisationId: z.string().min(1),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  synthetic: z.boolean(),
});
type RequestForm = z.infer<typeof requestSchema>;
const icons = [Utensils, Stethoscope, House, Bus, Accessibility, MoreHorizontal];
export function NewRequest() {
  const { t } = useTranslation(),
    { user } = useAuth(),
    navigate = useNavigate(),
    client = useQueryClient(),
    [params] = useSearchParams();
  const [step, setStep] = useState(0),
    [error, setError] = useState(''),
    [file, setFile] = useState<File | null>(null),
    [locating, setLocating] = useState(false),
    [geoSearch, setGeoSearch] = useState(''),
    [geoResults, setGeoResults] = useState<
      { geometry: { coordinates: [number, number] }; properties: { label: string } }[]
    >([]),
    [submittedId, setSubmittedId] = useState<string | null>(null);
  const lookup = useQuery({
    queryKey: ['lookups'],
    queryFn: () => get<Lookups>('/public/lookups'),
  });
  const draftKey = `surakuma.draft.${user?.id}`;
  const [submissionKey] = useState(
    () => sessionStorage.getItem(draftKey + '.key') || crypto.randomUUID(),
  );
  const defaults: RequestForm = {
    category: categories.includes(params.get('category') as Category)
      ? (params.get('category') as Category)
      : 'FoodWater',
    priority: 'Normal',
    description: '',
    locationText: '',
    householdSize: user?.householdSize || 1,
    quantity: 1,
    accessibilityNeeds: user?.accessibilityNeeds || '',
    crisisId: '',
    organisationId: '',
    latitude: null,
    longitude: null,
    synthetic: false,
  };
  let stored: Partial<RequestForm> = {};
  try {
    stored = JSON.parse(sessionStorage.getItem(draftKey) || '{}') as Partial<RequestForm>;
  } catch {
    /* Invalid drafts are ignored. */
  }
  const {
    register,
    watch,
    setValue,
    trigger,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RequestForm>({
    resolver: zodResolver(requestSchema),
    defaultValues: { ...defaults, ...stored },
  });
  const values = watch();
  useEffect(() => {
    if (!submittedId) {
      sessionStorage.setItem(draftKey, JSON.stringify(values));
      sessionStorage.setItem(draftKey + '.key', submissionKey);
    }
  }, [values, draftKey, submissionKey, submittedId]);
  async function next() {
    const fields: (keyof RequestForm)[][] = [
      ['category'],
      ['description', 'priority', 'householdSize', 'quantity', 'crisisId', 'organisationId'],
      ['locationText'],
      [],
    ];
    if (await trigger(fields[step])) {
      setError('');
      setStep(step + 1);
    } else setError(t('checkFields'));
  }
  function locate() {
    setLocating(true);
    if (!navigator.geolocation) {
      setError(t('locationDenied'));
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setValue('latitude', p.coords.latitude);
        setValue('longitude', p.coords.longitude);
        setLocating(false);
      },
      () => {
        setError(t('locationDenied'));
        setLocating(false);
      },
      { timeout: 10000 },
    );
  }
  async function searchLocation() {
    setError('');
    try {
      const result = await get<{ features: typeof geoResults }>(
        `/maps/geocode?query=${encodeURIComponent(geoSearch)}`,
      );
      setGeoResults(result.features);
    } catch {
      setError(t('locationDenied'));
    }
  }
  async function submit(input: RequestForm) {
    setError('');
    try {
      let id = submittedId;
      if (!id) {
        const r = (await api.post<AidRequest>('/requests', { ...input, submissionKey })).data;
        id = r.id;
        setSubmittedId(id);
      }
      if (file) {
        const body = new FormData();
        body.append('file', file);
        await api.post(`/requests/${id}/attachments`, body);
      }
      sessionStorage.removeItem(draftKey);
      sessionStorage.removeItem(draftKey + '.key');
      await client.invalidateQueries({ queryKey: ['requests'] });
      navigate(`/app/requests/${id}`, { state: { created: true } });
    } catch {
      setError(t('submitError'));
    }
  }
  return (
    <div className="form-page">
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
        <form onSubmit={handleSubmit(submit)} className="stack">
          {step === 0 && (
            <>
              <h2>{t('helpTitle')}</h2>
              <div className="category-options">
                {categories.map((category, index) => {
                  const Icon = icons[index];
                  return (
                    <label
                      className={`category-option ${values.category === category ? 'selected' : ''}`}
                      key={category}
                    >
                      <input type="radio" value={category} {...register('category')} />
                      <IconTile
                        icon={Icon}
                        tone={['coral', 'blue', 'yellow', 'green', 'purple', 'blue'][index]}
                      />
                      <span>
                        <strong>{t('category.' + category)}</strong>
                        <small>
                          {t(
                            'desc.' +
                              (category === 'Transportation' || category === 'Accessibility'
                                ? 'Other'
                                : category),
                          )}
                        </small>
                      </span>
                      <ArrowRight size={19} />
                    </label>
                  );
                })}
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <h2>{t('step2')}</h2>
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
                  <Field
                    label={t('organisation')}
                    error={errors.organisationId ? t('checkFields') : undefined}
                  >
                    <select {...register('organisationId')}>
                      <option value="">{t('selectOption')}</option>
                      {lookup.data?.organisations.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}
              <Field
                label={t('description')}
                hint={t('descriptionHint')}
                error={errors.description ? t('checkFields') : undefined}
              >
                <textarea rows={4} {...register('description')} />
              </Field>
              <div className="form-grid">
                <Field label={t('priority')}>
                  <select {...register('priority')}>
                    {['Low', 'Normal', 'High', 'Critical'].map((p) => (
                      <option value={p} key={p}>
                        {t('status.' + p)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('householdSize')}>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    {...register('householdSize', { valueAsNumber: true })}
                  />
                </Field>
                <Field label={t('quantity')}>
                  <input
                    type="number"
                    min={0.01}
                    max={100000}
                    step="0.01"
                    {...register('quantity', { valueAsNumber: true })}
                  />
                </Field>
                <Field label={t('accessibilityNeeds')}>
                  <input {...register('accessibilityNeeds')} />
                </Field>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <h2>{t('location')}</h2>
              <Field
                label={t('location')}
                hint={t('locationHint')}
                error={errors.locationText ? t('checkFields') : undefined}
              >
                <input {...register('locationText')} />
              </Field>
              <div className="inline">
                <Button variant="secondary" type="button" busy={locating} onClick={locate}>
                  <MapPin size={18} />
                  {t('locateMe')}
                </Button>
                {values.latitude !== null && (
                  <small>
                    {values.latitude.toFixed(4)}, {values.longitude?.toFixed(4)}
                  </small>
                )}
              </div>
              <div className="inline">
                <input
                  aria-label={t('searchLocation')}
                  placeholder={t('searchLocation')}
                  value={geoSearch}
                  onChange={(e) => setGeoSearch(e.target.value)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={geoSearch.length < 3}
                  onClick={() => void searchLocation()}
                >
                  {t('searchLocation')}
                </Button>
              </div>
              {geoResults.map((r, index) => (
                <button
                  className="location-result"
                  type="button"
                  key={index}
                  onClick={() => {
                    setValue('longitude', r.geometry.coordinates[0]);
                    setValue('latitude', r.geometry.coordinates[1]);
                    setValue('locationText', r.properties.label);
                    setGeoResults([]);
                  }}
                >
                  {r.properties.label}
                </button>
              ))}
              <MapView
                point={values.latitude !== null ? [values.latitude, values.longitude!] : undefined}
                onPick={(lat, lng) => {
                  setValue('latitude', lat);
                  setValue('longitude', lng);
                }}
              />
              <Field label={t('evidence')} hint={t('evidenceHint')}>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(e) => {
                    const selected = e.target.files?.[0];
                    if (
                      selected &&
                      (selected.size > 4 * 1024 * 1024 ||
                        !['image/png', 'image/jpeg'].includes(selected.type))
                    ) {
                      setError(t('evidenceHint'));
                      e.target.value = '';
                      return;
                    }
                    setFile(selected || null);
                  }}
                />
              </Field>
            </>
          )}
          {step === 3 && (
            <>
              <h2>{t('reviewTitle')}</h2>
              <dl className="review-grid">
                <dt>{t('step1')}</dt>
                <dd>{t('category.' + values.category)}</dd>
                <dt>{t('description')}</dt>
                <dd>{values.description}</dd>
                <dt>{t('priority')}</dt>
                <dd>
                  <Badge value={values.priority} />
                </dd>
                <dt>{t('householdSize')}</dt>
                <dd>{values.householdSize}</dd>
                <dt>{t('quantity')}</dt>
                <dd>{values.quantity}</dd>
                <dt>{t('location')}</dt>
                <dd>{values.locationText}</dd>
                <dt>{t('evidence')}</dt>
                <dd>{file?.name || '—'}</dd>
              </dl>
              <label className="checkbox-label">
                <input type="checkbox" {...register('synthetic')} />
                <span>{t('synthetic')}</span>
              </label>
              <p className="privacy-note">
                <ShieldCheck size={18} />
                {t('privacyText')}
              </p>
            </>
          )}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            {step > 0 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep(step - 1)}
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
          <small className="muted center">{t('draftSaved')}</small>
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
    client = useQueryClient();
  const query = useQuery({
    queryKey: ['request', id],
    queryFn: () => get<RequestDetail>(`/requests/${id}`),
  });
  const [feedback, setFeedback] = useState(false),
    [error, setError] = useState(false);
  const mutation = useMutation({
    mutationFn: async (e: HTMLFormElement) => {
      const f = new FormData(e);
      await api.post(`/requests/${id}/feedback`, {
        rating: Number(f.get('rating')),
        received: f.get('received') === 'on',
        problem: f.get('problem') === 'on',
        comment: f.get('comment'),
      });
    },
    onSuccess: () => {
      setFeedback(true);
      void client.invalidateQueries({ queryKey: ['request', id] });
    },
    onError: () => setError(true),
  });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;
  const data = query.data!,
    r = data.request;
  async function download(fileId: string, name: string) {
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
    <>
      <NextLink to="/app/requests">{t('myRequests')}</NextLink>
      {(location.state as { created?: boolean } | null)?.created && (
        <div className="success-banner" role="status">
          <CheckCircle2 />
          {t('requestSaved')} · {r.reference}
        </div>
      )}
      <PageHeader
        title={t('category.' + r.category)}
        description={r.reference}
        action={<Badge value={r.status} />}
      />
      <div className="two-column">
        <div className="stack">
          <Card>
            <h2>{t('details')}</h2>
            <p>{r.description}</p>
            <dl className="review-grid">
              <dt>{t('location')}</dt>
              <dd>{r.locationText}</dd>
              <dt>{t('householdSize')}</dt>
              <dd>{r.householdSize}</dd>
              <dt>{t('priority')}</dt>
              <dd>
                <Badge value={r.priority} />
              </dd>
              <dt>{t('delivered')}</dt>
              <dd>
                {r.deliveredQuantity} / {r.quantity}
              </dd>
              <dt>{t('outstanding')}</dt>
              <dd>{r.quantity - r.deliveredQuantity}</dd>
            </dl>
            <div className="progress-bar">
              <span style={{ width: `${(100 * r.deliveredQuantity) / r.quantity}%` }} />
            </div>
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
          {['PartiallyFulfilled', 'Fulfilled', 'Closed'].includes(r.status) && (
            <Card>
              <h2>{t('feedback')}</h2>
              {feedback ? (
                <p className="success-text">{t('feedbackSaved')}</p>
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
                </form>
              )}
            </Card>
          )}
        </div>
        <Card>
          <h2>{t('tracking')}</h2>
          <ol className="timeline">
            {data.history.map((h, index) => (
              <li key={h.id}>
                <span className="timeline-dot">
                  {index === data.history.length - 1 ? <Check size={13} /> : null}
                </span>
                <Badge value={h.status} />
                <small>{formatDate(h.createdAt, i18n.language)}</small>
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
    </>
  );
}
export function NotificationsPage() {
  const { t, i18n } = useTranslation(),
    client = useQueryClient();
  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () => get<Notification[]>('/notifications'),
    refetchInterval: 15000,
  });
  const mutation = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
  });
  return (
    <>
      <PageHeader title={t('notifications')} />
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : q.data?.length ? (
        <div className="stack">
          {q.data.map((n) => (
            <Card key={n.id} className={n.read ? 'notification read' : 'notification'}>
              <IconTile icon={Bell} />
              <div>
                <p>
                  {i18n.language === 'si'
                    ? n.sinhalaMessage
                    : i18n.language === 'ta'
                      ? n.tamilMessage
                      : n.message}
                </p>
                <small className="muted">{formatDate(n.createdAt, i18n.language)}</small>
                {n.requestId && (
                  <NextLink to={`/app/requests/${n.requestId}`}>{t('viewRequest')}</NextLink>
                )}
              </div>
              {!n.read && (
                <Button
                  variant="ghost"
                  onClick={() => mutation.mutate(n.id)}
                  busy={mutation.isPending}
                >
                  {t('markRead')}
                </Button>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <Empty title={t('empty')} />
      )}
      {mutation.error && <ErrorState error={mutation.error} />}
    </>
  );
}
export function ProfilePage() {
  const { user, updateUser } = useAuth(),
    { t, i18n } = useTranslation();
  const [saved, setSaved] = useState(false);
  const mutation = useMutation({
    mutationFn: async (form: HTMLFormElement) => {
      const f = new FormData(form);
      return (
        await api.put<User>('/auth/profile', {
          name: f.get('name'),
          language: f.get('language'),
          householdSize: Number(f.get('householdSize')),
          accessibilityNeeds: f.get('accessibilityNeeds'),
        })
      ).data;
    },
    onSuccess: (data) => {
      updateUser(data);
      void i18n.changeLanguage(data.language);
      setSaved(true);
    },
  });
  return (
    <div className="form-page">
      <PageHeader title={t('profile')} />
      <Card>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(e.currentTarget);
          }}
        >
          <Field label={t('name')}>
            <input name="name" defaultValue={user?.name} required maxLength={100} />
          </Field>
          <Field label={t('email')}>
            <input value={user?.email || ''} readOnly />
          </Field>
          <Field label={t('language')}>
            <select name="language" defaultValue={user?.language}>
              <option value="en">English</option>
              <option value="si">සිංහල</option>
              <option value="ta">தமிழ்</option>
            </select>
          </Field>
          <Field label={t('householdSize')}>
            <input
              type="number"
              name="householdSize"
              defaultValue={user?.householdSize}
              min={1}
              max={50}
              required
            />
          </Field>
          <Field label={t('accessibilityNeeds')}>
            <input
              name="accessibilityNeeds"
              defaultValue={user?.accessibilityNeeds}
              maxLength={500}
            />
          </Field>
          <Button busy={mutation.isPending}>{t('save')}</Button>
          {saved && (
            <p role="status" className="success-text">
              {t('saved')}
            </p>
          )}
          {mutation.error && <ErrorState error={mutation.error} />}
        </form>
      </Card>
    </div>
  );
}
