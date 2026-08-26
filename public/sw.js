// Billiada: service worker (Faza 6.1)
// Offline app-shell przez precache w `install` + runtime caching (bez precache-manifestu
// z buildu — Vite hashuje nazwy, więc listę zasobów wyczytujemy z `index.html` i z CSS).
// Strategia: network-first z limitem czasu dla nawigacji (świeża wersja gdy sieć odpowiada,
//            kopia z pamięci gdy milczy), cache-first + odświeżenie w tle dla statycznych zasobów.
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
//
// NAPRAWA OFFLINE 2026-08-20 ŚWIADOMIE NIE PODBIJA WERSJI. Tożsamość aplikacji się nie
// zmienia (ta sama nazwa, te same ikony, ten sam manifest), a bump kasuje komuś komplet
// zasobów i każe pobrać około megabajta od nowa bez powodu. Sam service worker i tak
// się odświeży, bo zmieniły się jego bajty.
const CACHE = 'billiada-v4';

// Powłoka aplikacji pod jednym, kanonicznym kluczem. Netlify przepisuje KAŻDY adres na
// `index.html` (patrz `netlify.toml`), a numer pokoju aplikacja czyta z `location.search`
// w czasie działania — więc `/`, `/?group=ABC` i `/?group=XYZ` to bajt w bajt ta sama
// odpowiedź. Trzymanie jej pod adresem z zapytaniem tylko mnożyłoby kopie.
const SHELL = '/';

// POWŁOKA IDZIE Z PAMIĘCI NATYCHMIAST — bez czekania na sieć ani sekundy.
//
// Do 2026-08-26 stał tu limit czasu (3000 ms): sieć dostawała trzy sekundy, a dopiero
// potem pokazywaliśmy kopię z pamięci. Przy „net jest, ale nie działa" to były trzy
// sekundy PUSTEGO EKRANU, zanim przeglądarka dostała choćby HTML — czyli dokładnie ten
// „ciemny ekran" ze zgłoszenia właściciela.
//
// Czekanie nie miało zresztą czego kupić. Powłoka to JEDEN plik, identyczny dla każdego
// pokoju; wszystkie dane idą z Firestore na żywo, osobnym kanałem. Świeższa powłoka nie
// znaczy świeższych danych — znaczy tylko nowszą wersję aplikacji, a ta może spokojnie
// dojechać w tle i zgłosić się paskiem „Nowa wersja gotowa".
//
// CENA, KTÓRĄ ŚWIADOMIE PŁACIMY: po wdrożeniu człowiek zobaczy poprzednią wersję do czasu
// odświeżenia. Dlatego strona MUSI mieć obsługę `updatefound` (patrz `registerServiceWorker`
// w main.js) — bez niej ta zmiana zamienia trzy sekundy czekania na cichą starą wersję,
// co jest gorszym problemem niż ten, który naprawiamy.

// Wyłuskuje z tekstu (HTML albo CSS) adresy własnych zasobów. Nazwy plików z `assets`
// niosą skrót zawartości, więc nie da się ich wypisać na sztywno w tym pliku.
const collectAssetUrls = (text) => {
  const out = [];
  const re = /["'(](\/(?:assets|icons)\/[A-Za-z0-9._-]+)["')]/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
};

// PIERWSZE URUCHOMIENIE MUSI ZAPEŁNIĆ PAMIĘĆ SAMO.
// Nawigacja, w trakcie której service worker dopiero się instaluje, NIE PRZECHODZI przez
// jego handler `fetch` — razem z całą resztą zasobów tej strony. Bez tego precache pierwszy
// start online nie zapisywał niczego i offline kończyło się białym ekranem; dopiero drugie
// wejście online zapełniało pamięć. Na iOS bolało podwójnie, bo aplikacja z ekranu
// początkowego ma własny, pusty magazyn — kliknięcia w Safari go nie zapełniają.
//
// Zapisujemy pojedynczymi `put` w `try/catch`, NIE przez `addAll`: `addAll` jest atomowe,
// więc jeden nieudany zasób wywala całą instalację service workera.
const precacheShell = async () => {
  const cache = await caches.open(CACHE);
  let html = '';
  try {
    const res = await fetch(SHELL, { cache: 'reload' });
    if (!res || !res.ok) return;
    html = await res.clone().text();
    await cache.put(SHELL, res);
  } catch (_) {
    return; // Brak sieci w chwili instalacji: runtime caching dopisze resztę przy okazji.
  }

  const urls = new Set(collectAssetUrls(html));

  // Kroje pisma i ikony wektorowe siedzą w `url(...)` wewnątrz CSS, nie w HTML —
  // trzeba wejść piętro niżej, inaczej offline aplikacja wstaje w zapasowym kroju.
  for (const href of [...urls]) {
    if (!href.endsWith('.css')) continue;
    try {
      const res = await fetch(href);
      if (!res || !res.ok) continue;
      const text = await res.clone().text();
      collectAssetUrls(text).forEach((u) => urls.add(u));
      await cache.put(href, res);
    } catch (_) { /* pojedynczy arkusz nie może przewrócić instalacji */ }
  }

  await Promise.all([...urls].map(async (href) => {
    if (await cache.match(href)) return;
    try {
      const res = await fetch(href);
      if (res && res.ok) await cache.put(href, res);
    } catch (_) { /* jw. */ }
  }));
};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try { await precacheShell(); } catch (_) {}
  })());
});

// NOWY SW NIE PRZEJMUJE STERÓW SAM — i to jest zmiana z 2026-08-26, nie przeoczenie.
//
// Stało tu `skipWaiting()`, czyli nowy service worker wchodził natychmiast, w środku życia
// otwartej strony. Przy pamięci pierwszej (patrz komentarz przy nawigacji) znaczyłoby to,
// że NOWY worker podaje NOWE pliki stronie działającej na STARYM kodzie. Nazwy zasobów
// niosą skrót zawartości, więc kawałek doładowywany leniwie (`heic2any` przy zdjęciu
// z iPhone'a) może po prostu nie istnieć w nowym wydaniu — i wtedy funkcja przestaje
// działać w połowie sesji, bez żadnego komunikatu.
//
// Teraz nowy worker czeka, strona wykrywa go przez `updatefound` i pokazuje pasek
// „Nowa wersja gotowa". Sterowanie przejmuje dopiero wtedy, gdy CZŁOWIEK naciśnie odśwież —
// czyli w momencie, w którym i tak cały kod ładuje się od nowa.
self.addEventListener('message', (event) => {
  if ((event.data || {}).type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Dogrzewanie pamięci tym, co strona faktycznie pobrała (`registerServiceWorker` w main.js).
// Precache czyta `index.html` i CSS, więc nie zna kawałków ładowanych leniwie — na przykład
// `heic2any`, który dojeżdża dopiero przy wgrywaniu zdjęcia z iPhone'a.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'warm-cache' || !Array.isArray(data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(data.urls.map(async (raw) => {
      let url;
      try { url = new URL(raw, self.location.origin); } catch (_) { return; }
      // Ta sama zasada co w `fetch`: TYLKO własne zasoby, nigdy ruch do Firebase.
      if (url.origin !== self.location.origin) return;
      if (!/^\/(assets|icons)\//.test(url.pathname)) return;
      if (await cache.match(url.href)) return;
      try {
        const res = await fetch(url.href);
        if (res && res.ok) await cache.put(url.href, res);
      } catch (_) {}
    }));
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

  // Nawigacje (wejście / odświeżenie strony): sieć wygrywa, ale ma limit czasu.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);

      // `ignoreSearch`, bo wejście do pokoju to `/?group=ABC`, a w pamięci leży `/`.
      // Bez tego kopia powłoki była w pamięci, a i tak nie dawało się jej znaleźć.
      const cached = (await cache.match(SHELL))
        || (await cache.match(req, { ignoreSearch: true }))
        || (await cache.match('/index.html'));

      const network = fetch(req).then((fresh) => {
        if (fresh && fresh.ok) cache.put(SHELL, fresh.clone()).catch(() => {});
        return fresh;
      }).catch(() => null);

      // Nie ma czego pokazać: czekamy na sieć tyle, ile trzeba. Dotyczy wyłącznie
      // pierwszego wejścia w życiu, zanim `install` zdąży zapełnić pamięć.
      if (!cached) return (await network) || Response.error();

      // Jest kopia — oddajemy ją OD RAZU. Pobieranie leci dalej w tle i podmienia pamięć,
      // więc następne wejście dostaje świeżą powłokę. `waitUntil` trzyma service workera
      // przy życiu do końca tego pobrania; bez tego przeglądarka może go uśpić zaraz po
      // odpowiedzi i odświeżenie nigdy by się nie dokończyło.
      event.waitUntil(network);
      return cached;
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

  // Statyczne zasoby (JS/CSS/fonty): cache-first + odświeżenie w tle.
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
