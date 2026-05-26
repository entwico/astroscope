import node from '@astrojs/node';
import react from '@astrojs/react';
import tweaks from '@astroscope/tweaks';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react(), tweaks()],
  vite: {
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
  },
});
