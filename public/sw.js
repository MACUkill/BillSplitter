// Billiada: service worker (Faza 6.1)
// Offline app-shell przez runtime caching (bez precache-manifestu — Vite hashuje nazwy).
// Strategia: network-first dla nawigacji (zawsze świeża wersja gdy online, fallback offline),
//            cache-first + odświeżenie w tle (stale-while-revalidate) dla statycznych zasobów.
// NAZWA PAMIĘCI PODRĘCZNEJ JEST WERSJONOWANA i to nie jest kosmetyka.
// Handler `activate` kasuje WSZYSTKIE pamięci o innej nazwie, więc podbicie tej stałej
// jest jedynym sposobem, żeby telefon wyrzucił zasoby o niezmiennych nazwach: manifest,
// ikony, `index.html`. Zasoby z katalogu `assets` mają skrót w nazwie i odnawiają się
// same, ale `/icons/icon-192x192.png` nazywa się tak samo przed i po podmianie rysunku.
//
// PODBIJ TĘ WERSJĘ przy każdej zmianie nazwy aplikacji, ikon albo manifestu.
// v4 podbity NIEZALEŻNIE w dwóch liniach pracy i scalony 2026-08-17 — obie miały ten sam
// powód formalny (trzeba wyrzucić starą pamięć), ale różne merytoryczne. Ze strony audytu:
// z listy cache'owanych hostów wypadły martwe CDN-y, więc odpowiedzi z tych adresów mogły
// jeszcze leżeć komuś na telefonie i trzeba je skasować.
const CACHE = 'billiada-v4';

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
  const title = payload.title || 'Billiada';
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
  //
  // CACHE'UJEMY WYŁĄCZNIE WŁASNE ZASOBY (audyt 2026-08-16).
  // Stała lista dozwolonych CDN-ów (cdnjs, jsdelivr, fonts.googleapis, fonts.gstatic)
  // była już w całości martwa: kroje, ikony, QR i arkusz stylów idą z paczek npm i lądują
  // w buildzie jako zasoby własne (§18 w docs/UI-UX.md). Sprawdzone przeszukaniem całego
  // `dist/`, `index.html` i `src/` — zero odwołań do któregokolwiek z tych adresów.
  // Zostawiona lista sugerowałaby, że aplikacja nadal wisi na cudzych serwerach.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // TOŻSAMOŚĆ APLIKACJI IDZIE ZAWSZE Z SIECI, nie z pamięci podręcznej.
  //
  // Manifest i ikony mają NIEZMIENNE nazwy plików, więc przy strategii „najpierw cache"
  // telefon trzymał je w nieskończoność. Objaw zgłoszony przez właściciela: iPhone przy
  // dodawaniu do ekranu początkowego podpowiadał starą nazwę aplikacji, choć na serwerze
  // od dawna była nowa. To samo dotyczyłoby podmienionego rysunku ikony.
  //
  // Te pliki są malutkie i pobierane rzadko (raz na wejście), więc „najpierw sieć"
  // nic nie kosztuje, a offline i tak spada do kopii z pamięci.
  const isIdentity = url.pathname === '/manifest.json' || url.pathname.startsWith('/icons/');
  if (isIdentity) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-cache' });
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch (_) {
        const cache = await caches.open(CACHE);
        return (await cache.match(req)) || Response.error();
      }
    })());
    return;
  }

  // Statyczne zasoby (JS/CSS/fonty, też CDN): cache-first + odświeżenie w tle.
  // Ich nazwy niosą skrót zawartości, więc stara kopia nigdy nie udaje nowej.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      // Tylko udane odpowiedzi — po wypadnięciu CDN-ów wszystko tu jest same-origin.
      if (res && res.ok) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
