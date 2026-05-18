import type { DevEnvironment, ViteDevServer } from 'vite';

type RunnableEnv = DevEnvironment & { runner: { import: (id: string) => Promise<unknown> } };

/**
 * duck-typed runnable-env check. avoids `isRunnableDevEnvironment` which relies on
 * `instanceof RunnableDevEnvironment` — that breaks when the consumer and vite host
 * resolve to different vite installs (e.g. linked packages outside the workspace).
 */
function isRunnable(env: DevEnvironment | undefined): env is RunnableEnv {
  return (
    !!env &&
    typeof (env as { runner?: unknown }).runner === 'object' &&
    typeof (env as RunnableEnv).runner.import === 'function'
  );
}

/**
 * resolve a runnable dev environment — prefers `ssr`, falls back to `astro`.
 * astro 6 exposes a separate `astro` environment when `ssr` isn't runnable
 * (see astro/core/constants.ts ASTRO_VITE_ENVIRONMENT_NAMES).
 */
function getRunnableEnv(server: ViteDevServer): RunnableEnv {
  const ssr = server.environments['ssr'];

  if (isRunnable(ssr)) return ssr;

  const astro = server.environments['astro'];

  if (isRunnable(astro)) return astro;

  const names = Object.keys(server.environments);

  throw new Error(`no runnable dev environment found — available: ${names.join(', ')}`);
}

/**
 * load a module via the Vite Environment API.
 */
export async function ssrImport<T = Record<string, unknown>>(server: ViteDevServer, moduleId: string): Promise<T> {
  return getRunnableEnv(server).runner.import(moduleId) as Promise<T>;
}

/**
 * return the env whose `hot` channel should receive astro-targeted events.
 * astro listens on the env that backs its middleware runner.
 */
export function getAstroHotEnv(server: ViteDevServer): DevEnvironment | undefined {
  const ssr = server.environments['ssr'];

  if (isRunnable(ssr)) return ssr;

  const astro = server.environments['astro'];

  if (isRunnable(astro)) return astro;

  return undefined;
}
