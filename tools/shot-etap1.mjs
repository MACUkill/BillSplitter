// Zrzuty stanów zmienionych w etapie 1 — do obejrzenia gołym okiem.
// Wymaga uruchomionych emulatorów i serwera deweloperskiego:
//   BILLIADA_URL=http://localhost:5199/ node tools/shot-etap1.mjs ./shots-etap1
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer';

const ADRES = process.env.BILLIADA_URL || 'http://localhost:5173/';
const OUT = process.argv[2] || './shots-etap1';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

const czekaj = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (nazwa) => {
  await page.screenshot({ path: `${OUT}/${nazwa}.png` });
  console.log('  zapisano', nazwa);
};
const wpisz = async (sel, tekst) => { await page.waitForSelector(sel, { visible: true, timeout: 8000 }); await page.type(sel, tekst); };
const klik = async (sel) => { await page.waitForSelector(sel, { visible: true, timeout: 8000 }); await page.click(sel); };

// --- pokój i rachunek odtwarzający zgłoszenie: 183 EUR, pozycje na 210,50 ---
await page.goto(ADRES, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#start-screen:not(.hidden)', { timeout: 20000 });
await wpisz('#group-name', 'Wakacje');
for (const imie of ['Michał', 'Kuba', 'Ola']) {
  await wpisz('#member-name-input', imie);
  await klik('#add-member-btn');
}
await klik('#create-group-btn');
await page.waitForSelector('#join-screen:not(.hidden), #group-dashboard-screen:not(.hidden)', { timeout: 20000 });
if (await page.$('#join-screen:not(.hidden)')) {
  await klik('#name-selection-list button');
  await page.waitForSelector('#group-dashboard-screen:not(.hidden)', { timeout: 20000 });
}
const groupId = new URL(page.url()).searchParams.get('group');
await czekaj(1200);

await klik('#create-new-bill-btn');
await czekaj(600);
await wpisz('#new-bill-name', 'Kolacja nad morzem');
await klik('#confirm-create-bill-btn');
await page.waitForSelector('#bill-screen:not(.hidden)', { timeout: 20000 });
await czekaj(800);

// Płatnik
await klik('#payer-select');
await czekaj(500);
await page.evaluate(() => { const b = document.querySelector('#choice-options .choice-option:nth-child(2)'); if (b) b.click(); });
await czekaj(500);
await klik('#confirm-ok-btn');
await czekaj(900);

// Kwota rachunku 183 — tyle było na paragonie
await page.evaluate(() => {
  const el = document.getElementById('total-bill-amount');
  el.value = '183';
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await czekaj(900);

await klik('#bill-mode-own');
await czekaj(900);

// Pozycje z DUPLIKATEM — dokładnie jak w zgłoszeniu
for (const [opis, kwota] of [
  ['Ryba z grilla', '155,50'],
  ['Opłata za nakrycie', '27,50'],
  ['Opłata za nakrycie', '27,50'],
]) {
  await klik('#add-shared-cost-btn');
  await czekaj(400);
  await wpisz('#shared-cost-desc', opis);
  await wpisz('#shared-cost-amount', kwota);
  await klik('#save-shared-cost');
  await czekaj(600);
}
await czekaj(800);

// Zrzut sumy kontrolnej z rozpisanym działaniem
await page.evaluate(() => document.getElementById('control-sum')?.scrollIntoView({ block: 'center' }));
await czekaj(600);
console.log('\n— suma kontrolna —');
await shot('01-suma-kontrolna-rozpisana');

const tekst = await page.evaluate(() => ({
  status: document.getElementById('control-status')?.textContent?.trim(),
  rozpiska: document.getElementById('control-breakdown-rows')?.textContent?.replace(/\s+/g, ' ').trim(),
  przycisk: document.getElementById('control-fix-total')?.textContent?.trim(),
  widoczna: !document.getElementById('control-breakdown')?.classList.contains('hidden'),
}));
console.log(JSON.stringify(tekst, null, 2));

// Udział „wstępnie"
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.chip')].find((c) => c.textContent.trim() === 'wstępnie');
  if (el) el.scrollIntoView({ block: 'center' });
});
await czekaj(500);
console.log('\n— udział wstępny —');
await shot('02-udzial-wstepnie');

// --- pasek łączności przy milczącym serwerze ---
const cdp = await page.target().createCDPSession();
await cdp.send('Network.enable');
await czekaj(2000);
// WZORZEC MUSI BYĆ WĄSKI. `*8770*` wygląda niewinnie, a potrafi trafić też w adresy
// modułów serwera deweloperskiego — vite dokleja do nich skrót zawartości, więc ciąg
// „8770" umie się w nim pojawić przypadkiem. Zablokowany moduł znaczy, że aplikacja
// w ogóle się nie wczytuje, a wygląda to jak zacięcie na ekranie wczytywania —
// pół godziny szukania usterki, której nie było.
await cdp.send('Network.setBlockedURLs', { urls: ['*127.0.0.1:8770*', '*firestore.googleapis.com*'] });
await page.goto(`${ADRES}?group=${groupId}`, { waitUntil: 'domcontentloaded' });
// Czekamy na JAKIKOLWIEK ekran docelowy i mówimy, który to jest — zamiast wywracać
// narzędzie na twardym selektorze. Zrzut ma powstać nawet wtedy, gdy aplikacja
// wyląduje gdzie indziej, niż zakładaliśmy; wtedy właśnie jest najbardziej potrzebny.
await page.waitForFunction(
  () => ['group-dashboard', 'join', 'start', 'bill']
    .some((n) => !document.getElementById(n + '-screen')?.classList.contains('hidden')),
  { timeout: 25000 },
).catch(() => {});
await page.waitForFunction(
  () => !document.getElementById('offline-banner').classList.contains('hidden'),
  { timeout: 15000 },
).catch(() => {});
await czekaj(600);
console.log('\n— pasek łączności (lie-fi) —');
const gdzie = await page.evaluate(() => ({
  ekran: ['loading', 'start', 'join', 'group-dashboard', 'bill', 'profile']
    .find((n) => !document.getElementById(n + '-screen')?.classList.contains('hidden')) || '(żaden)',
  pasek: document.getElementById('offline-banner')?.classList.contains('hidden')
    ? '(ukryty)' : document.getElementById('offline-banner').textContent.trim(),
}));
console.log(JSON.stringify(gdzie, null, 2));
await shot('03-pasek-lacznosci-lie-fi');

await browser.close();
console.log(`\nZrzuty w ${OUT}`);
