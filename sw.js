/* Offline support.
   Same shape as the Costa Rica trip's service worker: cache the shell, keep
   live data (Supabase, the FX rate) out of the cache entirely, and never let
   a stale snapshot mask an updated page. */

const VERSION = 'ba26-v15';
const CORE = [
  './',
  './index.html',
  './assets/style.css',
  './assets/trip-state.js',
  './manifest.webmanifest',
  './icon.svg'
];

// Live data must never be served from cache. Match on a dot boundary: a bare
// endsWith would also swallow notsupabase.co.
const NEVER_CACHE = ['supabase.co', 'api.frankfurter.app'];
const isLiveData = host => NEVER_CACHE.some(h => host === h || host.endsWith('.' + h));

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      // One failed asset must not fail the whole install.
      .then(c => Promise.allSettled(CORE.map(u => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (isLiveData(url.hostname)) return;

  // Documents: network first, so an updated itinerary is never masked by a stale copy.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // The rest of our own shell — stylesheet, state module, manifest, icon — is
  // small and changes with the page, so it follows the same rule the document
  // does: network first. Cache-first here is what made every CSS edit depend on
  // remembering to bump VERSION, and a returning visitor could get new markup
  // against an old stylesheet. The deadline keeps a slow link from blocking
  // first paint: past it, the cached copy is served instead of waiting.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      // Revalidate rather than trusting the HTTP cache: hosts send a non-zero
      // max-age for assets, and a plain fetch() here would be answered by the
      // browser cache without ever asking the server — network-first in name
      // only. 'no-cache' sends the conditional request, so an unchanged file
      // costs a 304 and a changed one actually arrives.
      const net = fetch(new Request(req, { cache: 'no-cache' })).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy));
        }
        return res;
      });
      const raced = await Promise.race([
        net.catch(() => null),
        new Promise(resolve => setTimeout(() => resolve(null), 1500))
      ]);
      if (raced) return raced;
      // Offline, or slower than the deadline. Fall back to the cache, and if
      // there is nothing cached, wait on the request already in flight rather
      // than starting a second one — a real network error stays a network error.
      return (await caches.match(req)) || net;
    })());
    return;
  }

  // Cross-origin (fonts, the Supabase bundle): large, effectively immutable, so
  // cache first and refresh in the background.
  event.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req)
        .then(res => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(VERSION).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
