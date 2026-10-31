import { cloneElement, isValidElement, useId } from 'react';
import type { ReactNode, ReactElement, ButtonHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ArrowRight, Check, HeartHandshake, LoaderCircle, MapPin } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { errorMessage } from './api';
import type { Category } from './types';
export function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Surakuma home">
      <span className="brand-mark">
        <HeartHandshake size={28} strokeWidth={2.3} />
      </span>
      <span>
        <strong lang="si">සුරැකුම</strong>
        <small>SURAKUMA</small>
      </span>
    </Link>
  );
}
export function Button({
  children,
  variant = 'primary',
  busy = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
}) {
  return (
    <button className={`button ${variant}`} {...props} disabled={props.disabled || busy}>
      {busy && <LoaderCircle size={18} className="spin" />}
      {children}
    </button>
  );
}
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}
export function Field({
  label,
  children,
  error,
  hint,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  hint?: string;
}) {
  const id = useId();
  const described =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {isValidElement(children)
        ? cloneElement(
            children as ReactElement<{
              id: string;
              'aria-describedby'?: string;
              'aria-invalid'?: boolean;
            }>,
            { id, 'aria-describedby': described, 'aria-invalid': error ? true : undefined },
          )
        : children}
      {hint && (
        <small className="muted" id={`${id}-hint`}>
          {hint}
        </small>
      )}
      {error && (
        <small className="field-error" role="alert" id={`${id}-error`}>
          {error}
        </small>
      )}
    </div>
  );
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="error-state" role="alert">
      <AlertCircle size={22} />
      <div>
        <strong>{t('errorTitle')}</strong>
        <p>{t('serviceError')}</p>
        <details>
          <summary>{t('details')}</summary>
          {errorMessage(error)}
        </details>
        {retry && (
          <Button variant="secondary" onClick={retry}>
            {t('retry')}
          </Button>
        )}
      </div>
    </div>
  );
}
export function Loading() {
  const { t } = useTranslation();
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" />
      {t('loading')}
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <HeartHandshake />
      </span>
      <h3>{title}</h3>
      {description && <p className="muted">{description}</p>}
      {action}
    </div>
  );
}
export function Badge({ value }: { value: string }) {
  const { t } = useTranslation();
  const tone = /Critical|Rejected|Cancelled|ShelterClosed|Failed/.test(value)
    ? 'red'
    : /Fulfilled|Completed|Closed|Approved|Open|Sent|Captured|CheckedIn/.test(value)
      ? 'green'
      : /High|Review|Reserved|Partial|Warning/.test(value)
        ? 'amber'
        : 'blue';
  return (
    <span className={`badge ${tone}`}>
      {t(`status.${value}`, { defaultValue: value.replace(/([a-z])([A-Z])/g, '$1 $2') })}
    </span>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function IconTile({ icon: Icon, tone = 'blue' }: { icon: LucideIcon; tone?: string }) {
  return (
    <span className={`icon-tile ${tone}`}>
      <Icon size={26} />
    </span>
  );
}
export function NextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="text-link" to={to}>
      {children}
      <ArrowRight size={17} />
    </Link>
  );
}
export function LocationText({ children }: { children: ReactNode }) {
  return (
    <span className="location">
      <MapPin size={15} />
      {children}
    </span>
  );
}
export function CheckLine({ children }: { children: ReactNode }) {
  return (
    <span className="check-line">
      <Check size={15} />
      {children}
    </span>
  );
}
export const categories: Category[] = [
  'FoodWater',
  'Medical',
  'Shelter',
  'Transportation',
  'Accessibility',
  'Other',
];
export function formatDate(value: string, language = 'en') {
  return new Intl.DateTimeFormat(
    language === 'si' ? 'si-LK' : language === 'ta' ? 'ta-LK' : 'en-GB',
    { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Colombo' },
  ).format(new Date(value));
}
