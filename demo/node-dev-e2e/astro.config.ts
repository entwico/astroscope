import node from '@astroscope/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node(),
});
