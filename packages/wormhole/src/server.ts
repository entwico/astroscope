import { AsyncLocalStorage } from 'node:async_hooks';
import type { DeepReadonly, Wormhole } from './types.js';

const stores = new Map<string, AsyncLocalStorage<unknown>>();

export function open<T, R>(wh: Wormhole<T>, data: DeepReadonly<T>, fn: () => R): R {
  let als = stores.get(wh.key) as AsyncLocalStorage<DeepReadonly<T>> | undefined;

  if (!als) {
    als = new AsyncLocalStorage<DeepReadonly<T>>();
    stores.set(wh.key, als as AsyncLocalStorage<unknown>);
  }

  (globalThis as any)[wh.key] = () => als!.getStore();

  return als.run(data, fn);
}
