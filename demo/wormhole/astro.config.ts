import node from '@astroscope/node';
import { RECOMMENDED_EXCLUDES } from '@astroscope/node/excludes';
import react from '@astroscope/react';
import wormhole from '@astroscope/wormhole';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node(),
  // the /api/ probe of the tests must not load anything itself
  integrations: [react(), wormhole({ exclude: [...RECOMMENDED_EXCLUDES, { prefix: '/api/' }] })],
  vite: {
    plugins: [tailwindcss() as any],
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
  },
});
