const updateText = {
  en: 'Open Surakuma to view your update.',
  si: 'ඔබේ යාවත්කාලීනය බැලීමට සුරකුම විවෘත කරන්න.',
  ta: 'உங்கள் புதுப்பிப்பைப் பார்க்க சுரகுமாவைத் திறக்கவும்.',
  hi: 'अपना अपडेट देखने के लिए सुरकुमा खोलें।',
  ne: 'आफ्नो अपडेट हेर्न सुरकुमा खोल्नुहोस्।',
};

self.addEventListener('push', event => {
  let message;
  try { message = event.data?.json(); } catch { message = null; }
  const path = typeof message?.path === 'string' &&
    /^(?:\/app\/requests\/[0-9a-f-]{36}|\/app\/notifications|\/volunteer\/notifications|\/volunteer\?task=[0-9a-f-]{36})$/i.test(message.path)
    ? message.path : '/app/notifications';
  event.waitUntil(self.registration.showNotification('Surakuma', {
    body: Object.hasOwn(updateText, message?.language) ? updateText[message.language] : updateText.en,
    tag: typeof message?.tag === 'string' ? message.tag : 'surakuma-update',
    data: { path },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.path ?? '/app/notifications', self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url === url.href);
    if (existing) return existing.focus();
    return self.clients.openWindow(url.href);
  })());
});
