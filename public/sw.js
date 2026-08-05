// BillSplitter — service worker (Faza 6.1)
// Offline app-shell przez runtime caching (bez precache-manifestu — Vite hashuje nazwy).
// Strategia: network-first dla nawigacji (zawsze świeża wersja gdy online, fallback offline),
//            cache-first + odświeżenie w tle (stale-while-revalidate) dla statycznych zasobów.
const CACHE = 'billsplitter-v2';

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

// --- Faza 6.4: powiadomienia push ---
// Świadomie BEZ SDK Firebase w service workerze: wysyłamy payload data-only, więc
// przeglądarka nie pokaże nic sama, a my mamy pełną kontrolę nad treścią i kliknięciem.
// Dzięki temu zostaje JEDEN service worker (offline + push), bez firebase-messaging-sw.js.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = {}; }
  const payload = d.data || d; // FCM data-only pakuje treść w `data`
  const title = payload.title || 'BillSplitter';
  const body = payload.body || 'Masz nowe przypomnienie.';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    tag: payload.tag || 'billsplitter-nudge',
    data: { url: payload.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Apka już otwarta? Podnieś istniejące okno zamiast otwierać kolejne.
    for (const c of all) {
      if ('focus' in c) {
        if ('navigate' in c && target !== '/') { try { await c.navigate(target); } catch (_) {} }
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
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

  // Ruch do Firebase (Firestore, Storage, Auth, Functions) NIE MOŻE iść przez nasz cache:
  // to dane na żywo, a przechwycona odpowiedź potrafi wrócić do strony w postaci,
  // której `fetch` nie umie odczytać (TypeError: Failed to fetch przy pobieraniu zdjęcia).
  // Cache'ujemy wyłącznie własne zasoby i znane CDN-y z bibliotekami.
  const url = new URL(req.url);
  // Tailwind wypadł z tej listy przy przejściu z CDN na kompilację — arkusz jest teraz
  // własnym zasobem (same-origin), więc wpis o hoście CDN był już tylko martwym kodem.
  const CACHEABLE_HOSTS = [
    'cdnjs.cloudflare.com', 'cdn.jsdelivr.net',
    'fonts.googleapis.com', 'fonts.gstatic.com',
  ];
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CACHEABLE_HOSTS.includes(url.hostname)) return;

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
