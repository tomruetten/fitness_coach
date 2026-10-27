const V = 'coach-v2';
const SHELL = ['/', '/style.css', '/app.js', '/manifest.webmanifest', '/icons/icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.startsWith('/api/')) return; // API: Netz, Offline-Stand verwaltet die App selbst
  e.respondWith(fetch(r).then((res) => { const c = res.clone(); caches.open(V).then((ch) => ch.put(r, c)); return res; }).catch(() => caches.match(r).then((m) => m || caches.match('/'))));
});
