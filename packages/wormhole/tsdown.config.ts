import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/index.browser.ts', 'src/server.ts', 'src/react/index.ts'],
  format: ['esm'],
  dts: true,
  fixedExtension: false,
  deps: {
    neverBundle: [
      'astro',
      'virtual:@astroscope/wormhole/manifest',
      'virtual:@astroscope/wormhole/registry',
      '@astroscope/node',
    ],
  },
});
