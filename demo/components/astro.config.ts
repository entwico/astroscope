import node from '@astroscope/node';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node(),
  vite: {
    plugins: [tailwindcss() as any],
  },
});
