import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroConfig, AstroIntegration } from 'astro';
import { createDevMachinery } from '../dev-mode/machinery.js';
import { type ExcludePattern, RECOMMENDED_EXCLUDES } from '../excludes/excludes.js';
import { serializeExcludePatterns } from '../excludes/serialize.js';
import { createRequestInstrumentation } from '../observability/instrument.js';
import { preparePlatform } from '../platform/prepare.js';
import { dispatchNativeMount } from '../server/native-mount.js';
import { ssrSourcemapPlugin } from '../tweaks/sourcemap.js';
import { stripSsrEffectsPlugin } from '../tweaks/strip-effects.js';
import type { NodeOptions, RuntimeOptions } from '../types.js';

export const CONFIG_VIRTUAL_MODULE_ID = 'virtual:@astroscope/node/config';
export const BOOT_VIRTUAL_MODULE_ID = 'virtual:@astroscope/node/boot';
export const CSRF_VIRTUAL_MODULE_ID = 'virtual:@astroscope/node/csrf';
export const CONFIG_ENTRY_VIRTUAL_MODULE_ID = 'virtual:@astroscope/node/config-entry';
export const INSTRUMENTATION_ENTRY_VIRTUAL_MODULE_ID = 'virtual:@astroscope/node/instrumentation-entry';
export const LOG_ENTRY_VIRTUAL_MODULE_ID = 'virtual:@astroscope/node/log-entry';

const RESOLVED_CONFIG_VIRTUAL_MODULE_ID = `\0${CONFIG_VIRTUAL_MODULE_ID}`;
const RESOLVED_BOOT_VIRTUAL_MODULE_ID = `\0${BOOT_VIRTUAL_MODULE_ID}`;
const RESOLVED_CSRF_VIRTUAL_MODULE_ID = `\0${CSRF_VIRTUAL_MODULE_ID}`;
const RESOLVED_CONFIG_ENTRY_VIRTUAL_MODULE_ID = `\0${CONFIG_ENTRY_VIRTUAL_MODULE_ID}`;
const RESOLVED_INSTRUMENTATION_ENTRY_VIRTUAL_MODULE_ID = `\0${INSTRUMENTATION_ENTRY_VIRTUAL_MODULE_ID}`;
const RESOLVED_LOG_ENTRY_VIRTUAL_MODULE_ID = `\0${LOG_ENTRY_VIRTUAL_MODULE_ID}`;

const SERVER_ENVIRONMENTS = ['ssr', 'prerender', 'astro'];
const DEFAULT_REQUEST_EXCLUDES: ExcludePattern[] = [...RECOMMENDED_EXCLUDES];

function resolveHost(host: string | boolean | undefined): string {
  if (typeof host === 'string') return host;

  return host === true ? '0.0.0.0' : 'localhost';
}

function resolveBootEntry(root: string, entry: string | undefined): string | undefined {
  if (entry) {
    const abs = path.resolve(root, entry);

    if (!fs.existsSync(abs)) {
      throw new Error(`[@astroscope/node] boot entry not found: ${entry}`);
    }

    return abs;
  }

  for (const candidate of ['src/boot/index.ts', 'src/boot.ts']) {
    const abs = path.resolve(root, candidate);

    if (fs.existsSync(abs)) return abs;
  }

  return undefined;
}

function resolveSeam(root: string, candidate: string): string | undefined {
  const abs = path.resolve(root, candidate);

  return fs.existsSync(abs) ? abs : undefined;
}

/**
 * Node adapter for Astro with a first-class server entrypoint: the boot
 * lifecycle, module warmup, health probes, request logging and telemetry run
 * as plain code around `server.listen()` instead of being injected into the
 * build output.
 */
export default function node(options: NodeOptions = {}): AstroIntegration {
  const bootOptions = options.boot ?? {};
  const healthOptions = options.health ?? {};
  const csrfOptions = options.csrf ?? {};
  const loggingOptions = options.logging ?? {};
  const telemetryOptions = options.telemetry ?? {};

  const loggingExclude = loggingOptions ? (loggingOptions.exclude ?? DEFAULT_REQUEST_EXCLUDES) : [];
  const telemetryExclude = telemetryOptions ? (telemetryOptions.exclude ?? DEFAULT_REQUEST_EXCLUDES) : [];

  let astroConfig: AstroConfig | null = null;
  let bootEntry: string | undefined;
  let configSeam: string | undefined;
  let instrumentationSeam: string | undefined;
  let logSeam: string | undefined;
  let isDev = false;

  return {
    name: '@astroscope/node',
    hooks: {
      'astro:config:setup': ({ command, config, updateConfig, addMiddleware, logger }) => {
        isDev = command === 'dev';

        // route enrichment first so csrf-rejected requests still carry a route
        if (loggingOptions || telemetryOptions) {
          addMiddleware({ order: 'pre', entrypoint: '@astroscope/node/route-middleware' });
        }

        if (csrfOptions) {
          addMiddleware({ order: 'pre', entrypoint: '@astroscope/node/csrf-middleware' });
        }

        const root = fileURLToPath(config.root);
        const watch = bootOptions === false ? false : (bootOptions.watch ?? true);

        bootEntry = bootOptions === false ? undefined : resolveBootEntry(root, bootOptions.entry);
        configSeam = resolveSeam(root, 'src/config.ts');
        instrumentationSeam = resolveSeam(root, 'src/instrumentation.ts');
        logSeam = resolveSeam(root, 'src/log.ts');

        const relativeSeam = (abs: string | undefined) =>
          abs ? path.relative(root, abs).split(path.sep).join('/') : undefined;

        const devMachinery =
          command === 'dev' && bootOptions !== false
            ? createDevMachinery({
                entry: bootEntry ? path.relative(root, bootEntry) : undefined,
                watch,
                // instrumentation runs once per process — watching it would
                // restart generations that can't re-apply it
                watchEntries: [relativeSeam(configSeam), relativeSeam(logSeam)].filter(
                  (entry): entry is string => !!entry,
                ),
                prepare: (importModule) =>
                  preparePlatform({
                    dev: true,
                    telemetry:
                      telemetryOptions && telemetryOptions.dev
                        ? { prometheus: telemetryOptions.prometheus ?? {} }
                        : false,
                    seams: {
                      ...(configSeam && { config: () => importModule(`/${relativeSeam(configSeam)}`) }),
                      ...(instrumentationSeam && {
                        instrumentation: () => importModule(`/${relativeSeam(instrumentationSeam)}`),
                      }),
                      ...(logSeam && { log: () => importModule(`/${relativeSeam(logSeam)}`) }),
                    },
                  }),
                logger,
                getConfig: () => astroConfig,
              })
            : [];

        if (command === 'dev' && bootOptions !== false && watch) {
          // catches errors thrown by stale (post-shutdown) requests so
          // they don't pollute the logs during dev-server restarts.
          addMiddleware({ entrypoint: '@astroscope/node/dev-middleware', order: 'pre' });
        }

        updateConfig({
          build: { redirects: false },
          // opinionated defaults: no trailing slashes, behind LB
          ...(config.trailingSlash === 'ignore' && { trailingSlash: 'never' as const }),
          security: {
            // assumed to run behind LB
            ...(!config.security.allowedDomains?.length && { allowedDomains: [{}] }),
            // the embedded csrf middleware replaces the built-in origin check
            ...(csrfOptions && { checkOrigin: false }),
          },
          image: {
            endpoint: {
              route: config.image.endpoint.route ?? '_image',
              entrypoint:
                config.image.endpoint.entrypoint ??
                (command === 'dev' ? 'astro/assets/endpoint/dev' : 'astro/assets/endpoint/node'),
            },
          },
          vite: {
            plugins: [
              ...devMachinery,
              ssrSourcemapPlugin(),
              stripSsrEffectsPlugin(),
              {
                name: '@astroscope/node',

                configEnvironment(environmentName: string) {
                  if (SERVER_ENVIRONMENTS.includes(environmentName)) {
                    return { resolve: { noExternal: ['@astroscope/node'] } };
                  }
                },

                resolveId(id: string) {
                  if (id === CONFIG_VIRTUAL_MODULE_ID) return RESOLVED_CONFIG_VIRTUAL_MODULE_ID;
                  if (id === BOOT_VIRTUAL_MODULE_ID) return RESOLVED_BOOT_VIRTUAL_MODULE_ID;
                  if (id === CSRF_VIRTUAL_MODULE_ID) return RESOLVED_CSRF_VIRTUAL_MODULE_ID;
                  if (id === CONFIG_ENTRY_VIRTUAL_MODULE_ID) return RESOLVED_CONFIG_ENTRY_VIRTUAL_MODULE_ID;
                  if (id === INSTRUMENTATION_ENTRY_VIRTUAL_MODULE_ID) {
                    return RESOLVED_INSTRUMENTATION_ENTRY_VIRTUAL_MODULE_ID;
                  }
                  if (id === LOG_ENTRY_VIRTUAL_MODULE_ID) return RESOLVED_LOG_ENTRY_VIRTUAL_MODULE_ID;
                },

                load(id: string) {
                  if (id === RESOLVED_CONFIG_VIRTUAL_MODULE_ID) {
                    if (!astroConfig) throw new Error('[@astroscope/node] astro config not resolved yet');

                    const runtimeOptions: Omit<RuntimeOptions, 'logging' | 'telemetry'> = {
                      host: resolveHost(astroConfig.server.host),
                      port: astroConfig.server.port ?? 4321,
                      client: astroConfig.build.client.toString(),
                      server: astroConfig.build.server.toString(),
                      bodySizeLimit: options.bodySizeLimit ?? 1024 * 1024 * 1024,
                      shutdownTimeout: options.shutdownTimeout ?? 10_000,
                      health: healthOptions
                        ? {
                            ...(healthOptions.host !== undefined && { host: healthOptions.host }),
                            ...(healthOptions.port !== undefined && { port: healthOptions.port }),
                            ...(healthOptions.paths && { paths: healthOptions.paths }),
                          }
                        : false,
                    };

                    // exclude patterns may contain RegExp — serialized as code, not JSON
                    const logging = loggingOptions
                      ? `{ exclude: ${serializeExcludePatterns(loggingExclude)}, extended: ${JSON.stringify(
                          loggingOptions.extended ?? false,
                        )} }`
                      : 'false';
                    const telemetry = telemetryOptions
                      ? `{ exclude: ${serializeExcludePatterns(telemetryExclude)}, prometheus: ${JSON.stringify(
                          telemetryOptions.prometheus ?? {},
                        )} }`
                      : 'false';

                    return `export const options = { ...${JSON.stringify(runtimeOptions)}, logging: ${logging}, telemetry: ${telemetry} };`;
                  }

                  if (id === RESOLVED_BOOT_VIRTUAL_MODULE_ID) {
                    // re-export to avoid absolute path manifest leaks
                    return bootEntry ? `export * from ${JSON.stringify(bootEntry)};` : 'export {};';
                  }

                  if (id === RESOLVED_CSRF_VIRTUAL_MODULE_ID) {
                    return `export const excludePatterns = ${serializeExcludePatterns(csrfOptions ? (csrfOptions.exclude ?? []) : [])};`;
                  }

                  if (id === RESOLVED_CONFIG_ENTRY_VIRTUAL_MODULE_ID) {
                    // side-effect import: @entwico/zod-conf validation runs at module load
                    return configSeam ? `import ${JSON.stringify(configSeam)};\nexport {};` : 'export {};';
                  }

                  if (id === RESOLVED_INSTRUMENTATION_ENTRY_VIRTUAL_MODULE_ID) {
                    return instrumentationSeam ? `export * from ${JSON.stringify(instrumentationSeam)};` : 'export {};';
                  }

                  if (id === RESOLVED_LOG_ENTRY_VIRTUAL_MODULE_ID) {
                    return logSeam
                      ? `export { default } from ${JSON.stringify(logSeam)};`
                      : 'export default undefined;';
                  }
                },
              },
            ],
          },
        });
      },
      'astro:server:setup': ({ server }) => {
        if (!isDev) return;

        const devLogging = loggingOptions && loggingOptions.dev;
        const devTelemetry = telemetryOptions && telemetryOptions.dev;

        const instrument =
          devLogging || devTelemetry
            ? createRequestInstrumentation({
                logging: devLogging ? { exclude: loggingExclude, extended: loggingOptions.extended ?? false } : false,
                telemetry: devTelemetry ? { exclude: telemetryExclude } : false,
              })
            : undefined;

        server.middlewares.use((req, res, next) => {
          const inner = (): void => {
            if (!dispatchNativeMount(req, res)) next();
          };

          if (instrument) {
            instrument(req, res, inner);
          } else {
            inner();
          }
        });
      },
      'astro:config:done': ({ config, setAdapter }) => {
        astroConfig = config;

        setAdapter({
          name: '@astroscope/node',
          entrypointResolution: 'auto',
          serverEntrypoint: '@astroscope/node/server',
          previewEntrypoint: '@astroscope/node/preview',
          adapterFeatures: {
            buildOutput: 'server',
            middlewareMode: 'classic',
          },
          supportedAstroFeatures: {
            hybridOutput: 'stable',
            staticOutput: 'stable',
            serverOutput: 'stable',
            sharpImageService: 'stable',
            i18nDomains: 'experimental',
            envGetSecret: 'stable',
          },
        });
      },
      'astro:build:done': async ({ logger }) => {
        if (!astroConfig) return;

        const { compressClientDir } = await import('../compress/compress.js');

        await compressClientDir(fileURLToPath(astroConfig.build.client), logger);
      },
    },
  };
}
