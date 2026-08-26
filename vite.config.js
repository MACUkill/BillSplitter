import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// PIECZĘĆ WYDANIA W SERVICE WORKERZE — bez niej cała ścieżka aktualizacji jest martwa.
//
// Przeglądarka rozpoznaje nowego service workera WYŁĄCZNIE po zmianie BAJTÓW `sw.js`.
// Vite kopiuje ten plik z `public/` bez zmian, więc wdrożenie nowego kodu aplikacji —
// przy nietkniętym `sw.js` — nie wywołuje żadnego `updatefound`. Pasek „Nowa wersja
// gotowa" nigdy by się nie pokazał, a ludzie siedzieliby na starym wydaniu do czasu,
// aż sami wyczyszczą dane. Znalezione przy pisaniu testu tej ścieżki, nie po zgłoszeniu.
//
// Pieczęć liczymy ze ZBUDOWANEGO `index.html`, bo on niesie nazwy zasobów ze skrótami
// zawartości. Zmienia się więc dokładnie wtedy, gdy zmienia się cokolwiek w aplikacji —
// i ani razu więcej, żeby nie kasować ludziom pamięci bez powodu.
const stemplujServiceWorker = () => ({
  name: 'billiada-sw-stamp',
  apply: 'build',
  closeBundle() {
    const dist = join(process.cwd(), 'dist');
    const sw = join(dist, 'sw.js');
    const html = join(dist, 'index.html');
    if (!existsSync(sw) || !existsSync(html)) return;
    const pieczec = createHash('sha256').update(readFileSync(html)).digest('hex').slice(0, 12);
    const tresc = readFileSync(sw, 'utf8').replace(/\n\/\/ wydanie: [0-9a-f]+\n?$/, '');
    writeFileSync(sw, `${tresc}\n// wydanie: ${pieczec}\n`);
    console.log(`  service worker opieczętowany wydaniem ${pieczec}`);
  },
});

export default defineConfig({
  plugins: [stemplujServiceWorker()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    // Dolna granica wsparcia wypowiedziana WPROST, zamiast polegania na domyślnym
    // celu narzędzia. Safari 15.4 jest tu progiem naturalnym: od niego działa selektor
    // `:has()`, na którym stoi chowanie paska przy otwartym arkuszu i odsunięcie treści
    // spod paska offline. Starszy iPhone i tak nie dostałby poprawnego układu, więc
    // udawanie, że go obsługujemy, byłoby gorsze niż jasna granica.
    target: ['safari15.4', 'chrome107', 'firefox115'],
  },
  test: {
    // Testy matmy są czyste (bez DOM) — środowisko node wystarcza i jest szybkie.
    environment: 'node',
    // test/ (np. testy reguł na emulatorze) uruchamiamy osobno przez `npm run test:rules`.
    include: ['src/**/*.test.js'],
  },
});
