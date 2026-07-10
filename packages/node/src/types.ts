import type { ExcludePattern } from './excludes/excludes.js';

export interface NodeBootOptions {
  /**
   * Path to the boot file relative to the project root.
   * @default "src/boot.ts" (or "src/boot/index.ts" if present)
   */
  entry?: string | undefined;

  /**
   * Restart the dev server when the boot file (or any of its dependencies) changes.
   * Dev-only — has no effect in production.
   * @default true
   */
  watch?: boolean | undefined;
}

/**
 * Structurally compatible with `ProbePaths` from `health-probes`.
 */
export interface HealthProbePaths {
  live?: string | undefined;
  startup?: string | undefined;
  ready?: string | undefined;
  health?: string | undefined;
}

export interface NodeHealthOptions {
  /**
   * Host to bind the health server to.
   * Falls back to the `HEALTH_HOST` env var, then `'0.0.0.0'` for kubelet probes
   */
  host?: string | undefined;

  /**
   * Port to bind the health server to.
   * Falls back to the `HEALTH_PORT` env var, then `9090`.
   */
  port?: number | undefined;

  /**
   * Custom paths for probe endpoints.
   * @default K8sPaths (from health-probes)
   */
  paths?: HealthProbePaths | undefined;
}

export interface NodeLoggingOptions {
  /**
   * Paths excluded from request logging. Replaces the default
   * (`RECOMMENDED_EXCLUDES` + `STATIC_EXCLUDES`) entirely when provided.
   */
  exclude?: ExcludePattern[] | undefined;

  /**
   * Extended request logging: query string, headers, client address.
   * May capture sensitive data (auth tokens, PII in query strings).
   * @default false
   */
  extended?: boolean | undefined;

  /**
   * Also log requests in dev at the connect level. Off by default — astro's
   * dev server already narrates requests; the `log` proxy works regardless.
   * @default false
   */
  dev?: boolean | undefined;
}

export interface NodePrometheusOptions {
  /**
   * Host to bind the Prometheus reader to.
   * Falls back to the `OTEL_EXPORTER_PROMETHEUS_HOST` env var, then `'0.0.0.0'`.
   */
  host?: string | undefined;

  /**
   * Port for the Prometheus reader.
   * Falls back to the `OTEL_EXPORTER_PROMETHEUS_PORT` env var, then `9464`.
   */
  port?: number | undefined;
}

export interface NodeTelemetryOptions {
  /**
   * Paths excluded from request tracing and metrics. Replaces the default
   * (`RECOMMENDED_EXCLUDES` + `STATIC_EXCLUDES`) entirely when provided.
   */
  exclude?: ExcludePattern[] | undefined;

  /**
   * Prometheus metrics reader on its own port; `false` disables it.
   * @default { host: '0.0.0.0', port: 9464 }
   */
  prometheus?: NodePrometheusOptions | false | undefined;

  /**
   * Also start the telemetry SDK in dev (once per process). Off by default —
   * several apps share localhost and would fight over the Prometheus port.
   * @default false
   */
  dev?: boolean | undefined;
}

export interface NodeOptions {
  /**
   * Boot lifecycle configuration. The boot file's `onStartup` runs before the
   * server starts listening; `onShutdown` runs on SIGTERM/SIGINT after in-flight
   * requests drained. Set to `false` to disable the lifecycle entirely.
   *
   * When left at the default and no boot file exists, the lifecycle is skipped.
   */
  boot?: NodeBootOptions | false | undefined;

  /**
   * Request logging at the native handler (real status, response size,
   * aborted-vs-completed) plus the request-scoped `log` proxy exported from
   * `@astroscope/node/log`. Enabled by default in production; `false` disables
   * request logging (the `log` proxy keeps working).
   */
  logging?: NodeLoggingOptions | false | undefined;

  /**
   * Platform telemetry: server spans and request metrics at the native
   * handler, fetch instrumentation via undici, runtime + host metrics, and a
   * Prometheus reader. Trace exporters are driven by standard `OTEL_*` env
   * vars. Enabled by default in production, off in dev; `false` disables.
   */
  telemetry?: NodeTelemetryOptions | false | undefined;

  /**
   * Kubernetes-style health probes served on a separate port, driven around the
   * boot lifecycle (live before startup, ready after listen, draining on shutdown).
   * Enabled by default in production (never active in dev); set to `false` to disable.
   */
  health?: NodeHealthOptions | false | undefined;

  /**
   * CSRF protection: rejects cross-origin POST/PUT/PATCH/DELETE requests by
   * comparing the Origin header against the request origin. Replaces Astro's
   * built-in `security.checkOrigin` (which supports no exclusions).
   * Enabled by default; set to `false` to keep Astro's built-in behavior.
   */
  csrf?: { exclude?: ExcludePattern[] | undefined } | false | undefined;

  /**
   * Maximum request body size in bytes. `0` or `Infinity` disables the limit.
   * @default 1073741824 (1 GiB)
   */
  bodySizeLimit?: number | undefined;

  /**
   * How long to wait (ms) for in-flight requests to finish on shutdown before
   * remaining connections are closed forcefully.
   * @default 10000
   */
  shutdownTimeout?: number | undefined;
}

/**
 * Resolved configuration embedded into the build via the config virtual module.
 */
export interface RuntimeOptions {
  host: string;
  port: number;
  client: string;
  server: string;
  bodySizeLimit: number;
  shutdownTimeout: number;
  health: { host?: string | undefined; port?: number | undefined; paths?: HealthProbePaths | undefined } | false;
  logging: { exclude: ExcludePattern[]; extended: boolean } | false;
  telemetry:
    { exclude: ExcludePattern[]; prometheus: { host?: string | undefined; port?: number | undefined } | false } | false;
}
