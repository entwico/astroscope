import { als } from './als.js';
import type { DeepReadonly, Wormhole } from './types.js';

export { createWormholeMiddleware } from './middleware.js';
export type { WormholeMiddlewareOptions, WormholeValues } from './middleware.js';

/** One [wormhole, data] pair per element — data is checked against its own wormhole's T. */
type WormholeEntries<Ts extends readonly unknown[]> = {
  [K in keyof Ts]: readonly [Wormhole<Ts[K]>, DeepReadonly<Ts[K]>];
};

/**
 * Provide wormhole values to server code that runs outside the request pipeline —
 * tests above all, or out-of-request rendering (emails, jobs). `wormhole.get()`
 * returns `data` anywhere in the async execution rooted at `fn`. Inside the app,
 * the middleware is the way; values opened here are never delivered to the client.
 */
export function openWormholes<T, R>(wormhole: Wormhole<T>, data: DeepReadonly<T>, fn: () => R): R;
/**
 * Open several wormholes at once for the duration of `fn` — pass an array of
 * `[wormhole, data]` pairs, each checked against its own wormhole.
 */
export function openWormholes<Ts extends readonly unknown[], R>(
  entries: readonly [...WormholeEntries<Ts>],
  fn: () => R,
): R;
export function openWormholes(...args: unknown[]): unknown {
  const [entries, fn] = (Array.isArray(args[0]) ? args : [[[args[0], args[1]]], args[2]]) as [
    readonly (readonly [Wormhole<unknown>, unknown])[],
    () => unknown,
  ];

  const ctx = new Map(als.getStore());

  for (const [wormhole, data] of entries) {
    ctx.set(wormhole.key, data);
  }

  return als.run(ctx, fn);
}
