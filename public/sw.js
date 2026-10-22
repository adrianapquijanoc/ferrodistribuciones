// Permite instalar la aplicación, abrirla aunque la conexión falle por un momento
// y mostrar los avisos en el celular o computador aunque la aplicación esté cerrada.
// Los datos (/api) siempre se piden al servidor; nunca se guardan aquí.
const CACHE = 'ferro-v2';
const SHELL = ['/', '/index.html', '/app.js', '/styles.css', '/logo.png', '/logo-pdf.jpg', '/icon-192.png', '/manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request).then(m => m || caches.match('/index.html'))));
});

// El aviso llega vacío; aquí se pide el texto al servidor con la sesión de la persona.
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let title = 'Ferro Pedidos', body = 'Tienes avisos nuevos.', ref = '', tag = 'ferro';
    try {
      const r = await fetch('/api/push/latest', { credentials: 'include', headers: { 'x-ferro': '1' } });
      if (r.ok) {
        const d = await r.json();
        if (d.items && d.items.length) {
          body = d.items[0].text; ref = d.items[0].ref || ''; tag = 'ferro-' + d.items[0].id;
          if (d.count > 1) title = `Ferro Pedidos · ${d.count} avisos sin leer`;
        }
      } else if (r.status === 401) body = 'Tienes avisos nuevos. Entra a la aplicación para verlos.';
    } catch (err) { /* sin conexión: se muestra el aviso genérico */ }
    await self.registration.showNotification(title, { body, tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { ref }, renotify: true });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const ref = (e.notification.data && e.notification.data.ref) || '';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all.find(c => new URL(c.url).origin === location.origin);
    if (client) { await client.focus(); if (ref) client.postMessage({ open: ref }); return; }
    await self.clients.openWindow('/' + (ref ? '#' + ref : ''));
  })());
});
