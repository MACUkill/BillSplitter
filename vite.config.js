import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
  test: {
    // Testy matmy są czyste (bez DOM) — środowisko node wystarcza i jest szybkie.
    environment: 'node',
    include: ['src/**/*.test.js', 'test/**/*.test.js'],
  },
});
