import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroConfig, AstroIntegration, IntegrationResolvedRoute } from 'astro';
import MagicString from 'magic-string';
import { perEnvironmentState } from 'vite';
import { incrementGeneration } from './generation.js';
import { type BootModule, runShutdown, runStartup } from './lifecycle.js';
import { getPrependCode } from './prepend.js';
import { RestartScheduler } from './scheduler.js';
import type { BootContext } from './types.js';
import { serializeError } from './utils.js';
import { ssrImport } from './vite-env.js';
import {
  BOOT_VIRTUAL_MODULE_ID,
  RESOLVED_BOOT_VIRTUAL_MODULE_ID,
  RESOLVED_VIRTUAL_MODULE_ID,
  VIRTUAL_MODULE_ID,
  collectWarmupSpecifiers,
  generateWarmupCode,
} from './warmup.js';
import { installBootGate, installGenStamp, setupBootWatch } from './watch.js';

export interface BootOptions {
  /**
   * Path to the boot file relative to the project root.
   * @default "src/boot.ts"
   */
  entry?: string | undefined;
  /**
   * Restart the dev server when the boot file (or any of its dependencies) changes,
   * and when Vite issues an SSR full-reload. Dev-only — has no effect in production.
   * @default true
   */
  watch?: boolean | undefined;
  /**
   * Pre-import server modules on startup to eliminate cold-start latency on
   * the first request. Has no effect in dev mode, production only.
   *
   * @default true
   */
  warmup?: boolean | undefined;
}

function resolveEntry(entry: string | undefined): string {
  if (entry) return entry;

  if (fs.existsSync('src/boot/index.ts')) return 'src/boot/index.ts';

  return 'src/boot.ts';
}

/**
 * Resolve the default host and port from the Astro server config.
 * Falls back to `localhost:4321` when no config is provided.
 */
export function getServerDefaults(config: AstroConfig | null): { host: string; port: number } {
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
function getBootContext(
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

interface BuildState {
  bootChunkRef: string | null;
  warmupChunkRef: string | null;
}

const getState = perEnvironmentState<BuildState>(() => ({ bootChunkRef: null, warmupChunkRef: null }));

/**
 * Astro integration for application lifecycle hooks.
 *
 * Runs `onStartup` and `onShutdown` functions exported from your boot file
 * during server startup and shutdown.
 */
export default function boot(options: BootOptions = {}): AstroIntegration {
  const entry = resolveEntry(options.entry);
  const watch = options.watch ?? true;
  const warmupEnabled = options.warmup ?? true;

  let astroConfig: AstroConfig | null = null;
  let warmupCode: string | null = null;
  let resolvedRoutes: readonly IntegrationResolvedRoute[] = [];
  let hasStartupSucceededOnce = false;
  // run by the next configureServer before its startup so resources (ports,
  // sockets, locks) from the previous module are released first. idempotent.
  let priorShutdown: (() => Promise<void>) | undefined;
  // shared across restart-induced configureServer reruns
  let scheduler: RestartScheduler | undefined;

  return {
    name: '@astroscope/boot',
    hooks: {
      'astro:routes:resolved': ({ routes }) => {
        resolvedRoutes = routes;
      },
      'astro:config:setup': ({ command, updateConfig, logger, config, addMiddleware }) => {
        astroConfig = config;

        if (command === 'dev' && watch) {
          scheduler = new RestartScheduler(100, logger);

          // catches errors thrown by stale (post-shutdown) requests so
          // they don't pollute the logs during dev-server restarts.
          addMiddleware({ entrypoint: '@astroscope/boot/middleware', order: 'pre' });
        }

        updateConfig({
          vite: {
            plugins: [
              // build plugin: handles entry.mjs injection and warmup virtual module
              {
                name: '@astroscope/boot',

                resolveId(id) {
                  if (id === VIRTUAL_MODULE_ID) return RESOLVED_VIRTUAL_MODULE_ID;
                  if (id === BOOT_VIRTUAL_MODULE_ID) return RESOLVED_BOOT_VIRTUAL_MODULE_ID;
                },

                load(id) {
                  if (id === RESOLVED_VIRTUAL_MODULE_ID) return warmupCode ?? '';

                  if (id === RESOLVED_BOOT_VIRTUAL_MODULE_ID) {
                    const projectRoot = astroConfig?.root ? fileURLToPath(astroConfig.root) : process.cwd();
                    const abs = path.resolve(projectRoot, entry);

                    // re-export to avoid an absolute path manifest leaks
                    return `export * from ${JSON.stringify(abs)};`;
                  }
                },

                async buildStart() {
                  if (this.environment.name !== 'ssr') return;

                  const state = getState(this);
                  const projectRoot = astroConfig?.root ? fileURLToPath(astroConfig.root) : process.cwd();

                  try {
                    state.bootChunkRef = this.emitFile({ type: 'chunk', id: BOOT_VIRTUAL_MODULE_ID, name: 'boot' });
                  } catch {
                    // not available in serve mode
                  }

                  if (!warmupEnabled) {
                    warmupCode = '';

                    return;
                  }

                  const specifiers = collectWarmupSpecifiers(resolvedRoutes, projectRoot);

                  if (!specifiers.length) {
                    warmupCode = '';

                    return;
                  }

                  warmupCode = generateWarmupCode(specifiers);

                  try {
                    state.warmupChunkRef = this.emitFile({ type: 'chunk', id: VIRTUAL_MODULE_ID, name: 'warmup' });
                  } catch {
                    // not available in serve mode
                  }

                  logger.info(`warmup: ${specifiers.length} module${specifiers.length === 1 ? '' : 's'}`);
                },

                generateBundle(_, bundle) {
                  const state = getState(this);

                  if (!state.bootChunkRef) return;

                  const bootChunkName = this.getFileName(state.bootChunkRef);

                  if (!bootChunkName) {
                    logger.warn('boot chunk not found');

                    return;
                  }

                  // find entry.mjs chunk
                  const entryChunk = bundle['entry.mjs'];

                  if (!entryChunk || entryChunk.type !== 'chunk') {
                    logger.warn('entry.mjs not found - boot injection skipped');

                    return;
                  }

                  const { host, port } = getServerDefaults(astroConfig);

                  const prependCode = getPrependCode();
                  const prefix = prependCode.length ? `${prependCode.join('\n')}\n` : '';

                  let warmupStart = '';
                  let warmupEnd = '';

                  if (state.warmupChunkRef) {
                    const warmupChunkName = this.getFileName(state.warmupChunkRef);

                    if (warmupChunkName) {
                      warmupStart = `const __astroscope_warmup = import('./${warmupChunkName}');\n`;
                      warmupEnd = `await __astroscope_warmup;\n`;
                    }
                  }

                  const setupConfig = JSON.stringify({ host, port });

                  const injection =
                    `${prefix}${warmupStart}` +
                    `import * as __astroscope_boot from './${bootChunkName}';\n` +
                    `import { setup as __astroscope_bootSetup } from '@astroscope/boot/setup';\n` +
                    `await __astroscope_bootSetup(__astroscope_boot, ${setupConfig});\n${warmupEnd}`;

                  // inject at start of entry.mjs preserving source maps
                  const s = new MagicString(entryChunk.code);

                  s.prepend(injection);

                  entryChunk.code = s.toString();

                  if (entryChunk.map) {
                    entryChunk.map = s.generateMap({ hires: true }) as typeof entryChunk.map;
                  }

                  logger.info(`injected ${bootChunkName} into entry.mjs`);
                },
              },

              // gate plugin: enforce 'post' + returned-function so our `stack.unshift`
              // (in installBootGate / installGenStamp) lands at connect position 0,
              // ahead of astro's handler.
              {
                name: '@astroscope/boot/gate',
                enforce: 'post',

                configureServer(server) {
                  if (!scheduler) return;

                  const s = scheduler;

                  return () => {
                    // gen-stamp is unshifted last so it ends up at position 0:
                    // every request gets a generation header before anything else,
                    // including the gate's readiness probe.
                    installBootGate(server, s);
                    installGenStamp(server);
                  };
                },
              },

              // startup plugin: runs after all other configureServer hooks
              {
                name: '@astroscope/boot/startup',
                enforce: 'post',

                async configureServer(server) {
                  if (command !== 'dev') return; // skip in build / sync modes (Astro uses 'sync' for 'astro check' command)

                  incrementGeneration();

                  // tear down the previous module first so its resources are released
                  // before the new startup tries to claim them.
                  if (priorShutdown) {
                    await priorShutdown();
                    priorShutdown = undefined;
                  }

                  const bootContext = getBootContext(server, astroConfig);
                  let bootModule: BootModule | undefined;

                  try {
                    bootModule = await ssrImport<BootModule>(server, `/${entry}`);

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

                    // initial failure: exit cleanly (mirrors production setup.ts).
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
                      await runShutdown(startedModule, getBootContext(server, astroConfig));
                    } catch (error) {
                      logger.error(`Error running shutdown script: ${serializeError(error)}`);
                    }
                  };

                  priorShutdown = shutdown;

                  // sigint/sigterm path. also fires during restart but shutdown is idempotent.
                  server.httpServer?.once('close', () => {
                    void shutdown();
                  });

                  if (scheduler) {
                    setupBootWatch(server, entry, scheduler);
                  }
                },
              },
            ],
          },
        });
      },
    },
  };
}
