import astrojsReact from '@astrojs/react';
import node from '@astroscope/node';
import react from '@astroscope/react';
import { defineConfig } from 'astro/config';

// the benchmark harness builds variants of this fixture: the upstream react
// integration, the platform (request logging + telemetry) switched off, and a
// separate out dir per variant. the e2e tests build it with none of these set.
const benchReact = process.env['BENCH_REACT'] === 'upstream' ? astrojsReact() : react();
const platformOff = process.env['BENCH_PLATFORM'] === 'off';
const outDir = process.env['BENCH_OUT_DIR'];

export default defineConfig({
  output: 'server',
  ...(outDir && { outDir }),
  adapter: node({
    csrf: { exclude: [{ exact: '/excluded' }] },
    shutdownTimeout: 2000,
    ...(platformOff && { logging: false, telemetry: false }),
  }),
  integrations: [benchReact],
  vite: {
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
  },
});
