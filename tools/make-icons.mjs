// Skalowanie znaku Billiady do zestawu ikon PWA i do użycia w samej aplikacji.
//
// ŹRÓDŁEM PRAWDY jest `logo/billiada-logo.png` — rysunek właściciela: koń trojański
// w limonce na atramencie. Ten skrypt tylko go pomniejsza; niczego nie dorysowuje
// i nie przekolorowuje.
//
// Źródło leży POZA katalogiem `public/` świadomie: wszystko, co tam wpadnie, trafia
// do wydania jeden do jednego, a 260-kilobajtowy oryginał nie ma po co jechać do
// przeglądarki, skoro i tak wysyłamy z niego gotowe rozmiary.
//
// DLACZEGO PRZEGLĄDARKA, A NIE BIBLIOTEKA GRAFICZNA: repozytorium trzyma zasadę
// „zero zależności od cudzych serwerów", a dokładanie `sharp` albo `canvas` do
// zależności tylko po to, żeby raz na jakiś czas przeskalować obrazek, jest kosztem
// bez pokrycia. Puppeteer już tu jest, bo służy audytowi układu, więc skaluje ten sam
// silnik, który będzie tę ikonę wyświetlał.
//
// Uruchomienie:  node tools/make-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import puppeteer from 'puppeteer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'logo/billiada-logo.png')).toString('base64');

// Rozmiary muszą się zgadzać z `public/manifest.json`, z `<link rel="apple-touch-icon">`
// i z miejscami, w których aplikacja pokazuje znak. Nowy rozmiar dopisuje się TUTAJ
// i tam, inaczej manifest wskaże plik, którego nie ma.
//   16, 32   — karta przeglądarki
//   96       — znak w samej aplikacji (ekran startowy, wczytywanie)
//   180      — apple-touch-icon
//   192, 512 — manifest PWA
const SIZES = [16, 32, 96, 180, 192, 512];

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  for (const size of SIZES) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    // `image-rendering` domyślne (dwuliniowe): przy pomniejszaniu z 600 px to jest
    // dokładnie to, czego chcemy. Wymuszanie `pixelated` dałoby postrzępione krawędzie.
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>html,body{margin:0;padding:0;background:transparent}
       img{display:block;width:${size}px;height:${size}px}</style>
       <img src="data:image/png;base64,${source}" alt="">`,
      { waitUntil: 'load' },
    );
    // Czekamy na faktyczne zdekodowanie obrazu: bez tego najmniejsze rozmiary
    // potrafią wyjść puste, bo zrzut leci przed pierwszym malowaniem.
    await page.evaluate(() => document.querySelector('img').decode());
    const buffer = await page.screenshot({ omitBackground: true, type: 'png' });
    const out = join(root, `public/icons/icon-${size}x${size}.png`);
    writeFileSync(out, buffer);
    console.log(`zapisano ${out} (${buffer.length} B)`);
  }
} finally {
  await browser.close();
}
