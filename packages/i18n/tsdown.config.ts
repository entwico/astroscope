import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/internal.ts',
    'src/extraction/index.ts',
    'src/server/translate.ts',
    'src/server/chunk-middleware-entrypoint.ts',
    'src/server/locale-middleware-entrypoint.ts',
    'src/client/translate.ts',
  ],
  format: ['esm'],
  dts: true,
  fixedExtension: false,
  deps: {
    neverBundle: [
      'astro',
      'virtual:@astroscope/i18n/manifest',
      'virtual:@astroscope/i18n/config',
      '@babel/core',
      '@astroscope/node',
    ],
  },
});
