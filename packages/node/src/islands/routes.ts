import { type ChunkGraph, createChunkGraph } from './graph.js';
import type { IslandsManifest } from './types.js';

/**
 * Route → islands at runtime, for packages that must know before rendering what a
 * page will hydrate (per-route data loading). Installed by the islands middleware
 * entry from the manifest; keyed on `globalThis` via `Symbol.for` so the
 * vite-runner and native module instances share it. Closures are dist-relative
 * chunk file names — there is no island tag to observe a public prefix on yet.
 */
export type RouteIsland = {
  /** the island's entry chunk, relative to the client dist (e.g. `_astro/Cart.abc123.js`) */
  fileName: string;
  /** the entry plus its transitive static imports */
  staticClosure: string[];
  /** the entry plus its transitive static and dynamic imports */
  fullClosure: string[];
};

type Resolver = (pattern: string) => RouteIsland[] | null;

const STORE = Symbol.for('@astroscope/node.routeIslands');

type Scope = { [STORE]?: Resolver };

export function installRouteIslands(manifest: IslandsManifest | null): void {
  const routes = manifest?.routes;

  if (!routes) {
    (globalThis as Scope)[STORE] = () => null;

    return;
  }

  let graph: ChunkGraph | undefined;
  const cache = new Map<string, RouteIsland[]>();

  (globalThis as Scope)[STORE] = (pattern) => {
    const cached = cache.get(pattern);

    if (cached) {
      return cached;
    }

    const fileNames = routes[pattern];

    if (!fileNames) {
      return null;
    }

    graph ??= createChunkGraph(manifest);

    const islands = fileNames.map((fileName) => ({
      fileName,
      staticClosure: [fileName, ...graph!.staticClosure(fileName)],
      fullClosure: [fileName, ...graph!.fullClosure(fileName)],
    }));

    cache.set(pattern, islands);

    return islands;
  };
}

/**
 * The islands a route's page hydrates, from the build-time attribution — `null`
 * when unknown: in dev, without a manifest, or for a route whose page the server
 * build did not see (astro's own injected routes, server islands). Callers
 * treat `null` as "anything", never as "nothing".
 */
export function getRouteIslands(pattern: string): RouteIsland[] | null {
  return (globalThis as Scope)[STORE]?.(pattern) ?? null;
}
