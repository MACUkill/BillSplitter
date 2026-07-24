// BillSplitter — service worker (Faza 6.1)
// Offline app-shell przez runtime caching (bez precache-manifestu — Vite hashuje nazwy).
// Strategia: network-first dla nawigacji (zawsze świeża wersja gdy online, fallback offline),
//            cache-first + odświeżenie w tle (stale-while-revalidate) dla statycznych zasobów.
const CACHE = 'billsplitter-v1';

self.addEventListener('install', () => {
  // Nowy SW przejmuje od razu — bez czekania na zamknięcie kart.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Nawigacje (wejście / odświeżenie strony): network-first → offline fallback do cache.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch (_) {
        const cache = await caches.open(CACHE);
        const cached = (await cache.match(req)) || (await cache.match('/index.html')) || (await cache.match('/'));
        return cached || Response.error();
      }
    })());
    return;
  }

  // Statyczne zasoby (JS/CSS/ikony/fonty, też CDN): cache-first + odświeżenie w tle.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      // Cache'uj tylko udane odpowiedzi (same-origin ok) lub opaque (cross-origin CDN).
      if (res && (res.ok || res.type === 'opaque')) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
