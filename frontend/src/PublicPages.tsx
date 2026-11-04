import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Accessibility,
  ArrowRight,
  ArrowUpRight,
  Check,
  CloudRain,
  Heart,
  HeartHandshake,
  House,
  LifeBuoy,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
  Stethoscope,
  Utensils,
  Users,
} from 'lucide-react';
import { get, api } from './api';
import { useAuth } from './auth';
import {
  Badge,
  Button,
  Card,
  CheckLine,
  Empty,
  ErrorState,
  formatDate,
  IconTile,
  Loading,
  LocationText,
  NextLink,
  PageHeader,
} from './components';
import { CommunityArt } from './CommunityArt';
import { MapView } from './MapView';
import type { Alert, Shelter } from './types';
function useAlerts() {
  return useQuery({ queryKey: ['alerts'], queryFn: () => get<Alert[]>('/alerts') });
}
export function AlertCard({ alert }: { alert: Alert }) {
  const { t, i18n } = useTranslation();
  return (
    <Card className="alert-card">
      <IconTile
        icon={alert.severity === 'Warning' ? CloudRain : ShieldCheck}
        tone={alert.severity === 'Warning' ? 'coral' : 'blue'}
      />
      <div>
        <div className="inline">
          <Badge value={alert.severity} />
          <small className="muted">{alert.area}</small>
        </div>
        <h3>
          {i18n.language === 'si'
            ? alert.sinhalaTitle
            : i18n.language === 'ta'
              ? alert.tamilTitle
              : alert.title}
        </h3>
        <p>
          {i18n.language === 'si'
            ? alert.sinhalaMessage
            : i18n.language === 'ta'
              ? alert.tamilMessage
              : alert.message}
        </p>
        <small className="muted">
          {t('authority')}: {alert.authority} · {t('expires')}:{' '}
          {formatDate(alert.expiresAt, i18n.language)}
        </small>
      </div>
    </Card>
  );
}
export function HomePage() {
  const { t } = useTranslation(),
    alerts = useAlerts();
  return (
    <>
      <section className="hero container">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="live-dot" />
            {t('heroKicker')}
          </span>
          <h1>
            {t('heroTitle')}
            <br />
            <span>{t('heroAccent')}</span>
          </h1>
          <p>{t('heroDescription')}</p>
          <div className="hero-actions">
            <Link to="/app/requests/new" className="button primary">
              {t('requestHelp')}
              <ArrowRight size={19} />
            </Link>
            <Link to="/shelters" className="button secondary">
              <MapPin size={18} />
              {t('shelters')}
            </Link>
          </div>
          <div className="hero-trust">
            <div className="mini-avatars">
              <span>A</span>
              <span>N</span>
              <span>R</span>
            </div>
            <div>
              <strong>{t('communityTag')}</strong>
              <small>
                <ShieldCheck size={13} />
                {t('careTag')}
              </small>
            </div>
          </div>
        </div>
        <div className="hero-visual">
          <CommunityArt />
          <div className="floating-note note-one">
            <span className="round-icon green">
              <HeartHandshake size={21} />
            </span>
            <div>
              <strong>{t('communityTag')}</strong>
              <small>{t('careTag')}</small>
            </div>
          </div>
          <div className="floating-note note-two">
            <span className="round-icon coral">
              <Heart size={18} fill="currentColor" />
            </span>
            <strong>{t('category.Other')}</strong>
            <Check size={17} color="#16865c" />
          </div>
          <span className="art-spark spark-one">✦</span>
          <span className="art-spark spark-two">+</span>
        </div>
      </section>
      <section className="services-section">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{t('careTag')}</span>
              <h2>{t('helpTitle')}</h2>
              <p className="muted">{t('helpSubtitle')}</p>
            </div>
            <span className="decorative-heart">
              <HeartHandshake size={35} />
            </span>
          </div>
          <div className="service-grid">
            {(
              [
                ['FoodWater', Utensils, 'coral'],
                ['Medical', Stethoscope, 'blue'],
                ['Shelter', House, 'yellow'],
                ['Other', LifeBuoy, 'green'],
              ] as const
            ).map(([category, Icon, tone]) => (
              <Link
                key={category}
                to={`/app/requests/new?category=${category}`}
                className={`service-card ${tone}`}
              >
                <IconTile icon={Icon} tone={tone} />
                <h3>{t('category.' + category)}</h3>
                <p>{t('desc.' + category)}</p>
                <span className="service-arrow">
                  <ArrowUpRight size={20} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
      <section className="container section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{t('alerts')}</span>
            <h2>{t('latestUpdates')}</h2>
          </div>
          <NextLink to="/alerts">{t('viewAll')}</NextLink>
        </div>
        {alerts.isPending ? (
          <Loading />
        ) : alerts.error ? (
          <ErrorState error={alerts.error} retry={() => void alerts.refetch()} />
        ) : alerts.data?.length ? (
          <div className="home-alerts">
            {alerts.data.slice(0, 2).map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        ) : (
          <Empty title={t('noAlerts')} />
        )}
      </section>
      <section className="how-section">
        <div className="container">
          <div className="center-heading">
            <span className="eyebrow">{t('communityTag')}</span>
            <h2>{t('howTitle')}</h2>
          </div>
          <div className="how-grid">
            {[1, 2, 3].map((step) => (
              <div key={step} className="how-step">
                <span className={`step-circle step-${step}`}>0{step}</span>
                <h3>{t('how' + step)}</h3>
                <p>{t('how' + step + 'desc')}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
export function AlertsPage() {
  const { t } = useTranslation(),
    query = useAlerts();
  const [filter, setFilter] = useState('All');
  return (
    <div className="container page">
      <PageHeader
        eyebrow={t('communityTag')}
        title={t('alerts')}
        description={t('latestUpdates')}
      />
      <div className="filter-tabs">
        {['All', 'Warning', 'Information'].map((value) => (
          <button
            key={value}
            className={filter === value ? 'selected' : ''}
            onClick={() => setFilter(value)}
          >
            {value === 'All' ? t('all') : t('status.' + value)}
          </button>
        ))}
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <div className="stack">
          {query.data
            ?.filter((a) => filter === 'All' || a.severity === filter)
            .map((a) => (
              <AlertCard key={a.id} alert={a} />
            ))}
          {!query.data?.filter((a) => filter === 'All' || a.severity === filter).length && (
            <Empty title={t('noAlerts')} />
          )}
        </div>
      )}
    </div>
  );
}
function ShelterArt({ index = 0 }: { index?: number }) {
  return (
    <div className={`shelter-art shelter-art-${index % 3}`}>
      <span className="shelter-sun" />
      <div className="building">
        <span />
        <i />
        <i />
        <i />
        <i />
      </div>
      <span className="shelter-tree" />
      <span className="shelter-ground" />
    </div>
  );
}
export function SheltersPage() {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ['shelters'], queryFn: () => get<Shelter[]>('/shelters') });
  const [search, setSearch] = useState(''),
    [view, setView] = useState('list');
  const shelters =
    query.data?.filter((s) =>
      (s.name + ' ' + s.address).toLowerCase().includes(search.toLowerCase()),
    ) || [];
  return (
    <div className="container page">
      <PageHeader title={t('shelters')} description={t('shelterSubtitle')} />
      <div className="directory-tools">
        <label className="search-field">
          <Search size={20} />
          <input
            aria-label={t('searchShelters')}
            placeholder={t('searchShelters')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="filter-tabs">
          {['list', 'map'].map((v) => (
            <button key={v} className={view === v ? 'selected' : ''} onClick={() => setView(v)}>
              {t(v)}
            </button>
          ))}
        </div>
      </div>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : view === 'map' ? (
        <MapView shelters={shelters} />
      ) : (
        <div className="shelter-grid">
          {shelters.map((s, index) => (
            <Card key={s.id} className="shelter-card">
              <ShelterArt index={index} />
              <div className="shelter-card-body">
                <Badge
                  value={!s.open ? 'ShelterClosed' : s.available < 10 ? 'NearlyFull' : 'Open'}
                />
                <h3>{s.name}</h3>
                <LocationText>{s.address}</LocationText>
                <div className="shelter-facts">
                  <span>
                    <Users size={17} />
                    <strong>{s.available}</strong> {t('spaces')}
                  </span>
                  {s.accessible && (
                    <span>
                      <Accessibility size={17} />
                      {t('accessible')}
                    </span>
                  )}
                </div>
                <Link className="shelter-details-link" to={`/shelters/${s.id}`}>
                  {t('viewDetails')}
                  <ArrowRight size={16} />
                </Link>
              </div>
            </Card>
          ))}
          {shelters.length === 0 && <Empty title={t('empty')} />}
        </div>
      )}
    </div>
  );
}
export function ShelterDetails() {
  const { id } = useParams(),
    { t, i18n } = useTranslation(),
    { user } = useAuth();
  const query = useQuery({ queryKey: ['shelters'], queryFn: () => get<Shelter[]>('/shelters') });
  const [route, setRoute] = useState(''),
    [busy, setBusy] = useState(false);
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} />;
  const s = query.data?.find((x) => x.id === id);
  if (!s) return <Empty title={t('empty')} />;
  async function routing() {
    setBusy(true);
    navigator.geolocation?.getCurrentPosition(
      (position) => {
        void api
          .get<{ features: { properties: { summary: { distance: number; duration: number } } }[] }>(
            '/maps/route',
            {
              params: {
                startLat: position.coords.latitude,
                startLng: position.coords.longitude,
                endLat: s!.latitude,
                endLng: s!.longitude,
              },
            },
          )
          .then((r) => {
            const summary = r.data.features[0].properties.summary;
            setRoute(
              t('routeResult', {
                km: (summary.distance / 1000).toFixed(1),
                minutes: Math.ceil(summary.duration / 60),
              }),
            );
          })
          .catch(() => setRoute(t('routeUnavailable')))
          .finally(() => setBusy(false));
      },
      () => {
        setRoute(t('locationDenied'));
        setBusy(false);
      },
    );
  }
  return (
    <div className="container page">
      <NextLink to="/shelters">{t('back')}</NextLink>
      <PageHeader
        title={s.name}
        description={s.address}
        action={<Badge value={s.open ? 'Open' : 'ShelterClosed'} />}
      />
      <div className="two-column">
        <div className="stack">
          <Card>
            <div className="stat-grid">
              <div>
                <strong>{s.available}</strong>
                <span>{t('spaces')}</span>
              </div>
              <div>
                <strong>{s.capacity}</strong>
                <span>{t('capacity')}</span>
              </div>
              <div>
                <strong>{s.reserved}</strong>
                <span>{t('reserved')}</span>
              </div>
              <div>
                <strong>{s.occupancy}</strong>
                <span>{t('occupancy')}</span>
              </div>
            </div>
          </Card>
          <Card>
            <h3>{t('facilities')}</h3>
            {s.accessible && <CheckLine>{t('accessible')}</CheckLine>}
            <p>{s.facilities}</p>
            <small className="muted">
              {t('updated')}: {formatDate(s.updatedAt, i18n.language)}
            </small>
          </Card>
        </div>
        <div className="stack">
          <MapView shelters={[s]} point={[s.latitude, s.longitude]} />
          <Card>
            <p>{t('shelterSubtitle')}</p>
            <Link className="button primary" to="/app/requests/new?category=Shelter">
              {t('requestHelp')}
              <ArrowRight size={18} />
            </Link>
            {user && (
              <Button variant="secondary" onClick={routing} busy={busy}>
                {t('route')}
              </Button>
            )}
            {route && <p role="status">{route}</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
export function InformationPage({ kind }: { kind: 'contact' | 'privacy' | 'guidance' }) {
  const { t } = useTranslation();
  return (
    <div className="container page narrow">
      <PageHeader title={t(kind === 'contact' ? 'contactTitle' : kind)} />
      <Card>
        <IconTile icon={kind === 'contact' ? LifeBuoy : ShieldCheck} tone="green" />
        <h2>{t(kind === 'contact' ? 'contact' : kind)}</h2>
        <p>
          {t(
            kind === 'contact'
              ? 'contactDescription'
              : kind === 'privacy'
                ? 'privacyText'
                : 'guidanceText',
          )}
        </p>
        <p className="muted">{t('notEmergency')}</p>
        <NextLink to="/app/requests/new">{t('requestHelp')}</NextLink>
      </Card>
    </div>
  );
}
