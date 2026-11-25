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
  Bus,
  Check,
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
import { donorWorkspace } from './countryScope';
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
import { AlertCard, alertWording, useAlerts } from './PublicAlertCard';
import type { PublicShelter } from './types';
export { AlertCard, useAlerts } from './PublicAlertCard';
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
            <Link to="/donation" className="button secondary">
              <HeartHandshake size={18} aria-hidden="true" />
              {t('donation')}
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
                ['Transportation', Bus, 'blue'],
                ['Accessibility', Accessibility, 'green'],
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
          <div className="public-alert-grid home-alert-grid">
            {alerts.data.slice(0, 3).map((alert) => (
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
export function DonationPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <section className="hero container">
      <div className="hero-copy">
        <span className="eyebrow">{t('donation')}</span>
        <h1>{t('donationTitle')}</h1>
        <p>{t('donationDescription')}</p>
        <div className="hero-actions">
          {user?.roles.includes('Donor') ? (
            <Link to={donorWorkspace} className="button primary">{t('donorWorkspace')}<ArrowRight size={18} aria-hidden="true" /></Link>
          ) : (
            <>
              <Link to="/donation/register" className="button primary">{t('donorRegister')}<ArrowRight size={18} aria-hidden="true" /></Link>
              <Link to="/donation/login" className="button secondary">{t('donorLogin')}</Link>
            </>
          )}
        </div>
      </div>
      <div className="hero-visual"><CommunityArt /></div>
    </section>
  );
}

const alertSeverities = ['All', 'Critical', 'Warning', 'Advisory', 'Information'];
const publicAlertPageSize = 3;

export function AlertsPage({ workspace = false }: { workspace?: boolean }) {
  const { t, i18n } = useTranslation();
  const query = useAlerts();
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const alerts = query.data ?? [];
  const language = (i18n.resolvedLanguage ?? i18n.language).split('-')[0];
  const term = search.trim().toLowerCase();
  const filtered = alerts.filter((alert) => {
    if (filter !== 'All' && alert.severity !== filter) return false;
    const { title, message } = alertWording(alert, language);
    return !term || [title, message, alert.title, alert.area, alert.authority]
      .some((value) => value?.toLowerCase().includes(term));
  });
  const pages = Math.ceil(filtered.length / publicAlertPageSize);
  const currentPage = Math.min(page, Math.max(0, pages - 1));
  return (
    <div className={workspace ? 'citizen-page public-alert-page' : 'container page public-alert-page'}>
      <PageHeader eyebrow={t('communityTag')} title={t('alerts')} description={t('alertPageDescription')} />
      <div className="public-alert-controls">
        <div className="filter-tabs public-alert-filters" role="group" aria-label={t('alertSeverity')}>
          {alertSeverities.map((value) => {
            const count = value === 'All' ? alerts.length : alerts.filter((alert) => alert.severity === value).length;
            return <button type="button" key={value} className={filter === value ? 'selected' : ''}
              aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(0); }}>
              {value === 'All' ? t('all') : t('status.' + value)} <span aria-hidden="true">({count})</span>
            </button>;
          })}
        </div>
        <label className="public-alert-search">
          <Search size={19} aria-hidden="true" />
          <span className="sr-only">{t('alertSearch')}</span>
          <input type="search" placeholder={t('alertSearch')} value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(0); }} />
        </label>
      </div>
      {query.isPending ? <Loading /> : query.error ? <ErrorState error={query.error} retry={() => void query.refetch()} /> : (
        filtered.length ? <>
          <div className="public-alert-grid">
            {filtered.slice(currentPage * publicAlertPageSize, (currentPage + 1) * publicAlertPageSize)
              .map((alert) => <AlertCard key={alert.id} alert={alert} />)}
          </div>
          {pages > 1 && <nav className="public-alert-pagination" aria-label={t('allAlerts')}>
            {Array.from({ length: pages }, (_, index) => <button type="button" key={index}
              aria-label={t('pageOf', { page: index + 1, total: pages })}
              aria-current={index === currentPage ? 'page' : undefined} onClick={() => setPage(index)} />)}
          </nav>}
        </> : <Card><Empty title={term ? t('alertSearchEmpty') : t(filter === 'All' ? 'noAlerts' : 'noMatchingAlerts')} /></Card>
      )}
    </div>
  );
}
function ShelterArt({ index = 0 }: { index?: number }) {
  return (
    <div className={`shelter-art shelter-art-${index % 3}`} aria-hidden="true">
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
export function SheltersPage({ workspace = false }: { workspace?: boolean }) {
  const { t } = useTranslation(), country = useCountry();
  const directory = workspace ? '/app/shelters' : '/shelters';
  const query = useQuery({ queryKey: ['shelters', country], queryFn: () => get<PublicShelter[]>('/shelters') });
  const [search, setSearch] = useState(''),
    [view, setView] = useState('list');
  const shelters =
    query.data?.filter((s) =>
      (s.name + ' ' + s.address).toLowerCase().includes(search.trim().toLowerCase()),
    ) || [];
  return (
    <div className={workspace ? 'citizen-page citizen-shelters' : 'container page citizen-shelters'}>
      <PageHeader title={t('shelters')} description={t('shelterSubtitle')}
        action={<Link className="button secondary" to={workspace ? '/app/assistance-centres' : '/assistance-centres'}>{t('assistanceCentres')}</Link>} />
      <Card className="citizen-directory-controls"><div className="directory-tools">
        <label className="search-field">
          <Search size={20} aria-hidden="true" />
          <input
            type="search"
            aria-label={t('searchShelters')}
            placeholder={t('searchShelters')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="filter-tabs">
          {['list', 'map'].map((v) => (
            <button type="button" key={v} className={view === v ? 'selected' : ''} aria-pressed={view === v} onClick={() => setView(v)}>
              {t(v)}
            </button>
          ))}
        </div>
      </div></Card>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !shelters.length ? (
        <Card><Empty title={t(search.trim() ? 'noMatchingShelters' : 'noShelters')}
          action={search.trim() ? <Button variant="secondary" onClick={() => setSearch('')}>{t('clearFilters')}</Button> : undefined} /></Card>
      ) : view === 'map' ? (
        <Card className="citizen-shelter-map">
          <MapView shelters={shelters} failureMessage={t('shelterMapUnavailable')} />
          <ul aria-label={t('shelters')}>
            {shelters.map((s) => <li key={s.id}><NextLink to={`${directory}/${s.id}`}>{s.name} · {s.available} {t('spaces')}</NextLink></li>)}
          </ul>
        </Card>
      ) : (
        <div className="shelter-grid">
          {shelters.map((s, index) => (
            <Card key={s.id} className="shelter-card flush">
              {country === 'LK' && s.name.trim().toLowerCase() === 'gampaha centre' ? (
                <figure className="shelter-photo">
                  <img src="/shelter-art/gampaha-centre.webp" alt="" width={1200} height={546} loading="lazy" decoding="async" />
                  <figcaption>{t('shelterAiIllustration')}</figcaption>
                </figure>
              ) : <ShelterArt index={index} />}
              <div className="shelter-card-body">
                <div className="shelter-card-title">
                  <h2>{s.name}</h2>
                  <Badge
                    value={!s.open ? 'ShelterClosed' : s.available === 0 ? 'ShelterFull' : s.available < 10 ? 'NearlyFull' : 'Open'}
                  />
                </div>
                <LocationText>{s.address}</LocationText>
                <div className="shelter-facts">
                  <span>
                    <Users size={17} aria-hidden="true" />
                    <span><strong>{s.available}</strong> {t('spaces')}</span>
                  </span>
                  {s.accessible && (
                    <span>
                      <Accessibility size={17} aria-hidden="true" />
                      {t('accessible')}
                    </span>
                  )}
                </div>
                <dl className="citizen-shelter-capacity">
                  <div><dt>{t('capacity')}</dt><dd>{s.capacity}</dd></div>
                  <div><dt>{t('reserved')}</dt><dd>{s.reserved}</dd></div>
                  <div><dt>{t('occupancy')}</dt><dd>{s.occupancy}</dd></div>
                </dl>
                <Link className="shelter-details-link" to={`${directory}/${s.id}`} aria-label={`${t('viewDetails')} · ${s.name}`}>
                  {t('viewDetails')}
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
export function ShelterDetails({ workspace = false }: { workspace?: boolean }) {
  const { id } = useParams(),
    { t, i18n } = useTranslation(),
    { user } = useAuth(), country = useCountry();
  const directory = workspace ? '/app/shelters' : '/shelters';
  const query = useQuery({ queryKey: ['shelters', country], queryFn: () => get<PublicShelter[]>('/shelters') });
  const [route, setRoute] = useState(''),
    [busy, setBusy] = useState(false);
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const s = query.data?.find((x) => x.id === id);
  if (!s) return <Empty title={t('shelterNotAvailable')}
    action={<NextLink to={directory}>{t('shelters')}</NextLink>} />;
  async function routing() {
    if (!navigator.geolocation) { setRoute(t('locationDenied')); return; }
    setRoute('');
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
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
      { timeout: 10000 },
    );
  }
  return (
    <div className={workspace ? 'citizen-page citizen-shelter-details' : 'container page citizen-shelter-details'}>
      <NextLink to={directory}>{t('back')}</NextLink>
      <PageHeader
        title={s.name}
        description={s.address}
        action={<Badge value={!s.open ? 'ShelterClosed' : s.available === 0 ? 'ShelterFull' : s.available < 10 ? 'NearlyFull' : 'Open'} />}
      />
      <div className="citizen-tracking-columns">
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
          <MapView shelters={[s]} failureMessage={t('shelterMapUnavailable')} />
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
