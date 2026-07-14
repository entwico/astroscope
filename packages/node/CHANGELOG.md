# @astroscope/node

## 1.2.2

### Patch Changes

- cbe0235: log a `starting` line at boot and rename the shutdown log from `draining` to `shutdown initiated`

## 1.2.1

### Patch Changes

- cf035ea: no longer exclude favicon/robots/sitemap paths from request logging and tracing by default

## 1.2.0

### Minor Changes

- 8e43e05: request traces include a response:first-byte child span and a ttfb attribute

### Patch Changes

- 8e43e05: request traces no longer parent under the startup trace

## 1.1.0

### Minor Changes

- 75a3b38: serve HTTPS when SERVER_CERT_PATH and SERVER_KEY_PATH are set

## 1.0.1

### Patch Changes

- fc8bbe8: load env files before the boot module graph is evaluated

## 1.0.0

### Major Changes

- 8eda3c5: initial release: node adapter with built-in boot lifecycle, warmup, health probes, CSRF protection, build tweaks and pre-compressed static serving

### Minor Changes

- 8eda3c5: embed the boot lifecycle and dev restart machinery — replaces `@astroscope/boot` (`BootContext` is now exported from `@astroscope/node`, boot events from `@astroscope/node/events`)
- 8eda3c5: add native mounts (`mountNativeHandler` from `@astroscope/node/native`): raw `(req, res)` handlers dispatched before static/astro, identical in dev and prod — for `oidc-provider` and other http-native libraries
- 8eda3c5: add `getBootContext()` at `@astroscope/node/boot` — read the running server's boot context (incl. `dev`) from any server code without threading it through
- 8eda3c5: embed exclude patterns at `@astroscope/node/excludes` (matching via `@entwico/dash/match`, adds `suffix`/`includes` pattern types) — replaces the removed `@astroscope/excludes`
- 8eda3c5: embed request logging and OpenTelemetry: `log` proxy at `@astroscope/node/log` with early-log buffering, request logging and server spans at the native handler, platform telemetry defaults (undici fetch instrumentation, runtime/host metrics, Prometheus reader), and auto-detected entry files (`src/config.ts`, `src/instrumentation.ts`, `src/log.ts`) — replaces `@astroscope/pino` and `@astroscope/opentelemetry`
