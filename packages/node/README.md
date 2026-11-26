# @astroscope/node

Opinionated, cloud-friendly Node adapter for Astro: boot lifecycle, health probes, request logging, telemetry, CSRF and static serving.

## What it does

- **Boot lifecycle** — `onStartup` runs before the port opens, `onShutdown` after in-flight requests drain (`src/boot.ts`)
- **Warmup** — pages, middleware and actions are loaded before the port opens
- **Health probes** — Kubernetes-style liveness/readiness on a separate port, with registrable checks
- **Request logging** — pino: real status code, response size, ttfb, aborted connections, static responses included
- **Telemetry** — OpenTelemetry NodeSDK, undici fetch instrumentation, runtime + host metrics, Prometheus reader
- **CSRF protection** — origin check for unsafe methods, with path exclusions
- **Path redirects** — duplicate slashes (`//about`) and a trailing slash that contradicts `trailingSlash` (`/about/`) redirect to the canonical URL, in dev as in prod
- **Platform entry files** — env loading → `src/config.ts` → `src/instrumentation.ts` → `src/log.ts` → boot, each picked up automatically when the file exists
- **Island preloading** — each island's JS is preloaded in parallel ([Island preloading](#island-preloading))
- **Pre-compressed static serving** — build-time brotli/gzip variants, negotiated per `Accept-Encoding`
- **Native mounts** — http-native handlers (`oidc-provider`, ACME) mounted on the adapter's server
- **Build tweaks** — SSR sourcemaps
- **Image processing off unless configured** — without an explicit `image.service`, any `astro:assets` use fails loudly ([Image processing](#image-processing))
- **Dev restart machinery** — changes to the boot file or entry seams restart the dev server behind a holding page
- **HTTPS for development** — `SERVER_CERT_PATH` / `SERVER_KEY_PATH` serve TLS directly for local runs of the built server ([HTTPS](#https)); in production, terminate TLS at the ingress

## What it does NOT do — beware

The adapter assumes a container behind a load balancer / reverse proxy (Kubernetes, Docker + ingress). Outside that setup, several defaults are wrong for you:

- **Opens `0.0.0.0:9090` in production** — the health probe server. Meant for the kubelet; do not expose it publicly.
- **Opens `0.0.0.0:9464` in production** — the Prometheus metrics reader. Same: cluster-internal only.
- **Trusts any `Host` / `X-Forwarded-Host`** — sets `security.allowedDomains: [{}]` unless you set it yourself. Your reverse proxy must control these headers.
- **Trusts `X-Forwarded-For`** — anything that keys on the client address uses the header as received. Your reverse proxy must set it.
- **Overrides Astro security and config defaults** — `security.checkOrigin: false` (the embedded CSRF middleware replaces it; `csrf: false` restores Astro's check), `build.redirects: false`, `trailingSlash: 'never'` (only when yours is at the default `'ignore'`), `astro:assets` disabled when `image.service` is at its default ([Image processing](#image-processing)).
- **Limits request bodies to 1 MiB** — every request astro handles, pages and endpoints included. An upload route needs `bodySizeLimit` raised (native mounts are not covered).
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

### Boot context access

Anywhere in server code (including libraries), `getBootContext()` returns the running server's `BootContext` — or `undefined` when no @astroscope/node server has booted in the process (unit tests, one-off scripts):

```typescript
import { getBootContext } from '@astroscope/node/boot';

const dev = getBootContext()?.dev ?? false;
```

### Lifecycle events

A library that needs to run at boot or shutdown without a line in the site's `src/boot.ts` listens on `@astroscope/node/events`: `on(event, handler)` and `off(event, handler)` for `beforeOnStartup`, `afterOnStartup`, `beforeOnShutdown` and `afterOnShutdown`. Handlers get the `BootContext`; `afterOnShutdown` runs even when `onShutdown` threw.

```typescript
import { on } from '@astroscope/node/events';

on('beforeOnShutdown', async () => {
  await flushPendingWork();
});
```

## Platform entry files

Besides `src/boot.ts`, three more files are picked up automatically when they exist. They run in this order:

```
env loading → src/config.ts → src/instrumentation.ts → src/log.ts → boot → warmup → listen
```

**Env loading**: `CONFIG_PATH` env var → `./.env` → none. Existing process env vars win; each outcome is logged.

**`src/config.ts`** — schema + load (e.g. @entwico/zod-conf), nothing else; validation runs at import.

```typescript
// src/config.ts
import zc from '@entwico/zod-conf';

export const config = zc.define({ MONGO_URL: zc.env('MONGO_URL').string() }).load({ env: process.env });
```

**`src/instrumentation.ts`** — extra instrumentation only (the standard bundle is a platform default, see Telemetry). Loaded once per process: changes here need a full dev-server restart.

```typescript
// src/instrumentation.ts
import type { InstrumentationContext } from '@astroscope/node';

export function register(ctx: InstrumentationContext) {
  // register additional instrumentations, processors, exporters
}
```

**`src/log.ts`** — pino logger _options_ (a static object or a factory), never a logger instance. Entries carry `trace_id`/`span_id`/`trace_flags` when a span is active. The options may read config.

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

Entries logged before the logger is constructed (env loading, config, instrumentation) are buffered and replayed once construction completes — the original timestamp is kept as a `bufferedTime` field. If startup dies before the logger exists, the buffer is dumped to the console together with the error.

Request log lines carry the real status code, response size, `ttfb`, aborted-vs-completed, and the route pattern. An incoming `x-request-id` header is passed through (and echoed on the response); otherwise a short id is generated.

Responses the adapter sends itself get a route label of their own: `static` for a file served from the client dir (public assets, prerendered pages, 200 and 304 alike), `duplicate-slashes` and `trailing-slash` for the path redirects, `body-limit` for a refused body, and a native mount's `name`.

### Reporting the route yourself

A middleware that serves a request astro has no page for — one that rewrites via `next(url)`, or answers itself — is logged and measured as `/404`. `overrideRequestRoute` lets it report what it actually served:

```typescript
import { overrideRequestRoute } from '@astroscope/node/log';
import type { MiddlewareHandler } from 'astro';

export const onRequest: MiddlewareHandler = (ctx, next) => {
  const page = lookupPage(ctx.url.pathname);

  if (!page) return next();

  overrideRequestRoute('/cms/pages/[id]');

  return next(`/cms/pages/${page.id}`);
};
```

This fixes the log line, the metric and the server span name together. Pass a templated label, not a concrete path. An overridden route always wins over the one astro matched, regardless of middleware order.

The adapter itself emits exactly one info line on startup — `server ready { host, port, health, bootMs, warmupMs, totalMs }` — and `draining` / `shutdown complete { drainMs }` on the way down. Everything else is debug or error level.

## Telemetry

`node({ telemetry })` ships the standard bundle: NodeSDK, undici fetch instrumentation, Node runtime + host metrics, and a Prometheus reader on `0.0.0.0:9464`. **Prod: on by default. Dev: off by default** (opt in with `telemetry: { dev: true }`).

- server spans extract W3C trace context and are named after the route pattern
- `url.query` carries the query string with the values of `redactedQueryParams` replaced by `REDACTED`, by default the signed-url credentials of OpenTelemetry's semantic conventions (exported as `OTEL_REDACTED_QUERY_PARAMS`); an application secret in a query string (an oauth `code`, a reset `token`) needs adding. The same applies to the `query` of extended request logs
- request metrics: `http.server.request.duration`, `http.server.active_requests`, `astro.action.duration` (`astro.action.name` is the registry name, any other `/_actions/` path counts as `unknown`); fetch metrics come from the undici instrumentation
- `astro.render.failures` {`http.route`} counts renders that failed after the status went out; the response is truncated on the wire, the request log line reads `request truncated` at error level and the server span carries `astro.response.truncated`
- the boot lifecycle gets `startup` (with `boot`/`warmup`/`listen` children) and `shutdown` (with `drain`/`onShutdown`) spans
- trace exporters are driven by the standard `OTEL_*` env vars; without a configured OTLP endpoint, trace exporting defaults to `none`
- `OTEL_SDK_DISABLED=true` turns the SDK off entirely
- the other astroscope packages record through the same SDK and are no-ops without it — their instruments are documented with them: [`@astroscope/react`](../react/README.md), [`@astroscope/wormhole`](../wormhole/README.md), [`@astroscope/i18n`](../i18n/README.md)

There is no helper for tracing server-render sections: wrap frontmatter awaits with `tracer.startActiveSpan()` from `@opentelemetry/api`.

## Health checks

Register checks from anywhere in server code — typically `onStartup`:

```typescript
import { registerHealthCheck } from '@astroscope/node/health';

export async function onStartup() {
  const db = await connectMongo();

  registerHealthCheck({ name: 'mongo', check: () => db.ping() });
}
```

- a check fails by throwing or returning `{ status: 'unhealthy' }`; failing required checks turn the readiness probe unhealthy (`optional: true` checks don't affect it, `timeout` defaults to 5s)
- `registerHealthCheck` returns an unregister function, but cleanup is optional: checks still registered after `onShutdown` are removed automatically
- when no health runtime is active (dev mode, `health: false`), registration is a no-op — no dev/prod branching needed in boot files

## Native mounts

For Node libraries that need the real `(req, res)` — `oidc-provider`'s `callback()`, ACME challenge handlers — mount them on the adapter's server:

```typescript
// src/boot.ts
import { mountNativeHandler } from '@astroscope/node/native';

export function onStartup() {
  mountNativeHandler({ prefix: '/oidc', name: 'oidc' }, getOidcProvider().callback());
}
```

- the handler owns the response completely: matched requests never reach astro middleware, so they need no csrf exclusions
- requests stay inside request logging and tracing; `name` becomes the route label for logs, metrics and span names
- identical in dev
- matching: `prefix` (segment-aware, longest wins) or a `match(req)` predicate consulted after prefixes, in registration order
- returns an unregister function; mounts are cleared automatically after `onShutdown` (and between dev restart generations)

## Guards

`@astroscope/node/guards` puts protection where the request lands, with the types to match: a guard either denies or proves something, and what it proves is required on `locals` for the guarded code only. `App.Locals` keeps the honest shape (`user?: User`).

```typescript
// src/guards.ts
import { defineGuard, deny } from '@astroscope/node/guards';

export const authenticated = defineGuard({
  name: 'authenticated',
  check: (ctx) => ({ user: ctx.locals.user ?? deny('UNAUTHORIZED') }),
  page: (ctx) => ctx.redirect('/login'),
});

// runs after `authenticated`, with `ctx.locals.user` already required
export const admin = authenticated.extend({
  name: 'admin',
  check: (ctx) => {
    if (!ctx.locals.user.roles.admin) deny('FORBIDDEN');
  },
  page: (ctx) => ctx.rewrite('/404'),
});
```

`deny(code, message?)` throws an `ActionError`; the returned object is the proof. A guard may also load something once and hand it over typed (`check: async (ctx, { projectId }) => ({ project: await loadProject(...) })`), declaring the request fields it needs in `input` (a zod shape).

Actions take `guards` in place of Astro's `defineAction` (the `no-astro-define-action` lint rule enforces the import). Guards run after input validation; fields they declare are merged into the schema and stripped again before the handler:

```typescript
import { defineAction } from '@astroscope/node/guards';
import { z } from 'astro/zod';
import { admin } from '../guards';

export const server = {
  rename: defineAction({
    input: z.object({ projectId: z.string(), name: z.string() }),
    guards: [admin],
    handler: async (input, ctx) => {
      ctx.locals.user; // User, not User | undefined
    },
  }),
};
```

Endpoints wrap the same way; fields a guard declares in `input` come from a json or form body:

```typescript
import { defineRoute } from '@astroscope/node/guards';
import { admin } from '../../guards';

export const POST = defineRoute({
  guards: [admin],
  handler: async (ctx) => Response.json({ by: ctx.locals.user.id }),
});
```

A page's frontmatter is the handler, so it asks and returns:

```astro
---
import { guard } from '@astroscope/node/guards';
import { admin } from '../guards';

const { denied, user } = await guard(Astro, [admin]);

if (denied) return denied;
---
```

After the check `user` is required, before it optional.

A denial answers per the request, on every surface: a browser navigation (`text/html` in `Accept`) gets the denying guard's `page` response, the login redirect above or a 404 rewrite, or the status with the message when the guard has none; any other caller gets `{ error: { code, message } }` with the status. A denial raised by a parent in an `extend()` chain keeps the parent's `page` handler.

Whole areas are guarded from the middleware, with the same guards and the same denial responses:

```typescript
// src/middleware.ts
import { createGuardMiddleware } from '@astroscope/node/guards';
import { sequence } from 'astro:middleware';
import { admin, authenticated } from './guards';
import { sessionMiddleware } from './session';

export const onRequest = sequence(
  sessionMiddleware,
  createGuardMiddleware([
    { match: [{ prefix: '/app' }], guards: [authenticated] },
    { match: [{ prefix: '/admin' }], guards: [admin] },
  ]),
);
```

Patterns are the exclude-pattern vocabulary (`prefix`, `exact`, `suffix`, `includes`, `pattern`). It is defence in depth, not a replacement for the page-level call: a middleware cannot narrow `locals`, so pages inside the area still call `guard(Astro, [...])` for the typed proofs.

A server island renders through astro's own endpoint, outside a prefix rule for the page's path: a component that must not render for everyone calls `guard(Astro, [...])` in its own frontmatter.

### Available guards

The package ships the guards that depend on the request alone; the ones that depend on your session shape (`authenticated`, `admin`) stay in the app, and a package ships the guard for its own concern (`captcha()` from `@astroscope/cap/server`).

#### `rateLimit({ max, window, key?, name? })`

A fixed window per key, in memory and per process: the `max`-th request within `window` ms still passes, the next one is denied with `TOO_MANY_REQUESTS` (429) until the window ends. The key is the client address by default; `key(ctx)` picks another subject (a user id, a target email) or returns `undefined` to exempt a request. Per process means per replica.

Put it first in a list:

```typescript
import { captcha } from '@astroscope/cap/server';
import { rateLimit } from '@astroscope/node/guards';

guards: [rateLimit({ max: 5, window: 60_000 }), captcha()],
```

## Exclude patterns

`@astroscope/node/excludes` ships the shared exclude-pattern vocabulary for middlewares. An `ExcludePattern` is one of `exact` / `prefix` / `suffix` / `includes` / `pattern`.

```typescript
import { RECOMMENDED_EXCLUDES, shouldExclude, withExcluded } from '@astroscope/node/excludes';

// pre-defined sets: DEV_EXCLUDES (vite dev paths), ASTRO_STATIC_EXCLUDES (/_astro/, /_image, /_i18n/),
// STATIC_EXCLUDES (favicon, robots.txt, ...), RECOMMENDED_EXCLUDES (dev + astro internals)

// in your own middleware
if (shouldExclude(ctx, [...RECOMMENDED_EXCLUDES, { exact: '/health' }])) return next();

// or wrap a third-party middleware without built-in exclude support
export const onRequest = withExcluded(someExternalMiddleware(), RECOMMENDED_EXCLUDES);
```

For hot paths, compile the set once with `createMatcher` from `@entwico/dash/match` instead of scanning per request.

## Island preloading

In production each island's JS is preloaded in parallel, deferred islands just ahead of their hydration. Always on in production; `islands: false` disables the preloading only.

## Pre-compressed static serving

At build time compressible files in `dist/client` get `.br` and `.gz` variants; the static handler serves the best one per `Accept-Encoding`.

## Embedded build tweaks

Always on, no configuration:

- **SSR sourcemaps** — the server bundle gets sourcemaps; client bundles stay unmapped

SSR effect stripping for React islands lives in [`@astroscope/react`](../react).

## Image processing

Image processing is off unless you ask for it:

```typescript
node({
  imageService: 'auto', // 'on' | 'off' | 'auto'
});
```

- `'auto'` (default) — on when the astro config sets an `image.service` other than astro's default sharp, off otherwise. An explicit `sharpImageService()` needs `'on'`
- `'on'` — astro's default sharp service, no further config needed
- `'off'` — off even over an explicit `image.service`

Off is loud: any `astro:assets` use (`<Image>`, `<Picture>`, `getImage()`, markdown images) throws with an explanation, and `/_image` answers 404.

## Options

```typescript
node({
  // boot lifecycle; false disables it. Skipped automatically when no boot file exists.
  boot: {
    entry: 'src/boot.ts', // default: src/boot.ts or src/boot/index.ts
    watch: true, // dev: restart the dev server on boot-dependency changes
  },

  // Kubernetes-style probes on a separate port. Enabled by default in
  // production (never active in dev); false disables.
  health: {
    host: '0.0.0.0', // falls back to HEALTH_HOST env, then 0.0.0.0
    port: 9090, // falls back to HEALTH_PORT env, then 9090
    paths: { live: '/livez', startup: '/startupz', ready: '/readyz', health: '/healthz' }, // probe endpoints (the defaults)
  },

  // CSRF protection (origin check for POST/PUT/PATCH/DELETE with exclusions).
  // Enabled by default; false keeps astro's built-in checkOrigin instead.
  csrf: {
    exclude: [{ exact: '/api/auth/backchannel-logout' }],
  },

  // request logging. Enabled by default in production;
  // false disables it (the log proxy keeps working).
  logging: {
    exclude: [{ prefix: '/internal/' }], // replaces RECOMMENDED_EXCLUDES
    extended: false, // query (redacted per redactedQueryParams)/headers/client address (may capture sensitive data)
    dev: false, // also log requests in dev
  },

  // platform telemetry. Enabled by default in production, off in dev; false disables.
  telemetry: {
    exclude: [{ prefix: '/internal/' }], // replaces RECOMMENDED_EXCLUDES
    prometheus: { host: '0.0.0.0', port: 9464 }, // false disables the reader
    dev: false, // start the SDK in dev too (once per process)
  },

  // island dependency preloading (production-only); false disables it
  islands: false,

  // on-demand image processing: 'auto' = on only when image.service is set
  // in the astro config (see the Image processing section)
  imageService: 'auto',

  // query parameters redacted in server spans and extended request logs; replaces
  // OTEL_REDACTED_QUERY_PARAMS (the signed-url credentials of the OpenTelemetry conventions)
  redactedQueryParams: [...OTEL_REDACTED_QUERY_PARAMS, 'code', 'token'],

  bodySizeLimit: 1024 * 1024, // request body limit in bytes: 413 when announced larger, cut off when chunked
  shutdownTimeout: 10_000, // ms to wait for in-flight requests on shutdown; also bounds onShutdown and the telemetry flush, each
  keepAliveTimeout: 120_000, // ms an idle keep-alive connection stays open; must exceed the reverse proxy's idle timeout
});
```

## HTTPS

The built server serves plain HTTP — in production, TLS is expected to terminate at the ingress. For local runs of the built server (e.g. auth flows that require a secure origin), set `SERVER_CERT_PATH` and `SERVER_KEY_PATH` to serve HTTPS directly — the same contract as `@astrojs/node`:

```sh
SERVER_CERT_PATH=./cert/tls.crt
SERVER_KEY_PATH=./cert/tls.key
```

Both must be set — startup fails if only one is present. Since env files load before the server starts listening, the variables may live in `.env` (or the file pointed to by `CONFIG_PATH`) instead of the shell environment.

This only affects the built server. The dev server is Vite's — configure `vite.server.https` in `astro.config` for HTTPS in dev.

## Environment variables

| Variable                                                          | Effect                                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `HOST` / `PORT`                                                   | Override the listen address at runtime                                                    |
| `SERVER_CERT_PATH` / `SERVER_KEY_PATH`                            | Serve HTTPS with the given certificate/key (see [HTTPS](#https))                          |
| `HEALTH_HOST` / `HEALTH_PORT`                                     | Override the health probe address (when not set in options)                               |
| `CONFIG_PATH`                                                     | Env file to load at startup (falls back to `./.env`)                                      |
| `OTEL_EXPORTER_PROMETHEUS_HOST` / `OTEL_EXPORTER_PROMETHEUS_PORT` | Override the Prometheus reader address                                                    |
| `OTEL_SDK_DISABLED=true`                                          | Disable the telemetry SDK entirely                                                        |
| standard `OTEL_*`                                                 | Exporter/resource configuration (e.g. `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`) |
| `ASTROSCOPE_NODE_AUTOSTART=disabled`                              | Build the entry without starting the server (exports `startServer()`)                     |

## Shutdown sequence

On SIGTERM/SIGINT the readiness probe fails and `draining` is logged; in-flight requests, the shutdown hooks and the telemetry flush are each bounded by `shutdownTimeout`; `shutdown complete { drainMs }` is logged and the process exits with code 0.

## License

MIT
