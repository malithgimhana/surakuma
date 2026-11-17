import { useCountries, useCountry } from './geography';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Accessibility,
  Ambulance,
  ArrowRight,
  ArrowUpRight,
  Check,
  CloudRain,
  Heart,
  HeartHandshake,
  House,
  LifeBuoy,
  MapPin,
  Phone,
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
import type { Alert, PublicShelter } from './types';
function useAlerts() {
  return useQuery({ queryKey: ['alerts'], queryFn: () => get<Alert[]>('/alerts') });
}
export function AlertCard({ alert }: { alert: Alert }) {
  const { t, i18n } = useTranslation();
  let translations: Record<string,{title:string;message:string}> = {};
  try { translations = JSON.parse(alert.translationsJson || "{}"); } catch { /* legacy alert */ }
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
            ? alert.sinhalaTitle || alert.title
            : i18n.language === 'ta'
              ? alert.tamilTitle || alert.title
              : translations[i18n.language]?.title || alert.title}
        </h3>
        <p>
          {i18n.language === 'si'
            ? alert.sinhalaMessage || alert.message
            : i18n.language === 'ta'
              ? alert.tamilMessage || alert.message
              : translations[i18n.language]?.message || alert.message}
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
      <section className="how-section" aria-labelledby="how-title">
        <div className="container">
          <div className="how-heading">
            <span className="eyebrow">{t('communityTag')}</span>
            <h2 id="how-title">{t('howTitle')}</h2>
          </div>
          <ol className="how-grid" role="list">
            {[1, 2, 3].map((step) => (
              <li key={step} className="how-step">
                <span className={`step-circle step-${step}`} aria-hidden="true">
                  0{step}
                </span>
                <h3>{t('how' + step)}</h3>
                <p>{t('how' + step + 'desc')}</p>
              </li>
            ))}
          </ol>
          <div className="how-actions">
            <Link to="/app/requests/new" className="button primary">
              {t('requestHelp')}
            </Link>
            <Link to="/app/requests" className="button secondary">
              {t('checkMyRequest')}
            </Link>
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
            aria-pressed={filter === value}
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
  const query = useQuery({ queryKey: ['shelters'], queryFn: () => get<PublicShelter[]>('/shelters') });
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
            <button key={v} className={view === v ? 'selected' : ''} aria-pressed={view === v} onClick={() => setView(v)}>
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
        <>
          <MapView shelters={shelters} />
          <ul aria-label={t('shelters')}>
            {shelters.map((s) => <li key={s.id}><Link to={`/shelters/${s.id}`}>{s.name} · {s.available} {t('spaces')}</Link></li>)}
          </ul>
        </>
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
  const query = useQuery({ queryKey: ['shelters'], queryFn: () => get<PublicShelter[]>('/shelters') });
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
type EmergencyContact = { label: string; number: string; sourceUrl: string };

function readEmergencyContacts(json?: string): EmergencyContact[] {
  try {
    const contacts: unknown = JSON.parse(json || '[]');
    if (!Array.isArray(contacts)) return [];
    return contacts.filter(
      (contact): contact is EmergencyContact =>
        typeof contact?.label === 'string' &&
        contact.label.trim() !== '' &&
        typeof contact.number === 'string' &&
        /^\+?\d{2,25}$/.test(contact.number.replace(/[ -]/g, '')) &&
        typeof contact.sourceUrl === 'string' &&
        /^https:\/\//i.test(contact.sourceUrl),
    );
  } catch {
    return [];
  }
}

function ContactPage() {
  const country = useCountry();
  const countries = useCountries();
  const { t } = useTranslation();
  const configuration = Array.isArray(countries.data)
    ? countries.data.find((item) => item.code === country)
    : undefined;
  const contacts = readEmergencyContacts(configuration?.emergencyContactsJson);

  return (
    <div className="container page contact-page">
      <PageHeader title={t('contact')} description={t('contactIntro')} />
      <section aria-labelledby="contact-emergency-title">
        <h2 id="contact-emergency-title">
          {configuration
            ? t('emergencyContactsCountry', { country: configuration.name })
            : t('emergencyContacts')}
        </h2>
        {countries.isPending ? (
          <Loading />
        ) : countries.isError && !configuration ? (
          <ErrorState error={countries.error} retry={() => void countries.refetch()} />
        ) : contacts.length ? (
          <ul className="emergency-contact-grid" role="list">
            {contacts.map((contact, index) => {
              const ambulance = /\bambulance\b/i.test(contact.label);
              return (
                <li
                  key={`${contact.label}-${contact.number}-${index}`}
                  className="card emergency-contact-card"
                >
                  <IconTile icon={ambulance ? Ambulance : Phone} tone={ambulance ? 'coral' : 'green'} />
                  <h3>{contact.label}</h3>
                  <p className="emergency-contact-number">{contact.number}</p>
                  <div className="contact-actions">
                    <a
                      className="button primary compact"
                      href={`tel:${contact.number.replace(/[ -]/g, '')}`}
                    >
                      <Phone size={16} aria-hidden="true" />
                      {t('callContact', { number: contact.number })}
                    </a>
                    <a className="text-link" href={contact.sourceUrl}>
                      {t('officialSource')}
                      <span className="sr-only"> · {contact.label}</span>
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <Card>
            <p className="muted contact-empty">{t('contactDescription')}</p>
          </Card>
        )}
      </section>
      <section className="contact-support" aria-labelledby="contact-support-title">
        <h2 id="contact-support-title">{t('surakumaSupport')}</h2>
        <Card className="contact-support-card">
          <div className="contact-support-copy">
            <IconTile icon={LifeBuoy} tone="green" />
            <div>
              <p className="muted">{t('surakumaSupportDescription')}</p>
              <NextLink to="/guidance">{t('guidance')}</NextLink>
            </div>
          </div>
          <div className="contact-actions">
            <Link className="button primary compact" to="/app/requests/new">
              {t('requestHelp')} <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link className="button secondary compact" to="/app/requests">
              {t('checkMyRequest')} <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </Card>
      </section>
    </div>
  );
}

export function InformationPage({ kind }: { kind: 'contact' | 'privacy' | 'guidance' }) {
  const { t } = useTranslation();
  if (kind === 'contact') return <ContactPage />;
  return (
    <div className="container page narrow">
      <PageHeader title={t(kind)} />
      <Card>
        <IconTile icon={ShieldCheck} tone="green" />
        <h2>{t(kind)}</h2>
        <p>{t(kind === 'privacy' ? 'privacyText' : 'guidanceText')}</p>
        <NextLink to="/app/requests/new">{t('requestHelp')}</NextLink>
      </Card>
    </div>
  );
}
