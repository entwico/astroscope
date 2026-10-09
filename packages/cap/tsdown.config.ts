import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    server: 'src/server.ts',
    'middleware-entrypoint': 'src/middleware-entrypoint.ts',
    'client/index': 'src/client/index.ts',
    'react/index': 'src/react/index.tsx',
  },
  format: ['esm'],
  dts: true,
  fixedExtension: false,
  deps: {
    neverBundle: [
      'astro',
      /^astro[:/]/,
      'virtual:@astroscope/cap/config',
      /^@astroscope\/node/,
      'cap-widget',
      /^pako\//,
      /^@cap\.js\/wasm/,
    ],
  },
});
