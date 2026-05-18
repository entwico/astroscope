import node from '@astrojs/node';
import boot from '@astroscope/boot';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [boot()],
});
