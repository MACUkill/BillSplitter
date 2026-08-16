import { defineConfig } from 'vitest/config';

// Osobny config dla testów reguł Firestore — wymagają działającego emulatora.
// Uruchom: `npm run test:rules` (przy `npm run emulators`).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    testTimeout: 15000,
    hookTimeout: 20000,
    // PLIKI IDĄ PO KOLEI, NIE RÓWNOLEGLE (audyt 2026-08-16).
    // Każdy plik woła `initializeTestEnvironment`, a to WGRYWA REGUŁY do emulatora.
    // `firebase.json` ma `singleProjectMode: true`, więc osobne identyfikatory projektów
    // („billsplitter-rules-test", „billsplitter-attack-test") lądują w jednej przestrzeni
    // — dwa pliki naraz ścigały się o to, czyje reguły są aktualnie wgrane. Objawiało się
    // to wynikiem zależnym od przebiegu: raz 31/32, raz 28/33, przy nietkniętych regułach
    // i nietkniętych testach. Godzina zmarnowana na szukanie usterki, której nie było.
    fileParallelism: false,
  },
});
