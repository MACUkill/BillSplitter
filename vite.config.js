import { defineConfig } from 'vitest/config';

export default defineConfig({
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
