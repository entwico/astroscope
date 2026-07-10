import { log } from '../log/index.js';

/**
 * Platform-owned telemetry bundle: NodeSDK with undici (fetch) and node
 * runtime instrumentation, host metrics, and a Prometheus reader. Trace
 * exporters are driven by standard `OTEL_*` env vars; without any of them
 * traces stay off (no failing localhost OTLP exports).
 *
 * Guarded per process (dev restarts are in-process; a re-created NodeSDK
 * would double-register instrumentations and leak the Prometheus port).
 */

const TELEMETRY_KEY = Symbol.for('@astroscope/node/telemetry');

interface TelemetryHandle {
  shutdown: () => Promise<void>;
}

export interface TelemetrySdkOptions {
  prometheus: { host?: string | undefined; port?: number | undefined } | false;
}

function getHandle(): TelemetryHandle | undefined {
  return (globalThis as Record<symbol, unknown>)[TELEMETRY_KEY] as TelemetryHandle | undefined;
}

function defaultEnv(key: string, value: string): void {
  if (!process.env[key]) process.env[key] = value;
}

export async function startTelemetry(options: TelemetrySdkOptions): Promise<void> {
  const g = globalThis as Record<symbol, unknown>;

  if (g[TELEMETRY_KEY]) return;

  if (process.env['OTEL_SDK_DISABLED'] === 'true') {
    log.debug('telemetry disabled via OTEL_SDK_DISABLED');

    return;
  }

  // without an explicitly configured exporter target, exporting traces to the
  // default localhost OTLP endpoint would fail on every flush
  if (!process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] && !process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']) {
    defaultEnv('OTEL_TRACES_EXPORTER', 'none');
  }

  defaultEnv('OTEL_METRICS_EXPORTER', 'none');
  defaultEnv('OTEL_LOGS_EXPORTER', 'none');

  const [
    { NodeSDK },
    { UndiciInstrumentation },
    { RuntimeNodeInstrumentation },
    { PrometheusExporter },
    { HostMetrics },
  ] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/instrumentation-undici'),
    import('@opentelemetry/instrumentation-runtime-node'),
    import('@opentelemetry/exporter-prometheus'),
    import('@opentelemetry/host-metrics'),
  ]);

  const prometheus = options.prometheus
    ? {
        host: process.env['OTEL_EXPORTER_PROMETHEUS_HOST'] ?? options.prometheus.host ?? '0.0.0.0',
        port: process.env['OTEL_EXPORTER_PROMETHEUS_PORT']
          ? Number(process.env['OTEL_EXPORTER_PROMETHEUS_PORT'])
          : (options.prometheus.port ?? 9464),
      }
    : false;

  const sdk = new NodeSDK({
    instrumentations: [new UndiciInstrumentation(), new RuntimeNodeInstrumentation()],
    ...(prometheus && { metricReaders: [new PrometheusExporter(prometheus)] }),
  });

  sdk.start();

  const hostMetrics = new HostMetrics();

  hostMetrics.start();

  g[TELEMETRY_KEY] = {
    shutdown: () => sdk.shutdown(),
  } satisfies TelemetryHandle;

  if (prometheus) {
    log.debug({ host: prometheus.host, port: prometheus.port }, 'prometheus metrics listening');
  }
}

/**
 * Flush and shut the SDK down. Prod-only (dev keeps the SDK for the process
 * lifetime across generations).
 */
export async function shutdownTelemetry(): Promise<void> {
  const handle = getHandle();

  if (!handle) return;

  delete (globalThis as Record<symbol, unknown>)[TELEMETRY_KEY];

  await handle.shutdown();
}
