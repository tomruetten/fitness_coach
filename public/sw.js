const V = 'coach-v25';
const SHELL = ['/', '/style.css', '/app.js', '/util.js', '/charts.js', '/motion.js', '/analysis.js', '/strength.js', '/manifest.webmanifest', '/icons/icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.startsWith('/api/')) return; // API: Netz, Offline-Stand verwaltet die App selbst
  e.respondWith(fetch(r, { cache: 'no-cache' }).then((res) => { const c = res.clone(); caches.open(V).then((ch) => ch.put(r, c)); return res; }).catch(() => caches.match(r).then((m) => m || caches.match('/'))));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { /* ohne Inhalt */ }
  e.waitUntil(self.registration.showNotification(d.title || 'Fitness Coach', { body: d.body || '', icon: '/icons/icon-180.png', data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => (cs.length && 'focus' in cs[0] ? cs[0].focus() : self.clients.openWindow(e.notification.data?.url || '/'))));
});
