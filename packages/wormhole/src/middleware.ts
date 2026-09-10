import { type ExcludePattern, RECOMMENDED_EXCLUDES, shouldExclude } from '@astroscope/node/excludes';
import { getRouteIslands } from '@astroscope/node/islands';
import { maybeAll, maybeThen } from '@entwico/dash';
import type { MiddlewareHandler } from 'astro';
import { wormholes as registry } from 'virtual:@astroscope/wormhole/registry';
import { als } from './als.js';
import { type WormholeSource, assignWormholeNames, getWormholeSource } from './define.js';
import { registerWormholeEmitters } from './islands-emitter.js';
import { getWormholeManifest } from './manifest.js';
import { namesInClosure } from './reachable.js';
import { setRequestWormholes } from './request-store.js';
import { measureHandler } from './telemetry.js';
import type { WormholeHandler } from './types.js';

export type WormholeMiddlewareOptions = {
  /** patterns to exclude from wormhole loading; defaults to RECOMMENDED_EXCLUDES */
  exclude?: ExcludePattern[] | undefined;
};

/**
 * The wormhole middleware, injected by the integration after the project's own
 * middleware: runs the handlers of the wormholes the request's route can read —
 * server and `<script>` reads from the manifest, island reads through the route's
 * islands from `@astroscope/node`, and eager wormholes — makes the values
 * readable on the server for the duration of the request, and hands them to the
 * islands pipeline for delivery. Routes the build could not attribute (dev, no
 * manifest, astro's own routes) load everything.
 */
export function createWormholeMiddleware(options: WormholeMiddlewareOptions = {}): MiddlewareHandler {
  assignWormholeNames(registry);
  registerWormholeEmitters();

  const sources = new Map<string, WormholeSource>();

  for (const [name, wormhole] of Object.entries(registry)) {
    const source = getWormholeSource(wormhole);

    if (!source) {
      throw new Error(`wormhole "${name}" has no handler — define it with defineWormhole({ handler: (ctx) => ... })`);
    }

    sources.set(name, source);
  }

  const everything = [...sources.keys()];
  const eager = everything.filter((name) => sources.get(name)!.eager);

  // what a route opens, resolved once per route: the name, the handler and the ALS key
  type Entry = { name: string; key: string; handler: WormholeHandler<unknown> };

  const entriesByRoute = new Map<string, Entry[]>();

  // null: the route's readers are unknown, load everything
  const routeNames = (pattern: string): string[] | null => {
    const manifest = getWormholeManifest();

    if (!manifest) {
      return null;
    }

    const server = manifest.routes[pattern];
    const islands = getRouteIslands(pattern);

    if (!server || !islands || server.includes('*')) {
      return null;
    }

    const names = new Set([...eager, ...server]);

    for (const island of islands) {
      const reachable = namesInClosure(island.fullClosure, manifest);

      if (!reachable) {
        return null;
      }

      reachable.forEach((name) => names.add(name));
    }

    return [...names].filter((name) => sources.has(name));
  };

  const entriesFor = (pattern: string): Entry[] => {
    let entries = entriesByRoute.get(pattern);

    if (!entries) {
      entries = (routeNames(pattern) ?? everything).map((name) => ({
        name,
        key: registry[name]!.key,
        handler: sources.get(name)!.handler,
      }));
      entriesByRoute.set(pattern, entries);
    }

    return entries;
  };

  return (ctx, next) => {
    if (shouldExclude(ctx, options.exclude ?? RECOMMENDED_EXCLUDES)) {
      return next();
    }

    const entries = entriesFor(ctx.routePattern);

    // synchronous handlers — the common case — open the scope without a promise
    // allocation or a microtask hop; async ones settle together
    return maybeThen(
      maybeAll(entries.map((entry) => measureHandler(entry.name, () => entry.handler(ctx)))),
      (loaded) => {
        const open = new Map<string, unknown>();
        const scope = new Map<string, unknown>(als.getStore());

        for (let i = 0; i < entries.length; i++) {
          const data = loaded[i];

          if (data === undefined) {
            continue;
          }

          open.set(entries[i]!.name, data);
          scope.set(entries[i]!.key, data);
        }

        // the islands emitter and the stream-end script run while the response streams,
        // outside this ALS scope — the request object carries the values to them
        setRequestWormholes(ctx.request, { values: open, emitted: new Set() });

        return als.run(scope, () => next());
      },
    );
  };
}
