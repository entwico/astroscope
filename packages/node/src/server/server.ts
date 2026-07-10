import http from 'node:http';
import { checks, server as healthServer, probes } from '@entwico/health-probes';
import { SpanStatusCode } from '@opentelemetry/api';
import { createApp } from 'astro/app/entrypoint';
import { setGetEnv } from 'astro/env/setup';
// @ts-expect-error virtual module provided by the integration
import * as bootModule from 'virtual:@astroscope/node/boot';
// @ts-expect-error virtual module provided by the integration
import { options } from 'virtual:@astroscope/node/config';
import { activateHealthChecks, deactivateHealthChecks } from '../health/store.js';
import { setBootContext } from '../lifecycle/context.js';
import { type BootModule, runShutdown, runStartup } from '../lifecycle/lifecycle.js';
import type { BootContext } from '../lifecycle/types.js';
import { createRequestInstrumentation } from '../observability/instrument.js';
import { dumpEarlyLogs } from '../observability/log/construct.js';
import { log } from '../observability/log/index.js';
import { startLifecycleSpan, withLifecycleSpan } from '../observability/telemetry/lifecycle.js';
import { shutdownTelemetry } from '../observability/telemetry/sdk.js';
import { preparePlatform } from '../platform/prepare.js';
import type { RuntimeOptions } from '../types.js';
import { resolveClientDir } from './client-dir.js';
import { clearNativeMounts, dispatchNativeMount } from './native-mount.js';
import { createAppHandler } from './serve-app.js';
import { createStaticHandler } from './serve-static.js';

setGetEnv((key) => process.env[key]);

const runtimeOptions = options as RuntimeOptions;
const app = createApp({ streaming: true });

const roundMs = (n: number) => Math.round(n * 100) / 100;

/**
 * Pre-import every lazily loaded server module (pages, middleware, actions,
 * session driver) so the first request pays no import cost. Uses the
 * manifest's own loaders — exactly what the runtime calls per request.
 */
async function warmupModules(): Promise<void> {
  const loaders = [
    ...(app.manifest.pageMap?.values() ?? []),
    app.manifest.middleware,
    app.manifest.actions,
    app.manifest.sessionDriver,
    app.manifest.serverIslandMappings,
  ].filter((load) => load !== undefined);

  const results = await Promise.allSettled(loaders.map((load) => load()));

  for (const result of results) {
    if (result.status === 'rejected') {
      log.error(
        result.reason instanceof Error ? { err: result.reason } : { reason: result.reason },
        'warmup import failed',
      );
    }
  }
}

export interface ServerHandle {
  host: string;
  port: number;
  stop(): Promise<void>;
  closed(): Promise<void>;
}

export async function startServer(overrides?: {
  host?: string | undefined;
  port?: number | undefined;
}): Promise<ServerHandle> {
  const startedAt = performance.now();
  const host = overrides?.host ?? process.env['HOST'] ?? runtimeOptions.host;
  const port = overrides?.port ?? (process.env['PORT'] ? Number(process.env['PORT']) : runtimeOptions.port);
  const context: BootContext = { dev: false, host, port };
  const health = runtimeOptions.health;

  setBootContext(context);

  try {
    await preparePlatform({
      dev: false,
      telemetry: runtimeOptions.telemetry ? { prometheus: runtimeOptions.telemetry.prometheus } : false,
      seams: {
        config: () => import('virtual:@astroscope/node/config-entry'),
        instrumentation: () => import('virtual:@astroscope/node/instrumentation-entry'),
        log: () => import('virtual:@astroscope/node/log-entry'),
      },
    });
  } catch (err) {
    // the logger never came up — no silent phase, dump the buffer and die
    dumpEarlyLogs();
    console.error(err);
    process.exit(1);
  }

  if (health) {
    healthServer.start({ ...health, host: health.host ?? process.env['HEALTH_HOST'] ?? '0.0.0.0' });
    probes.live.enable();
    activateHealthChecks(checks);
    log.debug('health probes listening');
  }

  const startup = startLifecycleSpan('startup');

  let bootMs = 0;
  let warmupMs = 0;

  // starts in parallel with the boot startup, awaited before listen
  const warmupStartedAt = performance.now();
  const warmupSpan = startLifecycleSpan('warmup', startup.context);
  const warmup = warmupModules().then(() => {
    warmupMs = roundMs(performance.now() - warmupStartedAt);
    warmupSpan.span.end();
  });

  const shutdownLifecycle = async (
    shutdownContext?: ReturnType<typeof startLifecycleSpan>['context'],
  ): Promise<void> => {
    try {
      if (shutdownContext) {
        await withLifecycleSpan('onShutdown', shutdownContext, () => runShutdown(bootModule as BootModule, context));
      } else {
        await runShutdown(bootModule as BootModule, context);
      }
    } catch (err) {
      log.error(err instanceof Error ? { err } : { reason: err }, 'shutdown failed');
    }

    clearNativeMounts();

    if (health) {
      deactivateHealthChecks();
      await healthServer.stop();
    }
  };

  const failStartup = async (err: unknown, message: string): Promise<never> => {
    log.error(err instanceof Error ? { err } : { reason: err }, message);
    startup.span.setStatus({ code: SpanStatusCode.ERROR, message });
    startup.span.end();

    await shutdownLifecycle();
    await shutdownTelemetry();
    process.exit(1);
  };

  try {
    const bootStartedAt = performance.now();

    await withLifecycleSpan('boot', startup.context, () => runStartup(bootModule as BootModule, context));

    bootMs = roundMs(performance.now() - bootStartedAt);
  } catch (err) {
    await failStartup(err, 'startup failed');
  }

  await warmup;

  if (health) probes.startup.enable();

  const client = resolveClientDir(runtimeOptions, import.meta.url);
  const appHandler = createAppHandler(app, runtimeOptions, client);
  const staticHandler = createStaticHandler(app, client);
  const instrument = createRequestInstrumentation({
    logging: runtimeOptions.logging,
    telemetry: runtimeOptions.telemetry ? { exclude: runtimeOptions.telemetry.exclude } : false,
  });

  const server = http.createServer((req, res) => {
    try {
      decodeURI(req.url ?? '');
    } catch {
      res.writeHead(400);
      res.end('Bad request.');

      return;
    }

    instrument(req, res, () => {
      if (dispatchNativeMount(req, res)) return;

      staticHandler(req, res, () => void appHandler(req, res));
    });
  });

  try {
    await withLifecycleSpan('listen', startup.context, () => {
      return new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
    });
  } catch (err) {
    await failStartup(err, `failed to listen on ${host}:${port}`);
  }

  if (health) probes.ready.enable();

  startup.span.setStatus({ code: SpanStatusCode.OK });
  startup.span.end();

  log.info(
    { host, port, health: !!health, bootMs, warmupMs, totalMs: roundMs(performance.now() - startedAt) },
    'server ready',
  );

  let stopPromise: Promise<void> | undefined;
  let resolveClosed!: () => void;

  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const doStop = async (): Promise<void> => {
    if (health) probes.ready.disable();

    log.info('draining');

    const drainStartedAt = performance.now();
    const shutdown = startLifecycleSpan('shutdown');

    await withLifecycleSpan('drain', shutdown.context, async () => {
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));

      server.closeIdleConnections();

      const forceTimer = setTimeout(() => server.closeAllConnections(), runtimeOptions.shutdownTimeout);

      await closed;

      clearTimeout(forceTimer);
    });

    const drainMs = roundMs(performance.now() - drainStartedAt);

    await shutdownLifecycle(shutdown.context);

    shutdown.span.end();

    log.info({ drainMs }, 'shutdown complete');

    await shutdownTelemetry();
    resolveClosed();
  };

  const stop = (): Promise<void> => (stopPromise ??= doStop());

  process.once('SIGTERM', () => void stop().then(() => process.exit(0)));
  process.once('SIGINT', () => void stop().then(() => process.exit(0)));

  return { host, port, stop, closed: () => closedPromise };
}

if (process.env['ASTROSCOPE_NODE_AUTOSTART'] !== 'disabled') {
  await startServer();
}
