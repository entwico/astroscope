# @astroscope/node

## 3.1.0

### Minor Changes

- 8aa494d: `getRequestRouteData` accepts the api context, which stays valid across `next(url)` rewrites

### Patch Changes

- 8aa494d: the islands middleware keeps telling pages from html-returning endpoints apart on pages served through a `next(url)` rewrite

## 3.0.0

### Major Changes

- b936e21: SSR effect stripping removed — use `@astroscope/react` in place of `@astrojs/react` to keep it

### Minor Changes

- b936e21: `/_i18n/` translation chunk requests are excluded from request logging, telemetry and the platform middlewares by default (`ASTRO_STATIC_EXCLUDES`)
- b936e21: a render that fails after the response started is logged with its route, the completion line reads `request truncated`, the server span carries `astro.response.truncated` and `astro.render.failures` counts it
- b936e21: the islands manifest records which islands each route hydrates

### Patch Changes

- b936e21: requests whose path carries duplicate slashes (`//weine`, `/seminare///x`) redirect to the collapsed path (301, 308 for non-GET)
- b936e21: `http.server.request.duration` and `astro.action.duration` use the semconv bucket boundaries (5 ms – 10 s) — latency panels built on them will read differently
- b936e21: island preloading: html rewriting is faster

## 2.1.1

### Patch Changes

- fc9307f: remove path stripping
- fc9307f: fix `client:visible` gates

## 2.1.0

### Minor Changes

- f8e5fb6: island emitters can contribute `imports` — data-module urls the deferred gate `import()`s eagerly when a directive fires

### Patch Changes

- 4877152: inline the deferred-islands gate runtime — gates install at parse time instead of losing a round trip to an external script fetch

## 2.0.1

### Patch Changes

- 6f15c19: fix server build leaking build machine paths

## 2.0.0

### Major Changes

- af0a493: island dependency preloading: html responses from page routes and prerendered pages emit modulepreload links for each island's chunk closure, with deferred islands (visible/idle/media) fetched by a small gate runtime that follows the directive's own scheduling; html from endpoint routes (e.g. a proxy catch-all) passes through untouched; disable with `islands: false`
- af0a493: image processing is now off unless configured: when the astro config leaves `image.service` at its default, any `astro:assets` use (`<Image>`, `getImage()`, markdown images) throws with an explanation and `/_image` answers 404 — in SSR the on-demand sharp endpoint is an abuse-prone amplification surface most apps don't need. Control via the new `imageService: 'on' | 'off' | 'auto'` adapter option: `'on'` keeps astro's sharp service, `'off'` forces off, `'auto'` (default) follows whether `image.service` is set

### Minor Changes

- af0a493: new `@astroscope/node/islands` API for integrations: `registerIslandEmitter` and `registerDocumentEmitter` contribute per-island preload links/scripts and per-document content to the html streaming pass (used by `@astroscope/i18n` and `@astroscope/wormhole`)

## 1.4.0

### Minor Changes

- 5ec1917: startup now fails when a server module cannot be imported during warmup
- 42e84ba: dev server now pre-optimizes and warms hydrated island dependencies, preventing "Outdated Optimize Dep" hydration failures

### Patch Changes

- 42e84ba: update deps

## 1.3.0

### Minor Changes

- 638d8be: add `overrideRequestRoute` for observability overrides

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
