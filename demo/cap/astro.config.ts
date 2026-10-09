import cap from '@astroscope/cap';
import node from '@astroscope/node';
import react from '@astroscope/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node(),
  integrations: [react(), cap()],
  vite: {
    plugins: [tailwindcss() as any],
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
  },
});
