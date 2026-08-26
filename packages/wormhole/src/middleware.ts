import { type ExcludePattern, RECOMMENDED_EXCLUDES, shouldExclude } from '@astroscope/node/excludes';
import type { APIContext, MiddlewareHandler } from 'astro';
import { wormholes as registry } from 'virtual:@astroscope/wormhole/registry';
import { als } from './als.js';
import { assignWormholeNames } from './define.js';
import { registerWormholeEmitters } from './islands-emitter.js';
import { setRequestWormholes } from './request-store.js';
import type { DeepReadonly, WormholeRegistry } from './types.js';

/**
 * Per-request values keyed by registry name — omit a key (or pass undefined) to
 * leave that wormhole closed. Typed from the `WormholeRegistry` interface the
 * integration generates from `src/wormholes.ts`.
 */
export type WormholeValues = {
  [K in keyof WormholeRegistry]?: DeepReadonly<WormholeRegistry[K]> | undefined;
};

export type WormholeMiddlewareOptions = {
  /** resolve the request's wormhole values */
  values: (context: APIContext) => WormholeValues | Promise<WormholeValues>;
  /**
   * Patterns to exclude from wormhole setup. Defaults to RECOMMENDED_EXCLUDES.
   */
  exclude?: ExcludePattern[] | ((context: APIContext) => boolean) | undefined;
};

/**
 * Create the wormhole middleware: resolves the per-request values, makes them
 * readable on the server (frontmatter, endpoints, SSR islands) for the duration of
 * the request, and delivers them to the client — sliced per island through the
 * `@astroscope/node` islands pipeline, at stream end for astro `<script>` consumers,
 * and in full in dev. The registry comes from `src/wormholes.ts` via the
 * integration, so values are simply keyed by name.
 *
 * @example
 * ```typescript
 * // src/middleware.ts
 * import { createWormholeMiddleware } from '@astroscope/wormhole/server';
 *
 * export const onRequest = createWormholeMiddleware({
 *   values: (ctx) => ({
 *     session: { loggedIn: ctx.locals.user !== undefined },
 *   }),
 * });
 * ```
 */
export function createWormholeMiddleware(options: WormholeMiddlewareOptions): MiddlewareHandler {
  assignWormholeNames(registry);
  registerWormholeEmitters();

  return async (ctx, next) => {
    if (shouldExclude(ctx, options.exclude ?? RECOMMENDED_EXCLUDES)) {
      return next();
    }

    const resolved = await options.values(ctx);
    const open = new Map<string, unknown>();
    const scope = new Map<string, unknown>(als.getStore());

    for (const [name, data] of Object.entries(resolved as Record<string, unknown>)) {
      if (data === undefined) {
        continue;
      }

      const wormhole = registry[name];

      if (!wormhole) {
        throw new Error(`wormhole "${name}" is not in the src/wormholes.ts registry`);
      }

      open.set(name, data);
      scope.set(wormhole.key, data);
    }

    // the islands emitter and the stream-end script run while the response streams,
    // outside this ALS scope — the request object carries the values to them
    setRequestWormholes(ctx.request, { values: open, emitted: new Set() });

    // nothing to transform here
    return als.run(scope, () => next());
  };
}
