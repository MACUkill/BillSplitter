// Znak Billiady WEWNĄTRZ aplikacji.
//
// UWAGA, CO SIĘ ZMIENIŁO 2026-08-15 (wieczór): ikony PWA (`public/icons/icon-*.png`)
// przychodzą teraz **gotowe od właściciela** i tego skryptu nie dotyczą. Nie generuj
// ich ponownie i nie nadpisuj — to jego pliki, przeskalowane po jego stronie.
//
// Ten skrypt robi jedną rzecz: przycina i skaluje PRZEZROCZYSTĄ wersję znaku do
// rozmiaru używanego w interfejsie (logotyp na ekranie startowym i przy wczytywaniu).
//
// Dlaczego przezroczysta, a nie ikona z tłem: logotyp siedzi w ciemnej pigułce.
// Znak z własnym tłem dawał w niej widoczny kwadrat, bo jego tło i tło pigułki to
// nigdy nie jest dokładnie ten sam piksel. Przezroczysty znak wtapia się w pigułkę
// bez śladu i działa też na dowolnym innym podłożu.
//
// Dlaczego przeglądarka, a nie biblioteka graficzna: repozytorium trzyma zasadę
// „zero zależności od cudzych serwerów", a `sharp` tylko po to, żeby raz na jakiś
// czas przeskalować obrazek, jest kosztem bez pokrycia. Puppeteer już tu jest,
// bo służy audytowi układu.
//
// Uruchomienie:  node tools/make-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import puppeteer from 'puppeteer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'logo/billiada-logo-transparent.png')).toString('base64');

// Znak wyświetla się przy 36 px (ekran startowy) i 52 px (wczytywanie). 160 px pokrywa
// oba z zapasem na ekrany o potrójnej gęstości i nadal waży kilkanaście kilobajtów.
const SIZE = 160;
const OUT = join(root, 'public/icons/mark-160.png');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: SIZE, height: SIZE, deviceScaleFactor: 1 });
  // `object-fit: contain` na kwadracie: źródło nie jest kwadratowe (koń jest szerszy
  // niż wyższy), więc bez tego znak zostałby rozciągnięty.
  await page.setContent(
    `<!doctype html><meta charset="utf-8">
     <style>html,body{margin:0;padding:0;background:transparent}
     img{display:block;width:${SIZE}px;height:${SIZE}px;object-fit:contain}</style>
     <img src="data:image/png;base64,${source}" alt="">`,
    { waitUntil: 'load' },
  );
  await page.evaluate(() => document.querySelector('img').decode());
  const buffer = await page.screenshot({ omitBackground: true, type: 'png' });
  writeFileSync(OUT, buffer);
  console.log(`zapisano ${OUT} (${buffer.length} B)`);
} finally {
  await browser.close();
}
