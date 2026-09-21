/* FORJA — service worker
   Por enquanto só serve para as notificações de lembrete (o Android exige um service worker).
   Não guarda nada em cache: o app continua sempre carregando a versão mais nova dos arquivos. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Tocar na notificação: volta para o FORJA aberto ou abre uma janela nova
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          if ('navigate' in c) c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
