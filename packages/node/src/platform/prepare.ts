import { type LoggerOptionsFactory, constructRootLogger } from '../observability/log/construct.js';
import { type TelemetrySdkOptions, startTelemetry } from '../observability/telemetry/sdk.js';
import { loadEnvFiles } from './env.js';

const INSTRUMENTATION_KEY = Symbol.for('@astroscope/node/instrumentation');

export interface InstrumentationContext {
  dev: boolean;
}

interface InstrumentationSeam {
  register?: ((ctx: InstrumentationContext) => void | Promise<void>) | undefined;
}

interface LogSeam {
  default?: LoggerOptionsFactory | undefined;
}

export interface PlatformSeams {
  /** `src/config.ts` — validation runs at import; a throw fails the startup */
  config?: (() => Promise<unknown>) | undefined;
  /** `src/instrumentation.ts` — extra instrumentation, once per process */
  instrumentation?: (() => Promise<InstrumentationSeam>) | undefined;
  /** `src/log.ts` — pino logger options (or a factory), never an instance */
  log?: (() => Promise<LogSeam>) | undefined;
}

export interface PreparePlatformOptions {
  dev: boolean;
  telemetry: TelemetrySdkOptions | false;
  seams: PlatformSeams;
}

/**
 * The platform sequence in front of the boot lifecycle:
 * env → config → instrumentation (platform SDK + `register`, once per
 * process) → logger construction (after instrumentation, so entries carry
 * trace correlation). Prod runs it once in `startServer()`; dev re-runs it
 * per generation with the once-per-process parts guarded.
 */
export async function preparePlatform(options: PreparePlatformOptions): Promise<void> {
  loadEnvFiles();

  await options.seams.config?.();

  const g = globalThis as Record<symbol, unknown>;

  if (!g[INSTRUMENTATION_KEY]) {
    g[INSTRUMENTATION_KEY] = true;

    if (options.telemetry) {
      await startTelemetry(options.telemetry);
    }

    const instrumentation = await options.seams.instrumentation?.();

    await instrumentation?.register?.({ dev: options.dev });
  }

  const logSeam = await options.seams.log?.();

  await constructRootLogger(logSeam?.default, { dev: options.dev });
}
