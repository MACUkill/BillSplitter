// KLAWIATURA NA iOS KONTRA OKNA MODALNE — próba, której nie da się zrobić w headless
// inaczej niż przez podstawienie okna widoku.
//
// Usterka (zgłoszenie właściciela, iPhone 12, 2026-08-20): arkusz wyboru płatnika chował
// się POD klawiaturą przy pierwszym stuknięciu w pole. Przyczyna nie jest widoczna w kodzie:
// arkusze stoją w oknie `position: fixed; inset: 0`, a iOS przy otwarciu klawiatury NIE
// zmniejsza układowego okna widoku — zmniejsza wyłącznie widoczne. Objaw był mylący, bo za
// drugim razem Safari sam doprzewijał i wyglądało to poprawnie.
//
// Ta usterka wraca po każdej zmianie geometrii arkuszy i nigdy nie widać jej na komputerze,
// więc opłaca się mieć na nią stały pomiar. Sprawdzamy obie połowy naprawy osobno:
//   1. CSS — czy `--kb-inset` naprawdę skraca okno modalne (ryzykiem jest tu kolejność
//      reguł: `inset-0` z Tailwinda ustawia `bottom: 0`);
//   2. JS  — czy `watchKeyboardForDeck` liczy tę wartość z właściwych liczb.
//
// Uruchomienie (potrzebny podany build albo serwer deweloperski):
//   npx vite preview --port 5199
//   BILLIADA_URL=http://localhost:5199/ node tools/audit-keyboard.mjs
import { readFileSync } from 'node:fs';

import puppeteer from 'puppeteer';

// ADRES, nie URL: własna stała o tej nazwie przesłania wbudowany konstruktor, którego
// używamy niżej do wczytania źródła. Ta sama pomyłka zdarzyła się już raz w tym audycie.
const ADRES = process.env.BILLIADA_URL || 'http://localhost:5173/';
const SZEROKOSC = 390;
const WYSOKOSC = 844;          // iPhone 12 w punktach CSS
const KLAWIATURA = 336;        // klawiatura z paskiem podpowiedzi
const PASEK_ADRESU = 90;       // tyle zabiera pasek przeglądarki — to NIE jest klawiatura

const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const od = (znacznik) => {
  const i = src.indexOf(znacznik);
  if (i < 0) throw new Error('nie znaleziono w src/main.js: ' + znacznik);
  return i;
};
// Bierzemy PRAWDZIWE ciało funkcji ze źródła, nie kopię — kopia rozjechałaby się przy
// pierwszej poprawce i test zacząłby potwierdzać kod, którego już nie ma.
const start = od('const watchKeyboardForDeck = () => {');
const kodNasluchu = src.slice(od('const KEYBOARD_MIN_PX'), src.indexOf('\n        };', start) + '\n        };'.length);

const browser = await puppeteer.launch({ headless: 'new' });
const raport = [];

try {
  // --- 1. GEOMETRIA -------------------------------------------------------------
  {
    const page = await browser.newPage();
    await page.setViewport({ width: SZEROKOSC, height: WYSOKOSC, isMobile: true, hasTouch: true });
    await page.goto(ADRES, { waitUntil: 'load' });
    const wynik = await page.evaluate((WYS, KB) => {
      const out = [];
      const modal = document.getElementById('choice-modal');
      const sheet = modal.querySelector('.sheet');
      // Arkusz musi CHCIEĆ być wysoki, inaczej próba niczego nie dowiedzie.
      document.getElementById('choice-options').innerHTML = Array.from({ length: 20 }, (_, i) =>
        `<button class="choice-option card tap w-full min-h-tap p-3 flex items-center gap-3 text-left"><span class="font-semibold">Osoba ${i}</span></button>`).join('');
      modal.classList.add('active');
      const zmierz = () => ({ modal: modal.getBoundingClientRect(), sheet: sheet.getBoundingClientRect() });
      const ustaw = (px) => document.documentElement.style.setProperty('--kb-inset', px + 'px');

      const bez = zmierz();
      out.push(['bez klawiatury okno sięga dołu ekranu', Math.round(bez.modal.bottom) === WYS]);
      out.push(['bez klawiatury arkusz siedzi na dole', Math.round(bez.sheet.bottom) === WYS]);

      ustaw(KB);
      const z = zmierz();
      out.push(['z klawiaturą okno kończy się nad nią', Math.round(z.modal.bottom) === WYS - KB]);
      out.push(['z klawiaturą arkusz kończy się nad nią', Math.round(z.sheet.bottom) === WYS - KB]);
      out.push(['arkusz nie wystaje ponad górę ekranu', z.sheet.top >= -1]);
      out.push(['arkusz zachowuje sensowną wysokość', z.sheet.height > 120]);

      const box = document.getElementById('choice-search');
      box.classList.remove('hidden');
      box.classList.add('is-open');
      const pole = box.querySelector('.person-search-input').getBoundingClientRect();
      out.push(['pole wpisywania jest nad klawiaturą', pole.bottom <= WYS - KB + 1 && pole.top >= 0]);

      ustaw(0);
      const powrot = zmierz();
      out.push(['po schowaniu klawiatury okno wraca do dołu', Math.round(powrot.modal.bottom) === WYS]);
      out.push(['po schowaniu klawiatury arkusz wraca do dołu', Math.round(powrot.sheet.bottom) === WYS]);
      return out;
    }, WYSOKOSC, KLAWIATURA);
    raport.push(...wynik);
    await page.close();
  }

  // --- 2. LICZENIE --------------------------------------------------------------
  {
    const page = await browser.newPage();
    await page.setViewport({ width: SZEROKOSC, height: WYSOKOSC, isMobile: true, hasTouch: true });
    await page.goto(ADRES, { waitUntil: 'load' });
    const wynik = await page.evaluate((kod, UKLAD, KB, PASEK) => {
      const out = [];
      let sluchacz = null;
      // Podstawiamy okno widoku, bo headless nie ma klawiatury. Wysokość UKŁADOWA zostaje
      // stała — na tym polega cała pułapka iOS.
      const vv = { height: UKLAD, offsetTop: 0, addEventListener: (n, f) => { if (n === 'resize') sluchacz = f; } };
      Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
      Object.defineProperty(document.documentElement, 'clientHeight', { get: () => UKLAD, configurable: true });

      new Function(kod + '\nreturn watchKeyboardForDeck;')()();

      const inset = () => document.documentElement.style.getPropertyValue('--kb-inset');
      const ustaw = async (height, offsetTop = 0) => {
        vv.height = height; vv.offsetTop = offsetTop;
        sluchacz();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      };
      const deck = document.getElementById('deck-nav');

      return (async () => {
        out.push(['bez klawiatury zero', inset() === '0px']);
        await ustaw(UKLAD - PASEK);
        out.push([`pasek adresu ${PASEK} px nie liczy się jako klawiatura`, inset() === '0px']);
        await ustaw(UKLAD - KB);
        out.push([`klawiatura ${KB} px daje ${KB}px`, inset() === `${KB}px`]);
        // Safari czasem PRZESUWA widoczne okno zamiast je skrócić; sama różnica wysokości
        // kłamałaby wtedy o tyle pikseli, o ile przesunął.
        await ustaw(UKLAD - KB, 40);
        out.push(['przesunięte okno widoku liczone z offsetTop', inset() === `${KB - 40}px`]);
        await ustaw(UKLAD);
        out.push(['po schowaniu klawiatury wraca zero', inset() === '0px']);
        // Ten sam nasłuch obsługuje pasek nawigacji — musi dalej działać.
        await ustaw(UKLAD - KB);
        out.push(['pasek nawigacji chowa się przy klawiaturze', !deck || deck.classList.contains('deck-keyboard')]);
        await ustaw(UKLAD);
        out.push(['pasek nawigacji wraca po schowaniu', !deck || !deck.classList.contains('deck-keyboard')]);
        return out;
      })();
    }, kodNasluchu, WYSOKOSC, KLAWIATURA, PASEK_ADRESU);
    raport.push(...wynik);
    await page.close();
  }
} finally {
  await browser.close();
}

let zle = 0;
for (const [nazwa, ok] of raport) {
  console.log((ok ? 'OK   ' : 'BŁĄD ') + nazwa);
  if (!ok) zle++;
}
console.log(`\n${raport.length - zle}/${raport.length} sprawdzeń przeszło.`);
process.exit(zle === 0 ? 0 : 1);
