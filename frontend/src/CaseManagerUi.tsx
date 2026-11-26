import { useState, type ReactNode } from 'react';
import {
  Accessibility,
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  Circle,
  ClipboardList,
  Clock,
  HeartPulse,
  House,
  Layers3,
  MapPin,
  Package,
  Siren,
  Truck,
  UserRound,
  Users,
  Utensils,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, formatDate } from './components';
import { MapView } from './MapView';
import { unitSymbol } from './quantity';
import type { AidRequest, Category, RequestDetail, Status } from './types';

const categoryIcons: Record<Category, LucideIcon> = {
  FoodWater: Utensils,
  Medical: HeartPulse,
  Shelter: House,
  Transportation: Truck,
  Accessibility,
  Other: Package,
};

export function CategoryIcon({ category }: { category: Category }) {
  const Icon = categoryIcons[category] ?? Package;
  return (
    <span className={`cm-category cm-category--${category}`}>
      <Icon aria-hidden="true" size={24} />
    </span>
  );
}

export function PanelTitle({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="cm-panel-title">
      <Icon aria-hidden="true" size={26} />
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="cm-panel-action">{action}</div>}
    </div>
  );
}

export function CaseLink({
  id,
  reference,
  queue,
  children,
}: {
  id: string;
  reference: string;
  queue?: string;
  children: ReactNode;
}) {
  return (
    <Link
      className="cm-review-link"
      to={`/staff/cases/${id}`}
      state={queue ? { caseQueue: queue } : undefined}
      aria-label={`Review case ${reference}`}
    >
      {children}
      <ArrowRight aria-hidden="true" size={16} />
    </Link>
  );
}

type MeasuredCase = Pick<
  AidRequest,
  'category' | 'unit' | 'unitRequiresClarification' | 'quantity' | 'deliveredQuantity' | 'intake'
>;

export function awaitingUnit(
  request: Pick<MeasuredCase, 'category' | 'unit' | 'unitRequiresClarification'>,
) {
  return request.unitRequiresClarification ?? (request.category !== 'Shelter' && !request.unit);
}

export function caseAmounts(request: MeasuredCase, items?: RequestDetail['items']) {
  const itemCount = items?.length || request.intake?.supplyItems?.length || 0;
  if (itemCount > 1) {
    const delivered = items?.filter(item => item.deliveredQuantity >= item.approvedQuantity).length;
    return {
      requested: `${itemCount} items`,
      delivered: delivered == null ? 'See case items' : `${delivered} of ${itemCount} items complete`,
      outstanding: delivered == null ? 'See case items' : `${itemCount - delivered} items remaining`,
      progress: null,
    };
  }
  const unclear = awaitingUnit(request);
  const unit =
    request.category === 'Shelter' && !request.unit ? 'household' : unitSymbol(request.unit);
  const outstanding = Math.max(
    0,
    Number((request.quantity - request.deliveredQuantity).toFixed(5)),
  );
  const format = (quantity: number) =>
    [
      quantity.toLocaleString(undefined, { maximumFractionDigits: 5 }),
      unit === 'household' && quantity !== 1 ? 'households' : unit,
    ]
      .filter(Boolean)
      .join(' ');
  return {
    requested: format(request.quantity),
    delivered: unclear ? 'Unconfirmed unit' : format(request.deliveredQuantity),
    outstanding: unclear ? 'Awaiting clarification' : format(outstanding),
    progress:
      unclear || request.quantity <= 0
        ? null
        : Math.min(100, Math.round((request.deliveredQuantity / request.quantity) * 100)),
  };
}

export function UnitWarning() {
  const { t } = useTranslation();
  return (
    <span className="cm-unit-warning">
      <AlertTriangle size={16} aria-hidden="true" />
      {t('unitRequiresClarification')}
    </span>
  );
}

const lifecycle: { label: string; states: Status[] }[] = [
  { label: 'Submitted', states: ['Submitted'] },
  { label: 'Under review', states: ['UnderReview'] },
  { label: 'Verified', states: ['Verified'] },
  { label: 'Approved', states: ['Approved'] },
  { label: 'Fulfilment', states: ['InProgress', 'PartiallyFulfilled', 'Fulfilled'] },
  { label: 'Closed', states: ['Closed'] },
];
const stageDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Colombo',
});

function Lifecycle({ detail }: { detail: RequestDetail }) {
  const status = detail.request.status;
  const end = status === 'Rejected' || status === 'Cancelled';
  const stages = end
    ? lifecycle
        .slice(0, 4)
        .filter((stage) =>
          detail.history.some((event) => stage.states.includes(event.status as Status)),
        )
        .concat({ label: status, states: [status] })
    : lifecycle;
  return (
    <ol className="cm-lifecycle" aria-label="Case lifecycle">
      {stages.map((stage) => {
        const event = detail.history.find((item) => stage.states.includes(item.status as Status));
        const current = stage.states.includes(status);
        const partial = current && stage.label === 'Fulfilment' && status !== 'Fulfilled';
        return (
          <li
            key={stage.label}
            data-recorded={!!event}
            data-terminal={end && current}
            aria-current={current ? 'step' : undefined}
          >
            <span className="cm-stage-dot">
              {event && !partial && !(end && current) ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Circle size={12} aria-hidden="true" />
              )}
            </span>
            <strong>{stage.label}</strong>
            {event && (
              <time dateTime={event.createdAt} title={formatDate(event.createdAt)}>
                {stageDate.format(new Date(event.createdAt))}
              </time>
            )}
            <span className="sr-only">{event ? 'Recorded' : 'No recorded transition'}</span>
          </li>
        );
      })}
    </ol>
  );
}

function CaseLocation({ latitude, longitude }: { latitude: number; longitude: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="cm-case-map">
      <Button
        variant="ghost"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <MapPin aria-hidden="true" size={16} />
        {expanded ? 'Collapse map' : 'Expand map'}
      </Button>
      <MapView key={String(expanded)} point={[latitude, longitude]} height={expanded ? 320 : 175} />
    </div>
  );
}

export function CaseManagerDetailLayout({
  detail,
  currentUser,
  organisation,
  crisis,
  assigned,
  notices,
  ai,
  actions,
  supporting,
}: {
  detail: RequestDetail;
  currentUser?: string;
  organisation?: string;
  crisis?: string;
  assigned: string;
  notices: ReactNode;
  ai: ReactNode;
  actions: ReactNode;
  supporting: ReactNode;
}) {
  const { t } = useTranslation();
  const r = detail.request;
  const amounts = caseAmounts(r, detail.items);
  const category = t('category.' + r.category);
  const facts: [LucideIcon, string, string][] = [
    [Users, 'Household size', `${r.householdSize} people`],
    [MapPin, 'Location', r.locationText || 'Not recorded'],
    [Layers3, 'Administrative region', detail.administrativeRegion || 'Not recorded'],
    [Siren, 'Related crisis', detail.crisisName || crisis || 'Not available'],
    [
      Building2,
      'Organisation',
      detail.organisationName ||
        organisation ||
        (r.organisationId ? 'Assigned' : 'Awaiting assignment'),
    ],
    [UserRound, 'Case Manager', assigned],
    [CalendarDays, 'Submitted', r.createdAt ? formatDate(r.createdAt) : 'Not recorded'],
  ];
  if (r.requestedForSomeoneElse) {
    if (r.requesterRelationship)
      facts.push([UserRound, 'Requester’s relationship', r.requesterRelationship]);
    if (r.requesterContact) facts.push([UserRound, 'Requester contact', r.requesterContact]);
  }
  if (r.accessibilityNeeds)
    facts.push([Accessibility, 'Accessibility needs', r.accessibilityNeeds]);
  return (
    <div className="cm-page cm-details">
      <header className="cm-page-header">
        <div>
          <div className="cm-title-line">
            <h1>{r.reference}</h1>
            <Badge value={r.priority} />
          </div>
          <p>
            {category} · {r.householdSize} household members
          </p>
        </div>
        <div className="cm-header-chips">
          <span>
            Status: <Badge value={r.status} />
          </span>
          <span>
            <UserRound size={17} aria-hidden="true" />
            Assigned to: <strong>{assigned}</strong>
          </span>
        </div>
      </header>
      <Lifecycle detail={detail} />
      {notices}
      <div className="cm-detail-grid">
        <section className="cm-need-column" aria-label="Needs and decision support">
          <Card className="cm-panel cm-needs">
            <PanelTitle
              icon={categoryIcons[r.category] ?? Package}
              title="Citizen Needs — Requested Assistance"
            />
            <div className="cm-assistance">
              <CategoryIcon category={r.category} />
              <div>
                <small>Assistance requested</small>
                <h3>{category}</h3>
              </div>
            </div>
            <dl className="cm-amounts">
              {(
                [
                  [Layers3, 'Quantity required', amounts.requested],
                  [Users, 'People affected', `${r.householdSize} people`],
                  [Check, 'Already delivered', amounts.delivered],
                  [Package, 'Outstanding assistance', amounts.outstanding],
                ] as const
              ).map(([Icon, label, value]) => (
                <div key={label}>
                  <Icon size={22} aria-hidden="true" />
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {awaitingUnit(r) && <UnitWarning />}
            <div className="cm-special">
              <Accessibility size={19} aria-hidden="true" />
              <strong>Special requirements</strong>
              <span>{r.accessibilityNeeds || 'None reported'}</span>
            </div>
            {!r.intake && <>
              <h3 className="cm-description-title">
                <ClipboardList size={18} aria-hidden="true" />
                {t('citizenRequestDescription')}
              </h3>
              <p className="cm-original-description">{r.description}</p>
            </>}
          </Card>
          {ai}
        </section>
        <Card className="cm-panel cm-case-info">
          <PanelTitle icon={Users} title="Citizen & Case Information" />
          <dl className="cm-facts">
            {facts.map(([Icon, label, value]) => (
              <div key={label}>
                <dt>
                  <Icon size={17} aria-hidden="true" />
                  {label}
                </dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {r.latitude != null && r.longitude != null && (
            <CaseLocation latitude={r.latitude} longitude={r.longitude} />
          )}
        </Card>
        <div className="cm-action-column">
          {actions}
          <section id="fulfilment" tabIndex={-1}>
            <Card className="cm-panel">
              <PanelTitle icon={Package} title="Fulfilment Summary" />
              {amounts.progress !== null && (
                <div className="cm-progress">
                  <progress aria-label="Fulfilment progress" max={100} value={amounts.progress} />
                  <strong>{amounts.progress}%</strong>
                </div>
              )}
              <dl className="cm-summary-amounts">
                <div>
                  <dt>Required</dt>
                  <dd>{amounts.requested}</dd>
                </div>
                <div>
                  <dt>Delivered</dt>
                  <dd>{amounts.delivered}</dd>
                </div>
                <div>
                  <dt>Outstanding</dt>
                  <dd>{amounts.outstanding}</dd>
                </div>
              </dl>
            </Card>
          </section>
          <section id="case-history">
            <Card className="cm-panel">
              <PanelTitle
                icon={Clock}
                title="Case Timeline"
                description="Recorded events · newest first"
              />
              {detail.history.length ? (
                <ol className="cm-timeline">
                  {[...detail.history].reverse().map((h) => (
                    <li key={h.id}>
                      <span className="cm-timeline-label">
                        <Badge value={h.status} />
                        <span className="cm-timeline-meta">
                          <time dateTime={h.createdAt}>{formatDate(h.createdAt)}</time>
                          {currentUser && h.actorId === currentUser && <small> · You</small>}
                        </span>
                      </span>
                      {h.note && <p>{h.note}</p>}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted">No lifecycle events recorded.</p>
              )}
            </Card>
          </section>
        </div>
      </div>
      {supporting}
    </div>
  );
}
