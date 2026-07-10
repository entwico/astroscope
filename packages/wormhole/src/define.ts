import type { DeepReadonly, Wormhole } from './types.js';

/**
 * Define a wormhole that transfers state from server middleware to client components.
 *
 * **Security:** wormhole data is serialized into the HTML and sent to the browser.
 * Never store secrets (tokens, API keys, credentials) in a wormhole.
 */
export function defineWormhole<T>(name: string): Wormhole<T> {
  const listeners = new Set<(data: DeepReadonly<T>) => void>();
  const key = `__wormhole_${name}__`;
  let store: DeepReadonly<T> | undefined;

  return {
    name,
    key,

    get(): DeepReadonly<T> {
      if (store !== undefined) return store;

      const getter = (globalThis as any)[key];
      const value = typeof getter === 'function' ? (getter() as DeepReadonly<T> | undefined) : undefined;

      if (value === undefined) {
        throw new Error(`wormhole "${name}" is not initialized`);
      }

      return value;
    },

    set(data: DeepReadonly<T>): void {
      if (typeof (globalThis as any).window === 'undefined') {
        throw new Error(
          `wormhole "${name}" set() cannot be called on the server as it is not request-scoped; use open(wormhole, data, fn) from "@astroscope/wormhole/server" instead`,
        );
      }

      store = data;

      for (const fn of listeners) fn(data);
    },

    subscribe(fn: (data: DeepReadonly<T>) => void): () => void {
      listeners.add(fn);

      return () => {
        listeners.delete(fn);
      };
    },
  };
}
