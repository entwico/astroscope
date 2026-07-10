import react from '@astrojs/react';
import node from '@astroscope/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node({
    csrf: { exclude: [{ exact: '/excluded' }] },
    shutdownTimeout: 2000,
  }),
  integrations: [react()],
  vite: {
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
  },
});
