import { defineConfig } from 'vitest/config';

// Osobny config dla testów reguł Firestore — wymagają działającego emulatora.
// Uruchom: `npm run test:rules` (przy `npm run emulators`).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    testTimeout: 15000,
    hookTimeout: 20000,
  },
});
