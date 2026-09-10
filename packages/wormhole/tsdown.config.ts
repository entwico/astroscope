import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'index.browser': 'src/index.browser.ts',
    server: 'src/server.ts',
    'middleware-entrypoint': 'src/middleware-entrypoint.ts',
    'react/index': 'src/react/index.ts',
  },
  format: ['esm'],
  dts: true,
  fixedExtension: false,
  deps: {
    neverBundle: [
      'astro',
      'virtual:@astroscope/wormhole/manifest',
      'virtual:@astroscope/wormhole/registry',
      'virtual:@astroscope/wormhole/config',
      '@astroscope/node',
    ],
  },
});
