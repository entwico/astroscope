# @astroscope/node

Opinionated, cloud-friendly Node adapter for Astro: boot lifecycle, health probes, request logging, telemetry, CSRF and static serving run as plain code around `server.listen()`.

## What it does

- **Boot lifecycle** — `onStartup` runs before the port opens, `onShutdown` after in-flight requests drain (`src/boot.ts`)
- **Warmup** — pages, middleware and actions are loaded in parallel with startup and awaited before `listen()`
- **Health probes** — Kubernetes-style liveness/readiness on a separate port, with registrable checks
- **Request logging** — pino at the native handler: real status code, response size, ttfb, aborted connections, static responses included
- **Telemetry** — OpenTelemetry NodeSDK, undici fetch instrumentation, runtime + host metrics, Prometheus reader
- **CSRF protection** — origin check for unsafe methods, with path exclusions
- **Platform entry files** — env loading → `src/config.ts` → `src/instrumentation.ts` → `src/log.ts` → boot, each picked up automatically when the file exists
- **Pre-compressed static serving** — build-time brotli/gzip variants, negotiated per `Accept-Encoding`
- **Native mounts** — http-native handlers (`oidc-provider`, ACME) mounted on the adapter's server
- **Build tweaks** — SSR sourcemaps, SSR effect stripping
- **Dev restart machinery** — changes to the boot file or entry seams restart the dev server behind a holding page

## What it does NOT do — beware

The adapter assumes a container behind a load balancer / reverse proxy (Kubernetes, Docker + ingress). Outside that setup, several defaults are wrong for you:

- **No TLS.** Plain HTTP only — terminate TLS at the ingress.
- **Opens `0.0.0.0:9090` in production** — the health probe server. Meant for the kubelet; do not expose it publicly.
- **Opens `0.0.0.0:9464` in production** — the Prometheus metrics reader. Same: cluster-internal only.
- **Trusts any `Host` / `X-Forwarded-Host`** — sets `security.allowedDomains: [{}]` (unless you set it yourself), because the reverse proxy is expected to control these headers. Without one, host header injection is possible.
- **Overrides Astro security and config defaults** — `security.checkOrigin: false` (the embedded CSRF middleware replaces it; `csrf: false` restores Astro's check), `build.redirects: false` (redirects handled at runtime), `trailingSlash: 'never'` (only when yours is at the default `'ignore'`).
- **Standalone only.** No middleware mode — the adapter always owns the server.
- **No session driver.** Astro sessions are unsupported unless you configure `session.driver` yourself.
- **No health probes in dev.** The health server only exists in production and `astro preview`.

## Usage

```typescript
// astro.config.ts
import node from '@astroscope/node';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node(),
});
```

```typescript
// src/boot.ts — picked up automatically (or src/boot/index.ts)
import type { BootContext } from '@astroscope/node';

export async function onStartup(context: BootContext) {
  // connect to databases, warm caches, schedule timers
}

export async function onShutdown() {
  // close connections, clear timers
}
```

`astro preview` runs the full production path (boot, warmup, health, static serving).

In dev, the boot file and the entry files below run through the adapter's own watch/restart machinery: changes to the boot file, its dependency graph, or the config/log files restart the dev server behind a holding page that releases when the new generation is ready.

### Boot context access

Anywhere in server code (including libraries), `getBootContext()` returns the running server's `BootContext` — or `undefined` when no @astroscope/node server has booted in the process (unit tests, one-off scripts). Libraries can use it to adapt to dev mode without making consumers thread the flag through:

```typescript
import { getBootContext } from '@astroscope/node/boot';

const dev = getBootContext()?.dev ?? false;
```

It is stamped before the platform entry files and the boot lifecycle run, in both prod and dev (re-stamped per dev restart generation).

## Platform entry files

Besides `src/boot.ts`, three more files are picked up automatically when they exist. In production they run in this order inside `startServer()`, before anything else; in dev they re-run per restart generation (instrumentation only once per process):

```
env loading → src/config.ts → src/instrumentation.ts → src/log.ts → boot → warmup → listen
```

**Env loading** (platform, position −1): `CONFIG_PATH` env var → `./.env` → none. Existing process env vars win; each outcome is logged.

**`src/config.ts`** — schema + load (e.g. @entwico/zod-conf), nothing else; validation runs at import. On failure: in production the buffered logs are dumped to the console with the error and the process exits 1; in dev the boot gate keeps the holding page up with the error.

```typescript
// src/config.ts
import { conf } from '@entwico/zod-conf';
import { z } from 'zod';

export const config = conf(z.object({ MONGO_URL: z.string() }));
```

**`src/instrumentation.ts`** — extra instrumentation only (the standard bundle is a platform default, see Telemetry). Loaded once per process — dev restarts are in-process, so changes here need a full dev-server restart.

```typescript
// src/instrumentation.ts
import type { InstrumentationContext } from '@astroscope/node';

export function register(ctx: InstrumentationContext) {
  // register additional instrumentations, processors, exporters
}
```

**`src/log.ts`** — pino logger *options* (a static object or a factory), never a logger instance. The platform constructs the logger itself, after instrumentation, and adds a mixin that stamps `trace_id`/`span_id`/`trace_flags` onto every entry when a span is active. This file runs after env loading and `src/config.ts`, so the options may safely read config.

```typescript
// src/log.ts
import type { LoggerOptions } from '@astroscope/node/log';

export default {
  base: { app: 'my-app' },
} satisfies LoggerOptions;
```

Use the factory form when the options depend on the runtime context:

```typescript
// src/log.ts
import type { LoggerOptionsFactory } from '@astroscope/node/log';

const factory: LoggerOptionsFactory = ({ dev }) => ({
  level: dev ? 'debug' : 'info',
});

export default factory;
```

## Logging

The `log` proxy is request-aware: inside a request its entries carry the request bindings (`reqId`, `req`), outside they go to the root logger.

```typescript
import { log } from '@astroscope/node/log';

log.info('handling request');
log.info({ userId: 123 }, 'user logged in');
log.error(err, 'operation failed');

const dbLog = log.child({ component: 'db' });
```

Entries logged before the logger is constructed (env loading, config, instrumentation) are buffered (cap 100) and replayed once construction completes — the original timestamp is kept as a `bufferedTime` field. If startup dies before the logger exists, the buffer is dumped to the console together with the error.

Request logging happens at the native handler on `finish`/`close`: real status code, response size, `ttfb`, aborted-vs-completed, and the route pattern (fed back by an internal astro middleware). An incoming `x-request-id` header is passed through (and echoed on the response); otherwise a short id is generated.

The adapter itself emits exactly one info line on startup — `server ready { host, port, health, bootMs, warmupMs, totalMs }` — and `draining` / `shutdown complete { drainMs }` on the way down. Everything else is debug or error level.

## Telemetry

`node({ telemetry })` ships the standard bundle: NodeSDK, fetch instrumentation via undici (diagnostics-channel based — no `--import` needed), Node runtime + host metrics, and a Prometheus reader on `0.0.0.0:9464`. **Prod: on by default. Dev: off by default** (opt in with `telemetry: { dev: true }`).

- server spans start at the native handler with W3C context extraction; the route pattern and span name are enriched by the internal middleware
- request metrics: `http.server.request.duration`, `http.server.active_requests`, `astro.action.duration`; fetch metrics come from the undici instrumentation
- the boot lifecycle gets `startup` (with `boot`/`warmup`/`listen` children) and `shutdown` (with `drain`/`onShutdown`) spans
- trace exporters are driven by the standard `OTEL_*` env vars; without a configured OTLP endpoint, trace exporting defaults to `none` (no failing localhost exports)
- `OTEL_SDK_DISABLED=true` turns the SDK off entirely

There is no helper for tracing server-render sections: measuring a subtree's render would require buffering it, which disables streaming. Wrap frontmatter awaits with `tracer.startActiveSpan()` instead — that's where the time lives, and it nests under the request span without touching the stream.

## Health checks

Register checks from anywhere in server code — typically `onStartup`:

```typescript
import { registerHealthCheck } from '@astroscope/node/health';

export async function onStartup() {
  const db = await connectMongo();

  registerHealthCheck({ name: 'mongo', check: () => db.ping() });
}
```

- probes flip in order: live during startup, ready only after `listen()`, draining begins the moment a shutdown signal arrives
- a check fails by throwing or returning `{ status: 'unhealthy' }`; failing required checks turn `readyz` unhealthy (`optional: true` checks don't affect it, `timeout` defaults to 5s)
- `registerHealthCheck` returns an unregister function, but cleanup is optional: checks still registered after `onShutdown` are removed automatically
- when no health runtime is active (dev mode, `health: false`), registration is a no-op — no dev/prod branching needed in boot files

## Native mounts

For Node libraries that need the real `(req, res)` — `oidc-provider`'s `callback()`, ACME challenge handlers — mount them on the adapter's server instead of faking Node objects inside astro middleware:

```typescript
// src/boot.ts
import { mountNativeHandler } from '@astroscope/node/native';

export function onStartup() {
  mountNativeHandler({ prefix: '/oidc', name: 'oidc' }, getOidcProvider().callback());
}
```

- the handler owns the response completely: matched requests are dispatched before static serving and never reach astro middleware or rendering — machine endpoints (`/token`, `/introspection`) need no csrf exclusions because they never meet the csrf middleware
- the handler gets the real request and response: streaming bodies, `socket.remoteAddress`, set-cookie arrays
- requests stay inside request logging and tracing; `name` becomes the route label for logs, metrics and span names
- identical in dev — the same registry is dispatched at the connect level, so there is no fake-host-header or dev/prod drift
- matching: `prefix` (segment-aware, longest wins) or a `match(req)` predicate consulted after prefixes, in registration order
- returns an unregister function; mounts are cleared automatically after `onShutdown` (and between dev restart generations)
- handler errors are logged and answered with a 500 (unless the handler already sent headers)

## Exclude patterns

`@astroscope/node/excludes` ships the shared exclude-pattern vocabulary for middlewares. Matching itself comes from [`@entwico/dash/match`](https://github.com/entwico/dash); `ExcludePattern` is the serializable subset of dash's `StringPattern` (`exact` / `prefix` / `suffix` / `includes` / `pattern` — no matcher functions, since adapter options cross a virtual-module boundary).

```typescript
import { RECOMMENDED_EXCLUDES, shouldExclude, withExcluded } from '@astroscope/node/excludes';

// pre-defined sets: DEV_EXCLUDES (vite dev paths), ASTRO_STATIC_EXCLUDES (/_astro/, /_image),
// STATIC_EXCLUDES (favicon, robots.txt, ...), RECOMMENDED_EXCLUDES (dev + astro internals)

// in your own middleware
if (shouldExclude(ctx, [...RECOMMENDED_EXCLUDES, { exact: '/health' }])) return next();

// or wrap a third-party middleware without built-in exclude support
export const onRequest = withExcluded(someExternalMiddleware(), RECOMMENDED_EXCLUDES);
```

For hot paths, compile the set once with `createMatcher` from `@entwico/dash/match` instead of scanning per request (the adapter's own request instrumentation does exactly that).

## Pre-compressed static serving

At build time, every compressible file in `dist/client` gets max-quality `.br` (brotli 11) and `.gz` (gzip 9) variants written next to it — variants that don't shrink the file are skipped. At request time the static handler negotiates `Accept-Encoding` and serves the best variant with the original's content-type, `content-encoding`, `vary: accept-encoding` and per-variant etags (304s included). Behind a caching proxy with per-encoding cache keys, the origin serves each asset once per encoding.

## Embedded build tweaks

Always on, no configuration:

- **SSR sourcemaps** — the server bundle gets sourcemaps for readable stack traces; client bundles stay unmapped so browsers can't fetch source
- **SSR effect stripping** — `useEffect`/`useLayoutEffect`/`useInsertionEffect` callbacks are emptied in the SSR bundle (effects never run on the server), letting the bundler drop client-only dynamic imports (maplibre-gl, hls.js, …) from the server build and the docker image

## Options

```typescript
node({
  // boot lifecycle; false disables it. Skipped automatically when no boot file exists.
  boot: {
    entry: 'src/boot.ts', // default: src/boot.ts or src/boot/index.ts
    watch: true,          // dev: restart the dev server on boot-dependency changes
  },

  // Kubernetes-style probes on a separate port. Enabled by default in
  // production (never active in dev); false disables.
  health: {
    host: '0.0.0.0', // falls back to HEALTH_HOST env, then 0.0.0.0 (kubelet probes hit the pod IP)
    port: 9090,      // falls back to HEALTH_PORT env, then 9090
  },

  // CSRF protection (origin check for POST/PUT/PATCH/DELETE with exclusions).
  // Enabled by default; false keeps astro's built-in checkOrigin instead.
  csrf: {
    exclude: [{ exact: '/api/auth/backchannel-logout' }],
  },

  // request logging at the native handler. Enabled by default in production;
  // false disables it (the log proxy keeps working).
  logging: {
    exclude: [{ prefix: '/internal/' }], // replaces RECOMMENDED_EXCLUDES + STATIC_EXCLUDES
    extended: false,                     // query/headers/client address (may capture sensitive data)
    dev: false,                          // also log requests in dev (astro narrates them already)
  },

  // platform telemetry. Enabled by default in production, off in dev; false disables.
  telemetry: {
    exclude: [{ prefix: '/internal/' }], // replaces RECOMMENDED_EXCLUDES + STATIC_EXCLUDES
    prometheus: { host: '0.0.0.0', port: 9464 }, // false disables the reader
    dev: false,                          // start the SDK in dev too (once per process)
  },

  bodySizeLimit: 1024 * 1024 * 1024, // request body limit in bytes
  shutdownTimeout: 10_000,           // ms to wait for in-flight requests on shutdown
});
```

## Environment variables

| Variable | Effect |
|----------|--------|
| `HOST` / `PORT` | Override the listen address at runtime |
| `HEALTH_HOST` / `HEALTH_PORT` | Override the health probe address (when not set in options) |
| `CONFIG_PATH` | Env file to load at startup (falls back to `./.env`) |
| `OTEL_EXPORTER_PROMETHEUS_HOST` / `OTEL_EXPORTER_PROMETHEUS_PORT` | Override the Prometheus reader address |
| `OTEL_SDK_DISABLED=true` | Disable the telemetry SDK entirely |
| standard `OTEL_*` | Exporter/resource configuration (e.g. `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`) |
| `ASTROSCOPE_NODE_AUTOSTART=disabled` | Build the entry without starting the server (exports `startServer()`) |

## Shutdown sequence

On SIGTERM/SIGINT:

1. readiness probe starts failing, `draining` is logged
2. the server stops accepting connections and waits up to `shutdownTimeout` for in-flight requests
3. `onShutdown` runs
4. `shutdown complete { drainMs }` is logged, the health server stops, telemetry flushes, the process exits with code 0

## License

MIT
