import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'index.browser': 'src/index.browser.ts',
    'server/index': 'src/server/index.ts',
    'client/index': 'src/client/index.ts',
    'client/track': 'src/client/track.ts',
    'server/track': 'src/server/track.ts',
    'server/middleware-entrypoint': 'src/server/middleware-entrypoint.ts',
    'server/registry': 'src/server/registry.ts',
    'react/index': 'src/react/index.tsx',
    'ga4/index': 'src/ga4/index.ts',
    'gtm/index': 'src/gtm/index.ts',
    'matomo/index': 'src/matomo/index.ts',
    'ccm19/index': 'src/ccm19/index.ts',
    'awin/index': 'src/awin/index.ts',
    'openai/index': 'src/openai/index.ts',
    'openai/server': 'src/openai/server.ts',
    'meta/index': 'src/meta/index.ts',
    'meta/server': 'src/meta/server.ts',
  },
  format: ['esm'],
  dts: true,
  fixedExtension: false,
  deps: {
    neverBundle: ['astro', /^astro[:/]/, '@astroscope/relay/registry', /^@astroscope\/node/, /^@entwico\/dash/, 'react'],
  },
});
