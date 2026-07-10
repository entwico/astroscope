import type { AstroConfig } from 'astro';
import type { Plugin } from 'vite';
import { setBootContext } from '../lifecycle/context.js';
import { type BootModule, runShutdown, runStartup } from '../lifecycle/lifecycle.js';
import type { BootContext } from '../lifecycle/types.js';
import { clearNativeMounts } from '../server/native-mount.js';
import { incrementGeneration } from './generation.js';
import { RestartScheduler } from './scheduler.js';
import { serializeError } from './serialize-error.js';
import { ssrImport } from './vite-env.js';
import { installBootGate, installGenStamp, setupBootWatch } from './watch.js';

interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface DevMachineryOptions {
  /** boot file path relative to the project root; undefined = no boot module */
  entry: string | undefined;
  /** restart the dev server when watched dependencies change */
  watch: boolean;
  /** extra files (relative to the root) whose changes restart the dev server */
  watchEntries: string[];
  /** platform seams; runs each generation before the boot module starts */
  prepare: (importModule: <T = Record<string, unknown>>(id: string) => Promise<T>) => Promise<void>;
  logger: Logger;
  getConfig: () => AstroConfig | null;
}

/**
 * Resolve the default host and port from the Astro server config.
 * Falls back to `localhost:4321` when no config is provided.
 */
function getServerDefaults(config: AstroConfig | null): { host: string; port: number } {
  return {
    host:
      typeof config?.server?.host === 'string'
        ? config.server.host
        : config?.server?.host === true
          ? '0.0.0.0'
          : 'localhost',
    port: config?.server?.port ?? 4321,
  };
}

/**
 * Build a dev-mode boot context from the running server's address,
 * falling back to Astro config defaults if the server isn't listening yet.
 */
function resolveBootContext(
  server: { httpServer?: { address(): unknown } | null | undefined },
  config: AstroConfig | null,
): BootContext {
  const addr = server.httpServer?.address();

  if (addr && typeof addr === 'object' && 'address' in addr && 'port' in addr) {
    const host =
      (addr as { address: string }).address === '::' || (addr as { address: string }).address === '0.0.0.0'
        ? 'localhost'
        : (addr as { address: string }).address;

    return { dev: true, host, port: (addr as { port: number }).port };
  }

  const { host, port } = getServerDefaults(config);

  return { dev: true, host, port };
}

/**
 * The dev-mode boot machinery: runs the platform seams and the boot lifecycle
 * per restart generation, restarts the dev server when watched dependencies
 * change, and gates requests behind a holding page during restarts.
 */
export function createDevMachinery(options: DevMachineryOptions): Plugin[] {
  const { entry, logger } = options;

  let hasStartupSucceededOnce = false;
  // run by the next configureServer before its startup so resources (ports,
  // sockets, locks) from the previous module are released first. idempotent.
  let priorShutdown: (() => Promise<void>) | undefined;
  // shared across restart-induced configureServer reruns
  const scheduler = options.watch ? new RestartScheduler(100, logger) : undefined;

  return [
    // gate plugin: enforce 'post' + returned-function so our `stack.unshift`
    // (in installBootGate / installGenStamp) lands at connect position 0,
    // ahead of astro's handler.
    {
      name: '@astroscope/node/dev-gate',
      enforce: 'post',

      configureServer(server) {
        if (!scheduler) return;

        return () => {
          // gen-stamp is unshifted last so it ends up at position 0:
          // every request gets a generation header before anything else,
          // including the gate's readiness probe.
          installBootGate(server, scheduler);
          installGenStamp(server);
        };
      },
    },

    // startup plugin: runs after all other configureServer hooks
    {
      name: '@astroscope/node/dev-startup',
      enforce: 'post',

      async configureServer(server) {
        incrementGeneration();

        // tear down the previous module first so its resources are released
        // before the new startup tries to claim them.
        if (priorShutdown) {
          await priorShutdown();
          priorShutdown = undefined;
        }

        const astroConfig = options.getConfig();
        const bootContext = resolveBootContext(server, astroConfig);
        let bootModule: BootModule | undefined;

        setBootContext(bootContext);

        try {
          await options.prepare((id) => ssrImport(server, id));

          bootModule = entry ? await ssrImport<BootModule>(server, `/${entry}`) : {};

          await runStartup(bootModule, bootContext);
        } catch (error) {
          logger.error(`Error running startup script: ${serializeError(error)}`);

          if (bootModule) {
            try {
              await runShutdown(bootModule, bootContext);
            } catch {
              // best-effort cleanup
            }
          }

          // restart failure: the gate can keep the holding
          // page up with an error message instead of dropping users onto a
          // half-broken old server.
          if (hasStartupSucceededOnce) {
            scheduler?.recordFailure(serializeError(error));

            throw error;
          }

          // initial failure: exit cleanly (mirrors the production server).
          process.exit(1);
        }

        hasStartupSucceededOnce = true;
        scheduler?.clearFailure();

        // capture so shutdown sees the same instance that started.
        const startedModule = bootModule;
        let shutdownDone = false;

        const shutdown = async (): Promise<void> => {
          if (shutdownDone) return;

          shutdownDone = true;

          try {
            await runShutdown(startedModule, resolveBootContext(server, options.getConfig()));
          } catch (error) {
            logger.error(`Error running shutdown script: ${serializeError(error)}`);
          }

          // the next generation's onStartup re-registers its mounts
          clearNativeMounts();
        };

        priorShutdown = shutdown;

        // sigint/sigterm path. also fires during restart but shutdown is idempotent.
        server.httpServer?.once('close', () => {
          void shutdown();
        });

        if (scheduler) {
          setupBootWatch(server, [...(entry ? [entry] : []), ...options.watchEntries], scheduler);
        }
      },
    },
  ];
}
