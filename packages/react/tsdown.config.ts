import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts', server: 'src/server.ts' },
  format: ['esm'],
  dts: true,
  fixedExtension: false,
  deps: {
    neverBundle: ['astro', 'astro:react:opts', '@astrojs/react', '@astroscope/node'],
  },
});
