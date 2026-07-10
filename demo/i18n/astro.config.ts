import react from '@astrojs/react';
import i18n from '@astroscope/i18n';
import node from '@astroscope/node';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node(),
  integrations: [react(), i18n()],
  vite: {
    plugins: [tailwindcss() as any],
  },
});
