import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      server: 'src/server/index.ts',
      preview: 'src/server/preview.ts',
      health: 'src/health/index.ts',
      native: 'src/server/native-mount.ts',
      boot: 'src/lifecycle/boot.ts',
      excludes: 'src/excludes/index.ts',
      guards: 'src/guards/index.ts',
      'log/index': 'src/observability/log/index.ts',
      telemetry: 'src/observability/telemetry/index.ts',
      'lifecycle/events': 'src/lifecycle/events.ts',
      'csrf-middleware-entrypoint': 'src/csrf/middleware-entrypoint.ts',
      'route-middleware-entrypoint': 'src/observability/route-middleware-entrypoint.ts',
      'dev-middleware-entrypoint': 'src/dev-mode/middleware-entrypoint.ts',
      'image-endpoint': 'src/image/endpoint-disabled.ts',
      'image-service': 'src/image/no-image-service.ts',
      islands: 'src/islands/index.ts',
      'islands-middleware-entrypoint': 'src/islands/middleware-entrypoint.ts',
    },
    format: ['esm'],
    dts: true,
    fixedExtension: false,
    external: [/^virtual:@astroscope\/node\//, /^astro:/],
    // the restart holding page is read next to the compiled chunk at runtime
    onSuccess: 'cp src/dev-mode/restart-page.html dist/',
  },
  {
    // embedded into the islands manifest and inlined into documents — a
    // minified self-contained iife
    entry: { 'islands-runtime': 'src/islands/runtime.ts' },
    format: ['iife'],
    minify: true,
    dts: false,
    fixedExtension: false,
  },
]);
