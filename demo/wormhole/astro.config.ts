import react from '@astrojs/react';
import node from '@astroscope/node';
import wormhole from '@astroscope/wormhole';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node(),
  integrations: [react(), wormhole()],
  vite: {
    plugins: [tailwindcss() as any],
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
  },
});
