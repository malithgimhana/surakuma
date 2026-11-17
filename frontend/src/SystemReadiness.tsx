import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Mail, MapPin, Plug, RefreshCw, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { get } from './api';
import { useCountry } from './geography';
import { Button, Card, ErrorState, Loading, PageHeader, formatDate } from './components';
import './system-readiness.css';

interface SystemStatus {
  checkedAt: string;
  integrations: {
    id: string;
    name: string;
    mode: string;
    state: string;
    detail: string;
    missingSettings: string[];
  }[];
  notificationQueue: { state: string; count: number }[];
}

const serviceIcons = { ai: Sparkles, email: Mail, mapping: MapPin };
const stateTones: Record<string, string> = {
  Configured: 'blue',
  Capture: 'blue',
  Fallback: 'amber',
  Incomplete: 'amber',
  Unavailable: 'red',
  Invalid: 'red',
};
const serviceNotes: Record<string, Record<string, string>> = {
  ai: { Fallback: '' },
  email: { Configured: 'Sender verification and a live test are still needed.' },
  mapping: { Unavailable: 'Manual location entry and online map tiles remain available.' },
};

export function SystemReadiness() {
  const country = useCountry();
  const status = useQuery({
    queryKey: ['admin-system', country],
    queryFn: () => get<SystemStatus>(`/admin/system?countryCode=${country}`),
  });
  const refresh = () => void status.refetch();

  return (
    <div className="integration-dashboard">
      <PageHeader
        title="Integrations"
        description="Review service configuration and notification readiness."
        action={
          <div className="integration-refresh">
            <Button type="button" variant="secondary" busy={status.isFetching} onClick={refresh}>
              {!status.isFetching && <RefreshCw size={18} aria-hidden="true" />}
              Refresh status
            </Button>
            {status.data && (
              <p role="status">
                Checked <time dateTime={status.data.checkedAt}>{formatDate(status.data.checkedAt)}</time>
              </p>
            )}
          </div>
        }
      />
      {status.error && <ErrorState error={status.error} retry={refresh} />}
      {status.isPending && <Card><Loading /></Card>}
      {status.data && (
        <div className="integration-panels">
          <section className="card integration-panel" aria-labelledby="integration-readiness-heading">
            <h2 id="integration-readiness-heading">Integration readiness</h2>
            <p className="muted integration-panel-subtitle">Shared configuration</p>
            {status.data.integrations.length ? (
              <div className="integration-services">
                {status.data.integrations.map((service) => {
                  const Icon = serviceIcons[service.id as keyof typeof serviceIcons] ?? Plug;
                  const note = serviceNotes[service.id]?.[service.state] ?? service.detail;
                  return (
                    <section key={service.id} className="integration-service" aria-label={service.name}>
                      <span className="integration-service-icon"><Icon aria-hidden="true" /></span>
                      <div className="integration-service-heading">
                        <h3>{service.name}</h3>
                        <span className="integration-state" data-tone={stateTones[service.state]}>{service.state}</span>
                      </div>
                      <div className="integration-service-details">
                        <p className="integration-provider">{service.mode}</p>
                        {service.missingSettings.length > 0 && (
                          <p className="muted">
                            {service.missingSettings.length === 1 ? 'Missing setting:' : 'Missing settings:'}{' '}
                            {service.missingSettings.map((setting, index) => (
                              <span key={setting}>{index > 0 && ', '}<code>{setting}</code></span>
                            ))}
                          </p>
                        )}
                        {note && <p className="muted">{note}</p>}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : <p className="integration-empty muted">No integration status is available.</p>}
            <footer className="integration-panel-footer muted">
              Refresh only checks settings. A configured service still needs a successful live test.
            </footer>
          </section>

          <section className="card integration-panel" aria-labelledby="notification-queue-heading">
            <h2 id="notification-queue-heading">Notification queue</h2>
            <p className="muted integration-panel-subtitle">Deliveries for the selected country</p>
            {status.data.notificationQueue.length ? (
              <dl className="integration-queue">
                {status.data.notificationQueue.map((item) => (
                  <div key={item.state}>
                    <dt>{item.state}</dt>
                    <dd>{item.count.toLocaleString()}</dd>
                  </div>
                ))}
              </dl>
            ) : <p className="integration-empty muted">No notification events yet.</p>}
            <div className="integration-queue-notes muted">
              <p>Captured means saved locally.</p>
              <p>Review means the send outcome needs investigation.</p>
            </div>
            <footer className="integration-panel-footer">
              <Link className="text-link integration-activity-link" to="/admin?section=activity">
                View Activity <ArrowRight size={20} aria-hidden="true" />
              </Link>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
