import { AsyncLocalStorage } from 'node:async_hooks';
import type { DeepReadonly, Wormhole } from './types.js';

/** One [wormhole, data] pair per element — data is checked against its own wormhole's T. */
type WormholeEntries<Ts extends readonly unknown[]> = {
  [K in keyof Ts]: readonly [Wormhole<Ts[K]>, DeepReadonly<Ts[K]>];
};

// a single ALS holds an immutable map of all open wormholes; keyed on globalThis
// so the vite-runner and native module instances share one context
const als: AsyncLocalStorage<ReadonlyMap<string, unknown>> = ((globalThis as any)[
  Symbol.for('@astroscope/wormhole/als')
] ??= new AsyncLocalStorage());

/**
 * Open a wormhole for the duration of `fn` — `wormhole.get()` returns `data`
 * anywhere in the async execution rooted at `fn`.
 */
export function open<T, R>(wormhole: Wormhole<T>, data: DeepReadonly<T>, fn: () => R): R;
/**
 * Open several wormholes at once for the duration of `fn`.
 *
 * ```typescript
 * return open([
 *   [cartStore, cart],
 *   [sessionStore, session],
 * ], () => next());
 * ```
 */
export function open<Ts extends readonly unknown[], R>(entries: readonly [...WormholeEntries<Ts>], fn: () => R): R;
export function open(...args: unknown[]): unknown {
  const [entries, fn] = (Array.isArray(args[0]) ? args : [[[args[0], args[1]]], args[2]]) as [
    readonly (readonly [Wormhole<unknown>, unknown])[],
    () => unknown,
  ];

  const ctx = new Map(als.getStore());

  for (const [wormhole, data] of entries) {
    ctx.set(wormhole.key, data);

    (globalThis as any)[wormhole.key] ??= () => als.getStore()?.get(wormhole.key);
  }

  return als.run(ctx, fn);
}
