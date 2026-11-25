import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, get } from './api';
import { useAuth } from './auth';
import { Button, Card, ErrorState } from './components';

const workerPath = '/surakuma-push.js';

export function BrowserPushSettings() {
  return window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
    ? <PushControl /> : null;
}

function PushControl() {
  const { user } = useAuth();
  const client = useQueryClient();
  const queryKey = ['browser-push', user?.id];
  const status = useQuery({
    queryKey,
    queryFn: async () => {
      const config = await get<{ enabled: boolean; publicKey: string | null }>('/browser-push');
      const registration = await navigator.serviceWorker.getRegistration(workerPath);
      const subscription = await registration?.pushManager.getSubscription();
      const subscribed = subscription ? (await api.post<{ subscribed: boolean }>('/browser-push/status', {
        endpoint: subscription.endpoint,
      })).data.subscribed : false;
      return { ...config, subscribed };
    },
  });
  const change = useMutation({
    mutationFn: async (enable: boolean) => {
      if (!enable) {
        const registration = await navigator.serviceWorker.getRegistration(workerPath);
        const subscription = await registration?.pushManager.getSubscription();
        if (!subscription) return;
        await api.post('/browser-push/unsubscribe', { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
        return;
      }
      const key = status.data?.publicKey;
      if (!key || await Notification.requestPermission() !== 'granted')
        throw new Error('Allow notifications in your browser settings to enable this feature.');
      await navigator.serviceWorker.register(workerPath);
      const registration = await navigator.serviceWorker.ready;
      const old = await registration.pushManager.getSubscription();
      if (old) await old.unsubscribe();
      const decoded = atob(key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '='));
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: Uint8Array.from(decoded, char => char.charCodeAt(0)),
      });
      try {
        const { keys } = subscription.toJSON();
        await api.post('/browser-push/subscribe', {
          endpoint: subscription.endpoint, publicKey: keys?.p256dh, authSecret: keys?.auth,
        });
      } catch (error) {
        await subscription.unsubscribe();
        throw error;
      }
    },
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
  if (status.isPending) return null;
  return <Card>
    <div className="inline spread">
      <div><h2>Browser notifications</h2>
        <p>{status.data?.subscribed ? 'Enabled on this browser.' :
          status.data?.enabled ? 'Get a browser notification when Surakuma has an update.' : 'Browser delivery is unavailable here.'}</p></div>
      {(status.data?.subscribed || status.data?.enabled) && <Button type="button" variant="secondary" busy={change.isPending}
        onClick={() => change.mutate(!status.data?.subscribed)}>{status.data?.subscribed ? 'Disable' : 'Enable browser notifications'}</Button>}
    </div>
    {(change.error || status.error) && <ErrorState error={change.error || status.error} />}
  </Card>;
}
