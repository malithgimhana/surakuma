import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { get } from './api';
import { Badge, Button, Card, ErrorState, Loading, formatDate } from './components';

interface SystemStatus {
  demonstrationMode: boolean;
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

export function SystemReadiness() {
  const status = useQuery({
    queryKey: ['admin-system'],
    queryFn: () => get<SystemStatus>('/admin/system'),
  });
  return (
    <Card>
      <div className="inline spread">
        <h2>Integration readiness</h2>
        <Button variant="secondary" busy={status.isFetching} onClick={() => void status.refetch()}>
          <RefreshCw size={16} /> Refresh status
        </Button>
      </div>
      <p className="muted">
        Configuration status only. A configured service still needs a successful live test.
        Refreshing does not contact providers or send email.
      </p>
      {status.isPending ? (
        <Loading />
      ) : status.error ? (
        <ErrorState error={status.error} retry={() => void status.refetch()} />
      ) : (
        status.data && (
          <>
            <p>
              {status.data.demonstrationMode ? 'Local demonstration mode' : 'Application mode'} ·
              Checked {formatDate(status.data.checkedAt)}
            </p>
            <div className="resource-grid">
              {status.data.integrations.map((integration) => (
                <section key={integration.id} aria-label={integration.name}>
                  <h3>{integration.name}</h3>
                  <Badge value={integration.state} />
                  <p>
                    <strong>{integration.mode}</strong>
                  </p>
                  <p>{integration.detail}</p>
                  {integration.missingSettings.length > 0 && (
                    <p className="muted">
                      Missing server settings:{' '}
                      {integration.missingSettings.map((setting, index) => (
                        <span key={setting}>
                          {index > 0 && ', '}
                          <code>{setting}</code>
                        </span>
                      ))}
                    </p>
                  )}
                </section>
              ))}
            </div>
            <h3>Notification queue</h3>
            {status.data.notificationQueue.length === 0 ? (
              <p>No notification events yet.</p>
            ) : (
              <ul>
                {status.data.notificationQueue.map((item) => (
                  <li key={item.state}>
                    <strong>{item.state}</strong>: {item.count}
                  </li>
                ))}
              </ul>
            )}
            <p className="muted">
              Captured means saved locally. Review means the send outcome needs investigation before
              another attempt. See notification delivery history below for individual events.
            </p>
          </>
        )
      )}
    </Card>
  );
}
