// Rasteryzacja znaku Billyady do zestawu ikon PWA.
//
// DLACZEGO PRZEGLĄDARKA, A NIE BIBLIOTEKA GRAFICZNA: repozytorium trzyma zasadę
// „zero zależności od cudzych serwerów" (DESIGN.md §Typography), a dokładanie
// `sharp` albo `canvas` do zależności produkcyjnych tylko po to, żeby raz na rok
// przerysować ikonę, jest kosztem bez pokrycia. Puppeteer już tu jest, bo służy
// audytowi układu, więc rysuje ten sam silnik, który będzie tę ikonę wyświetlał.
//
// Źródłem prawdy jest `public/icons/icon.svg`. Ten skrypt tylko go skaluje.
// Uruchomienie:  node tools/make-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import puppeteer from 'puppeteer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public/icons/icon.svg'), 'utf8');

// Te same rozmiary, co w `public/manifest.json` i w `<link rel="apple-touch-icon">`.
// Nowy rozmiar dopisuje się TUTAJ i tam, inaczej manifest wskaże plik, którego nie ma.
const SIZES = [16, 32, 180, 192, 512];

const browser = await puppeteer.launch({ headless: 'new' });
try {
  const page = await browser.newPage();
  for (const size of SIZES) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    // `image-rendering: auto` i skalowanie w SVG, nie w CSS pikselowym: dzięki temu
    // ukośna szczelina zostaje gładka także przy szesnastu pikselach.
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>html,body{margin:0;padding:0;background:transparent}
       svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
      { waitUntil: 'load' },
    );
    const buffer = await page.screenshot({ omitBackground: true, type: 'png' });
    const out = join(root, `public/icons/icon-${size}x${size}.png`);
    writeFileSync(out, buffer);
    console.log(`zapisano ${out} (${buffer.length} B)`);
  }
} finally {
  await browser.close();
}
