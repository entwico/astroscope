import { AsyncLocalStorage } from 'node:async_hooks';

// a single ALS holds an immutable map of all open wormholes (keyed by wormhole key);
// keyed on globalThis so the vite-runner and native module instances share one context
export const als: AsyncLocalStorage<ReadonlyMap<string, unknown>> = ((globalThis as any)[
  Symbol.for('@astroscope/wormhole/als')
] ??= new AsyncLocalStorage());
