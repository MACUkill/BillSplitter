// Przebieg audytowy SIECI: sprawdza, jak aplikacja zachowuje się, gdy sieci nie ma
// albo gdy jest, ale nie odpowiada. Tego nie da się zbadać testem jednostkowym, bo cała
// rzecz dzieje się na styku Firestore, pamięci podręcznej i pierwszego malowania.
//
// DLACZEGO ISTNIEJE: zgłoszenie z 2026-08-25 — „w trybie samolotowym apka od razu rozumie,
// że jest offline, ale przy bardzo wolnym internecie albo gdy wifi jest, a nie działa,
// widać ciemny ekran, potem biały, a potem nagle się odpala". Poprawka polegała na wejściu
// do pokoju z pamięci zamiast czekania na serwer — i to jest test, który tego pilnuje.
//
// WYMAGA dwóch rzeczy uruchomionych obok:
//   npm run emulators
//   npx vite --port 5199 --strictPort
// a potem:
//   BILLIADA_URL=http://localhost:5199/ node tools/audit-offline.mjs
//
// KOLEJNOŚĆ MA ZNACZENIE: `npm run test:rules` puszczaj PRZED tym przebiegiem albo po
// restarcie emulatorów. Ten audyt zakłada w emulatorze prawdziwe pokoje i rachunki,
// a testy reguł zakładają czystą bazę — puszczone po nim wywalają kilka sprawdzeń
// z PERMISSION_DENIED i wygląda to jak regresja reguł, którą nikt nie wprowadził.
import puppeteer from 'puppeteer';

const ADRES = process.env.BILLIADA_URL || 'http://localhost:5173/'; // nie `URL` — przykrywałoby konstruktor `new URL(...)`

// Próg startu offline. Dawniej `await getDoc(...)` przed pierwszym malowaniem potrafił
// wisieć kilkanaście sekund; cztery sekundy to granica, powyżej której człowiek uznaje
// aplikację za zawieszoną.
const PROG_STARTU_MS = 4000;

const wyniki = [];
const sprawdz = (nazwa, warunek, szczegol = '') => {
  wyniki.push({ nazwa, warunek });
  console.log(`${warunek ? '  OK  ' : ' BŁĄD '} ${nazwa}${szczegol ? '  — ' + szczegol : ''}`);
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

const bledy = [];
page.on('console', (m) => { if (m.type() === 'error') bledy.push(m.text()); });
page.on('pageerror', (e) => bledy.push('pageerror: ' + e.message));

// `navigator.onLine` trzeba podmienić RĘCZNIE przy każdym wejściu na stronę: emulacja
// sieci w CDP nie rusza tej flagi, a to właśnie ona kłamie na zdychającym wifi.
const wymusOffline = async () => {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(window.navigator, 'onLine', { get: () => false, configurable: true });
  });
};

// ODCINAMY SAM FIRESTORE, NIE CAŁĄ SIEĆ.
//
// Przełącznik „offline" w CDP blokuje wszystko razem z serwerem, z którego idzie sama
// aplikacja — a wtedy nie ma czego testować, bo strona się nie wczytuje. W produkcji tę
// rolę pełni service worker (powłoka z pamięci), ale w trybie deweloperskim go nie ma.
//
// Odcięcie samego backendu przy działającej reszcie jest zresztą WIERNIEJSZE zgłoszeniu:
// to jest dokładnie stan „wifi jest, a nie działa", w którym `navigator.onLine` kłamie,
// a aplikacja czekała w nieskończoność na `getDoc`.
const cdp = await page.target().createCDPSession();
await cdp.send('Network.enable');
const odetnijBackend = (odciac) => cdp.send('Network.setBlockedURLs', {
  urls: odciac ? ['*127.0.0.1:8770*', '*localhost:8770*', '*firestore.googleapis.com*'] : [],
});

console.log('\n— 1. Zwykły start —');
await page.goto(ADRES, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#start-screen:not(.hidden)', { timeout: 20000 });
sprawdz('ekran startowy wstaje przy działającej sieci', true);
sprawdz(
  'pasek łączności ukryty, gdy sieć działa',
  await page.$eval('#offline-banner', (el) => el.classList.contains('hidden')),
);

console.log('\n— 2. Założenie pokoju —');
await page.type('#group-name', 'Test sieci');
for (const imie of ['Ala', 'Bartek']) {
  await page.type('#member-name-input', imie);
  await page.click('#add-member-btn');
}
await page.click('#create-group-btn');
await page.waitForSelector('#join-screen:not(.hidden), #group-dashboard-screen:not(.hidden)', { timeout: 20000 });
if (await page.$('#join-screen:not(.hidden)')) {
  await page.click('#name-selection-list button');
  await page.waitForSelector('#group-dashboard-screen:not(.hidden)', { timeout: 20000 });
}
const groupId = new URL(page.url()).searchParams.get('group');
sprawdz('pokój powstaje i aplikacja do niego wchodzi', Boolean(groupId), 'kod ' + groupId);

// Zajęcie imienia idzie teraz bez czekania na serwer — sprawdzamy, że ekran naprawdę
// przeszedł dalej, a nie utknął na liście imion.
sprawdz(
  'zajęcie imienia kończy się wejściem na pulpit',
  await page.$eval('#group-dashboard-screen', (el) => !el.classList.contains('hidden')),
);

// Pamięć trwała Firestore zapisuje się asynchronicznie. Bez tej chwili odcinamy backend,
// zanim dokument pokoju trafi do IndexedDB — a wtedy testujemy pierwsze wejście w życiu
// bez sieci, a nie powrót do pokoju, w którym się już było. Prawdziwy człowiek zdążył.
await new Promise((r) => setTimeout(r, 2500));

console.log('\n— 3. „Wifi jest, a serwer milczy" (lie-fi) —');
// `navigator.onLine` ZOSTAJE PRAWDĄ. To jest sedno zgłoszenia: flaga twierdzi, że
// wszystko gra, więc dawny pasek offline w ogóle się nie pokazywał, a `await getDoc(...)`
// wisiał, aż SDK sam uznał, że jest offline.
await odetnijBackend(true);
const start = Date.now();
await page.goto(`${ADRES}?group=${groupId}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#group-dashboard-screen:not(.hidden)', { timeout: 25000 });
const czas = Date.now() - start;
sprawdz('pokój wstaje z pamięci podręcznej, mimo milczącego serwera', true, czas + ' ms');
sprawdz(`start poniżej ${PROG_STARTU_MS} ms`, czas < PROG_STARTU_MS, czas + ' ms');
sprawdz(
  'navigator.onLine nadal twierdzi, że sieć jest (czyli kłamie)',
  await page.evaluate(() => navigator.onLine === true),
);

// NAJWAŻNIEJSZE SPRAWDZENIE CAŁEGO PLIKU. `forgetRoom` kasuje pokój z `localStorage`,
// czyli jedyny ślad po nim na urządzeniu — powrót wymaga potem kodu od kogoś innego.
// Wolno go wywołać WYŁĄCZNIE na słowo serwera, nigdy przy pudle z pamięci.
const pokoje = await page.evaluate(() => {
  try { return (JSON.parse(localStorage.getItem('billsplitter_rooms')) || []).length; } catch { return -1; }
});
sprawdz('pokój NIE zniknął z listy „Twoje pokoje" przy braku sieci', pokoje > 0, pokoje + ' na liście');

// TO JEST STAN, W KTÓRYM APLIKACJA MILCZAŁA. Pasek szedł dotąd wyłącznie z
// `navigator.onLine`, więc przy milczącym serwerze nie mówił nic.
const czekajNaPasek = async () => {
  try {
    await page.waitForFunction(
      () => !document.getElementById('offline-banner').classList.contains('hidden'),
      { timeout: 15000 },
    );
  } catch (_) { /* zgłosi to sprawdzenie niżej */ }
  return page.$eval('#offline-banner', (el) => ({
    ukryty: el.classList.contains('hidden'),
    tekst: (el.textContent || '').trim(),
  }));
};
const pasek = await czekajNaPasek();
sprawdz(
  'pasek łączności mówi „sieć nie odpowiada", choć navigator.onLine twierdzi inaczej',
  !pasek.ukryty && /nie odpowiada/.test(pasek.tekst),
  pasek.tekst || '(pusty)',
);

console.log('\n— 4. Praca przy milczącym serwerze —');
await page.evaluate(() => document.getElementById('nav-settle')?.click());
await new Promise((r) => setTimeout(r, 400));
sprawdz(
  'przełączanie zakładek działa',
  await page.$eval('#group-dashboard-screen', (el) => !el.classList.contains('hidden')),
);

console.log('\n— 5. Twardy offline: navigator.onLine = false —');
await wymusOffline();
await page.goto(`${ADRES}?group=${groupId}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#group-dashboard-screen:not(.hidden)', { timeout: 25000 });
const pasekOffline = await page.$eval('#offline-banner', (el) => ({
  ukryty: el.classList.contains('hidden'),
  tekst: (el.textContent || '').trim(),
}));
sprawdz(
  'pasek mówi wprost o braku sieci',
  !pasekOffline.ukryty && /Brak sieci/.test(pasekOffline.tekst),
  pasekOffline.tekst || '(pusty)',
);

console.log('\n— 6. Powrót serwera —');
await odetnijBackend(false);
await page.evaluate(() => {
  Object.defineProperty(window.navigator, 'onLine', { get: () => true, configurable: true });
  window.dispatchEvent(new Event('online'));
});
let wrocil = false;
try {
  await page.waitForFunction(
    () => document.getElementById('offline-banner').classList.contains('hidden'),
    { timeout: 20000 },
  );
  wrocil = true;
} catch (_) { /* zgłosi sprawdzenie */ }
sprawdz('pasek łączności gaśnie po powrocie serwera', wrocil);

await browser.close();

const istotne = bledy.filter((t) => !/favicon|manifest|sw\.js|Failed to load resource|net::ERR_INTERNET_DISCONNECTED|@firebase\/firestore/i.test(t));
sprawdz('brak nieoczekiwanych błędów w konsoli', istotne.length === 0, istotne.slice(0, 2).join(' | '));

const zle = wyniki.filter((w) => !w.warunek).length;
console.log(`\n${wyniki.length - zle}/${wyniki.length} sprawdzeń przeszło.`);
process.exit(zle ? 1 : 0);
