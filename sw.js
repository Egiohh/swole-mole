// Offline cache. Network first, cache as fallback: with a connection every
// launch gets the latest deploy; without one (or if the network takes longer
// than NETWORK_TIMEOUT_MS) the cached copy is used. Code only loads when the
// page opens, so a deploy never swaps code under a session in progress.
// Bump VERSION only to throw the whole old cache away.
const VERSION = 'v2';
const CACHE = 'swolemole-' + VERSION;
const NETWORK_TIMEOUT_MS = 3000;
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

// After a timeout, treat the network as dead for a while and answer from the
// cache at once - otherwise page, scripts and data would each wait out the
// timeout in turn on a connected-but-dead gym network.
const DEAD_NETWORK_MS = 30000;
let networkDeadUntil = 0;

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // cache: 'no-cache' revalidates with the server instead of trusting the
  // browser's HTTP cache (GitHub Pages allows 10 minutes of staleness).
  const network = fetch(e.request, { cache: 'no-cache' }).then(async r => {
    if (r.ok) await (await caches.open(CACHE)).put(e.request, r.clone());
    return r;
  });
  e.waitUntil(network.catch(() => {})); // finish updating the cache even after a timeout
  e.respondWith((async () => {
    if (Date.now() > networkDeadUntil) {
      const timeout = new Promise(ok => setTimeout(ok, NETWORK_TIMEOUT_MS, null));
      const fresh = await Promise.race([network.catch(() => null), timeout]);
      if (fresh) return fresh;
      networkDeadUntil = Date.now() + DEAD_NETWORK_MS;
    }
    const cached = await caches.match(e.request, { ignoreSearch: true });
    return cached ?? network; // nothing cached: keep waiting for the network
  })());
});
