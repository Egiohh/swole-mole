// Offline cache. Stale-while-revalidate: every request is answered from the
// cache at once and refreshed in the background, so a deploy shows up on the
// NEXT launch and never swaps code under a session in progress.
// Bump VERSION only to throw the whole old cache away.
const VERSION = 'v1';
const CACHE = 'swolemole-' + VERSION;
const SHELL = [
  './', 'index.html', 'app.js', 'styles.css', 'manifest.json',
  'data/exercises.json', 'data/program.json', 'data/venues.json', 'data/last.json',
  'icons/app-192.png', 'icons/app-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  const fresh = caches.open(CACHE).then(cache => fetch(e.request).then(r => {
    if (r.ok) cache.put(e.request, r.clone());
    return r;
  }));
  e.waitUntil(fresh.catch(() => {}));
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fresh));
});
