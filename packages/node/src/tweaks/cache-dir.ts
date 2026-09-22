import path from 'node:path';

const DEFAULT_CACHE_DIR = 'node_modules/.vite';

/**
 * `astro sync` (also run by `astro check`) and `astro build` each spin up a
 * temporary vite server whose dependency optimizer writes `deps/` into the
 * project's vite cache dir — the same directory a running `astro dev` serves
 * its pre-bundled deps from. their config hash never matches the dev
 * server's, so every run swaps the directory out from under the live server;
 * the dev server keeps serving its stale urls from the new, differently
 * chunked files and every island hydrates against two react copies.
 *
 * Giving each non-dev command a cache dir of its own keeps the dev cache
 * untouched, and keeps `check` and `build` from racing each other on the
 * final directory rename when they run concurrently in a shared workspace.
 */
export function resolveCommandCacheDir(
  root: string,
  command: string,
  configured: string | undefined,
): string | undefined {
  if (command === 'dev') return undefined;

  return path.resolve(root, configured ?? DEFAULT_CACHE_DIR, command);
}
