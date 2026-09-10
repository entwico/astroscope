import path from 'node:path';
import type { IntegrationResolvedRoute } from 'astro';
import type { Rolldown } from 'vite';

/**
 * Build-time attribution of islands to routes, from the server build's module
 * graph: every module reachable from a page component belongs to that page's
 * routes, and the hydrated / `client:only` components astro's compiler recorded
 * on such a module are the route's islands. Same walk astro does for its own
 * client entries, kept independent of its internals — page modules are matched by
 * the route entrypoints astro resolved, not by its virtual page wrappers.
 */

type AstroComponentMeta = { exportName: string; specifier: string; resolvedPath?: string | undefined };

type AstroModuleMeta = {
  hydratedComponents?: AstroComponentMeta[] | undefined;
  clientOnlyComponents?: AstroComponentMeta[] | undefined;
};

export type ModuleGraph = {
  getModuleIds(): IterableIterator<string>;
  getModuleInfo(id: string): Rolldown.ModuleInfo | null;
  resolve(source: string, importer: string): Promise<{ id: string } | null>;
};

export type RouteIslandsResult = {
  /** route pattern → island component ids (absolute module ids, query stripped); pages missing from the graph are absent */
  routes: Map<string, Set<string>>;
  /** module id → route patterns whose page reaches it, the whole server module graph */
  patternsByModule: Map<string, Set<string>>;
};

// astro's actions route module reaches the project's actions through the ssr
// manifest, not through an import — the virtual entrypoint wrapping them is the
// module the walk has to start from
const ACTIONS_ROUTE_PATTERN = '/_actions/[...path]';
const ACTIONS_ENTRYPOINT_MODULE_ID = '\0virtual:astro:actions/entrypoint';

// astro's application manifest imports every page and the middleware
const WALK_BOUNDARY_MODULE_IDS = new Set(['\0virtual:astro:manifest']);

/**
 * Route modules (absolute ids) → the route patterns they serve, for the walk:
 * pages and endpoints (endpoints have no islands, but consumers still want them
 * as known routes), one component possibly backing several routes.
 */
export function routeEntrypoints(root: string, routes: readonly IntegrationResolvedRoute[]): Map<string, string[]> {
  const entrypoints = new Map<string, string[]>();

  for (const route of routes) {
    if (route.type !== 'page' && route.type !== 'endpoint') continue;

    const id =
      route.pattern === ACTIONS_ROUTE_PATTERN ? ACTIONS_ENTRYPOINT_MODULE_ID : path.resolve(root, route.entrypoint);

    entrypoints.set(id, [...(entrypoints.get(id) ?? []), route.pattern]);
  }

  return entrypoints;
}

/** module ids can carry vite queries (`?astro&type=...`) — the file path is the identity */
export function stripQuery(id: string): string {
  const at = id.indexOf('?');

  return at === -1 ? id : id.slice(0, at);
}

/**
 * `pages` maps a page component's absolute path to the patterns of the routes it
 * serves (one component can back several routes).
 */
export async function collectRouteIslands(
  graph: ModuleGraph,
  pages: Map<string, string[]>,
): Promise<RouteIslandsResult> {
  const patternsByModule = new Map<string, Set<string>>();
  const routes = new Map<string, Set<string>>();
  const islandsByModule = new Map<string, string[]>();

  for (const id of graph.getModuleIds()) {
    const meta = graph.getModuleInfo(id)?.meta?.['astro'] as AstroModuleMeta | undefined;

    if (!meta) {
      continue;
    }

    const islands: string[] = [];

    for (const component of [...(meta.hydratedComponents ?? []), ...(meta.clientOnlyComponents ?? [])]) {
      if (component.resolvedPath) {
        islands.push(stripQuery(decodeURI(component.resolvedPath)));
      } else {
        // `client:only` components are dropped from the server graph — resolve the specifier ourselves
        const resolved = await graph.resolve(component.specifier, id);

        if (resolved) {
          islands.push(stripQuery(resolved.id));
        }
      }
    }

    if (islands.length > 0) {
      islandsByModule.set(id, islands);
    }
  }

  for (const [page, patterns] of pages) {
    const info = graph.getModuleInfo(page);

    if (!info) {
      continue;
    }

    const islands = new Set<string>();
    const visited = new Set<string>();
    const stack = [page];

    while (stack.length > 0) {
      const id = stack.pop()!;

      if (visited.has(id) || WALK_BOUNDARY_MODULE_IDS.has(id)) {
        continue;
      }

      visited.add(id);

      let owners = patternsByModule.get(id);

      if (!owners) {
        owners = new Set();
        patternsByModule.set(id, owners);
      }

      patterns.forEach((pattern) => owners.add(pattern));
      islandsByModule.get(id)?.forEach((island) => islands.add(island));

      const moduleInfo = graph.getModuleInfo(id);

      if (moduleInfo) {
        stack.push(...moduleInfo.importedIds, ...moduleInfo.dynamicallyImportedIds);
      }
    }

    for (const pattern of patterns) {
      routes.set(pattern, islands);
    }
  }

  return { routes, patternsByModule };
}
