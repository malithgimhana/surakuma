import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight, CalendarDays, Clock, Image as ImageIcon, Info, MapPin, Megaphone,
  Mountain, ShieldCheck, TriangleAlert, Waves, Wind,
} from 'lucide-react';
import { get } from './api';
import { formatDate } from './components';
import { useCountry } from './geography';
import { WorkspaceDialog } from './OrganisationDialog';
import type { Alert } from './types';
import './public-alerts.css';

const illustrations = {
  flood: { image: '/alert-art/flood.webp', icon: Waves },
  storm: { image: '/alert-art/storm.webp', icon: Wind },
  landslide: { image: '/alert-art/landslide.webp', icon: Mountain },
  other: { image: undefined, icon: ShieldCheck },
};

export function useAlerts() {
  const country = useCountry();
  return useQuery({
    queryKey: ['alerts', country],
    queryFn: () => get<Alert[]>(`/alerts?${new URLSearchParams({ countryCode: country })}`),
    refetchInterval: 30_000,
  });
}

export function alertWording(alert: Alert, language: string) {
  let translation: { title?: string; message?: string } | undefined;
  if (language === 'si') translation = { title: alert.sinhalaTitle, message: alert.sinhalaMessage };
  else if (language === 'ta') translation = { title: alert.tamilTitle, message: alert.tamilMessage };
  else if (language !== 'en') {
    try { translation = JSON.parse(alert.translationsJson || '{}')?.[language]; }
    catch { /* Some older records have only the standard language fields. */ }
  }
  return { title: translation?.title || alert.title, message: translation?.message || alert.message };
}

function illustrationKind(alert: Alert): keyof typeof illustrations {
  if (alert.visualKind && Object.hasOwn(illustrations, alert.visualKind)) return alert.visualKind;
  const text = `${alert.title} ${alert.message}`;
  if (/landslide/i.test(text)) return 'landslide';
  if (/flood/i.test(text)) return 'flood';
  if (/storm|cyclone|wind|rain/i.test(text)) return 'storm';
  return 'other';
}

export function AlertCard({ alert }: { alert: Alert }) {
  const { t, i18n } = useTranslation();
  const language = (i18n.resolvedLanguage ?? i18n.language).split('-')[0];
  const [open, setOpen] = useState(false);
  const [failedImage, setFailedImage] = useState<string>();
  const { title, message } = alertWording(alert, language);
  const kind = illustrationKind(alert);
  const { image: fallback, icon: KindIcon } = illustrations[kind];
  const generated = alert.visualImageUrl?.startsWith('/api/v1/alerts/')
    ? `${(import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '')}${alert.visualImageUrl.slice('/api/v1'.length)}`
    : undefined;
  const image = generated && generated !== failedImage ? generated : fallback;
  const summary = language === 'en' ? alert.visualSummary || message : message;
  const description = language === 'en' ? alert.popupDescription : undefined;
  const SeverityIcon = ['Critical', 'Warning'].includes(alert.severity) ? TriangleAlert : Info;
  const severity = t(`status.${alert.severity}`, { defaultValue: alert.severity });

  function artwork() {
    if (!image) return null;
    return <img src={image} alt="" width="960" height="540" loading="lazy" decoding="async"
      onError={() => { if (image === generated) setFailedImage(image); }} />;
  }

  const guidance = <Link to="/contact" className="public-alert-guidance" onClick={() => setOpen(false)}>
    <Megaphone size={17} aria-hidden="true" />{t('getSafetyGuidance')}
  </Link>;

  function dates() {
    return <>
      {alert.publishedAt && <div>
        <dt><CalendarDays size={17} aria-hidden="true" />{t('publishedOn')}</dt>
        <dd><time dateTime={alert.publishedAt}>{formatDate(alert.publishedAt, i18n.language)}</time></dd>
      </div>}
      <div>
        <dt><Clock size={17} aria-hidden="true" />{t('alertValidUntil')}</dt>
        <dd><time dateTime={alert.expiresAt}>{formatDate(alert.expiresAt, i18n.language)}</time></dd>
      </div>
    </>;
  }

  return <>
    <article className="public-alert-card">
      <div className={`public-alert-art${image ? '' : ' public-alert-art-plain'}`}>
        {artwork()}
        <div className="public-alert-art-top">
          <span className={`public-alert-severity severity-${alert.severity.toLowerCase()}`}>
            <SeverityIcon size={17} aria-hidden="true" />{severity}
          </span>
          {image && <span className="public-alert-image-label"><ImageIcon size={15} aria-hidden="true" />{t('alertAiIllustration')}</span>}
        </div>
        <span className="public-alert-area"><MapPin size={17} aria-hidden="true" />{alert.area}</span>
      </div>
      <div className="public-alert-body">
        <div className="public-alert-copy">
          <span className={`public-alert-hazard hazard-${kind}`}><KindIcon size={24} aria-hidden="true" /></span>
          <div><h3>{title}</h3><p>{summary}</p></div>
        </div>
        <dl className="public-alert-dates">{dates()}</dl>
        <div className="public-alert-actions">
          <button type="button" className="public-alert-details" onClick={() => setOpen(true)}>
            {t('viewDetails')}<ArrowRight size={16} aria-hidden="true" />
          </button>
          {guidance}
        </div>
      </div>
    </article>
    {open && <WorkspaceDialog title={title} context={severity} className="public-alert-dialog" onDismiss={() => setOpen(false)}>
      {image && <figure className="public-alert-dialog-art">
        {artwork()}
        <figcaption><ImageIcon size={15} aria-hidden="true" />{t('alertIllustrationCaption')}</figcaption>
      </figure>}
      <div className="public-alert-dialog-body">
        <dl className="public-alert-dates">
          <div><dt><MapPin size={17} aria-hidden="true" />{t('alertAffectedArea')}</dt><dd>{alert.area}</dd></div>
          <div><dt><ShieldCheck size={17} aria-hidden="true" />{t('authority')}</dt><dd>{alert.authority}</dd></div>
          {dates()}
        </dl>
        {description && <section className="public-alert-overview">
          <div><h3>{t('alertAbout')}</h3><small>{t('alertAiOverview')}</small></div>
          <p>{description}</p>
        </section>}
        <section className="public-alert-instructions">
          <h3>{t('alertOfficialInstructions')}</h3>
          <p>{message}</p>
        </section>
        <div className="public-alert-actions">{guidance}</div>
      </div>
    </WorkspaceDialog>}
  </>;
}
