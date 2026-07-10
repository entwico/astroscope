import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'server': 'src/server/server.ts',
    'preview': 'src/server/preview.ts',
    'health': 'src/health/health.ts',
    'native': 'src/server/native-mount.ts',
    'boot': 'src/lifecycle/boot.ts',
    'excludes': 'src/excludes/excludes.ts',
    'log/index': 'src/observability/log/index.ts',
    'lifecycle/events': 'src/lifecycle/events.ts',
    'csrf-middleware-entrypoint': 'src/csrf/middleware-entrypoint.ts',
    'route-middleware-entrypoint': 'src/observability/route-middleware-entrypoint.ts',
    'dev-middleware-entrypoint': 'src/dev-mode/middleware-entrypoint.ts',
  },
  format: ['esm'],
  dts: true,
  fixedExtension: false,
  external: [/^virtual:@astroscope\/node\//],
  // the restart holding page is read next to the compiled chunk at runtime
  onSuccess: 'cp src/dev-mode/restart-page.html dist/',
});
