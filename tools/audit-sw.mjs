// Przebieg audytowy SERVICE WORKERA: powłoka z pamięci i ścieżka aktualizacji.
//
// DLACZEGO OSOBNY PLIK: service worker rejestruje się WYŁĄCZNIE w buildzie produkcyjnym
// (`import.meta.env.PROD`), więc `tools/audit-offline.mjs` — który chodzi po serwerze
// deweloperskim — nie dotyka go w ogóle. To jest jedyna zmiana w całym etapie, którą da
// się zepsuć wszystkim naraz i nieodwracalnie z poziomu telefonu, więc ma własny test.
//
// URUCHOMIENIE (build MUSI iść na emulatory, żeby test nie dotknął żywych danych):
//   npm run emulators
//   VITE_USE_EMULATOR=true npx vite build
//   npx vite preview --port 5197 --strictPort
//   BILLIADA_URL=http://localhost:5197/ node tools/audit-sw.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const ADRES = process.env.BILLIADA_URL || 'http://localhost:5197/';
const SW = join(process.cwd(), 'dist', 'sw.js');

// Powłoka z pamięci ma być natychmiastowa. Dawny limit czasu wynosił 3000 ms i to
// właśnie te trzy sekundy widział człowiek jako ciemny ekran.
const PROG_POWLOKI_MS = 1500;

const wyniki = [];
const sprawdz = (nazwa, warunek, szczegol = '') => {
  wyniki.push({ nazwa, warunek });
  console.log(`${warunek ? '  OK  ' : ' BŁĄD '} ${nazwa}${szczegol ? '  — ' + szczegol : ''}`);
};

// Udaje WDROŻENIE: podmienia pieczęć wydania w `dist/sw.js`. Przeglądarka rozpoznaje
// nowego workera wyłącznie po zmianie bajtów tego pliku, więc dokładnie to robi prawdziwe
// wydanie — pieczęć nadaje wtyczka `billiada-sw-stamp` z `vite.config.js`.
const podmienPieczec = (nowa) => {
  const tresc = readFileSync(SW, 'utf8').replace(/\n\/\/ wydanie: [0-9a-f]+\n?$/, '');
  writeFileSync(SW, `${tresc}\n// wydanie: ${nowa}\n`);
};
const obecnaPieczec = () => (readFileSync(SW, 'utf8').match(/\/\/ wydanie: ([0-9a-f]+)/) || [])[1];

const pieczecStartowa = obecnaPieczec();
sprawdz('build opieczętował service workera', Boolean(pieczecStartowa), pieczecStartowa || '(brak)');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
const bledy = [];
page.on('pageerror', (e) => bledy.push(e.message));

console.log('\n— 1. Pierwsze wejście: service worker się instaluje —');
await page.goto(ADRES, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), { timeout: 30000 })
  .catch(() => {});
sprawdz(
  'service worker przejął sterowanie',
  await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
);
sprawdz(
  'pasek nowej wersji NIE pokazuje się przy pierwszej instalacji',
  await page.$eval('#update-banner', (el) => el.classList.contains('hidden')),
);

console.log('\n— 2. Powłoka z pamięci, przy odciętym serwerze —');
const cdp = await page.target().createCDPSession();
await cdp.send('Network.enable');
// Odcinamy serwer, z którego idzie aplikacja. Bez service workera strona by się nie
// wczytała w ogóle — to jest cały sens precache'u powłoki.
await cdp.send('Network.setBlockedURLs', { urls: [`${new URL(ADRES).host}/*`, '*:5197/*'] });
const start = Date.now();
await page.goto(ADRES, { waitUntil: 'domcontentloaded' });
const czas = Date.now() - start;
const jestPowloka = await page.evaluate(() => Boolean(document.getElementById('loading-screen')));
sprawdz('powłoka wstaje z pamięci mimo odciętego serwera', jestPowloka, czas + ' ms');
sprawdz(`poniżej ${PROG_POWLOKI_MS} ms (dawny limit to 3000 ms czekania)`, czas < PROG_POWLOKI_MS, czas + ' ms');
await cdp.send('Network.setBlockedURLs', { urls: [] });

console.log('\n— 3. Nowe wydanie zgłasza się paskiem —');
podmienPieczec('deadbeef1234');
await page.goto(ADRES, { waitUntil: 'load' });
let pasek = false;
try {
  await page.waitForFunction(
    () => !document.getElementById('update-banner').classList.contains('hidden'),
    { timeout: 30000 },
  );
  pasek = true;
} catch (_) { /* zgłosi sprawdzenie */ }
sprawdz('pasek „Nowa wersja gotowa" pokazuje się po wdrożeniu', pasek);

// Podanie katalogu jako argumentu zapisuje zrzut tego stanu — jedyny sposób, żeby
// zobaczyć pasek, bo pokazuje się wyłącznie po prawdziwym wdrożeniu.
if (pasek && process.argv[2]) {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(process.argv[2], { recursive: true });
  await page.screenshot({ path: `${process.argv[2]}/05-pasek-nowej-wersji.png` });
  console.log('  zrzut zapisany: 05-pasek-nowej-wersji.png');
}

console.log('\n— 4. Stuknięcie w „Odśwież" przejmuje stery —');
let przeladowane = false;
if (pasek) {
  const nawigacja = page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => null);
  await page.click('#update-reload-btn');
  przeladowane = Boolean(await nawigacja);
}
sprawdz('strona przeładowała się po stuknięciu', przeladowane);
if (przeladowane) {
  sprawdz(
    'pasek znika po przejściu na nowe wydanie',
    await page.$eval('#update-banner', (el) => el.classList.contains('hidden')),
  );
}

await browser.close();
podmienPieczec(pieczecStartowa); // sprzątamy po sobie — `dist` wraca do stanu z buildu

const istotne = bledy.filter((t) => !/favicon|manifest/i.test(t));
sprawdz('brak nieoczekiwanych błędów strony', istotne.length === 0, istotne.slice(0, 2).join(' | '));

const zle = wyniki.filter((w) => !w.warunek).length;
console.log(`\n${wyniki.length - zle}/${wyniki.length} sprawdzeń przeszło.`);
process.exit(zle ? 1 : 0);
