import { als } from './als.js';
import { wormholeKey } from './key.js';
import type { DeepReadonly, Wormhole } from './types.js';

// name assignment must survive dual module instances (vite runner + native), so the
// assigner rides the wormhole object itself under a Symbol.for key
const ASSIGN = Symbol.for('@astroscope/wormhole.assign');

/**
 * Define a wormhole for the `src/wormholes.ts` registry. The wormhole's name is the
 * registry key — it is assigned when the registry is passed to
 * `createWormholeMiddleware()` (or `assignWormholeNames()`).
 *
 * **Security:** wormhole data is serialized into the HTML and sent to the browser.
 * Never store secrets (tokens, API keys, credentials) in a wormhole.
 */
export function defineWormhole<T>(): Wormhole<T> {
  let name: string | undefined;

  const requireName = (): string => {
    if (name === undefined) {
      throw new Error('wormhole is not registered — pass its registry to createWormholeMiddleware()');
    }

    return name;
  };

  const key = (): string => wormholeKey(requireName());

  // methods must not rely on `this` — consumers pass them around detached
  // (e.g. useSyncExternalStore(wormhole.subscribe, wormhole.get, wormhole.get))
  const wormhole: Wormhole<T> & { [ASSIGN](next: string): void } = {
    get name() {
      return requireName();
    },

    get key() {
      return key();
    },

    get(): DeepReadonly<T> {
      const value = als.getStore()?.get(key());

      if (value === undefined) {
        throw new Error(
          `wormhole "${requireName()}" is not open for this request — is it provided by the wormhole middleware?`,
        );
      }

      return value as DeepReadonly<T>;
    },

    set(): void {
      throw new Error(
        `wormhole "${requireName()}" set() cannot be called on the server — values are request-scoped and provided by the middleware`,
      );
    },

    subscribe(): () => void {
      // server values never change within a request — nothing to notify
      return () => {};
    },

    [ASSIGN](next: string): void {
      if (name !== undefined && name !== next) {
        throw new Error(`wormhole is registered under two names: "${name}" and "${next}"`);
      }

      name = next;
    },
  };

  return wormhole;
}

/**
 * Assign each wormhole its registry key as name. Called by `createWormholeMiddleware()`;
 * exposed for setups that read wormholes on the server without the middleware.
 */
export function assignWormholeNames(registry: Record<string, object>): void {
  for (const [name, wormhole] of Object.entries(registry)) {
    const assign = (wormhole as { [ASSIGN]?: (next: string) => void })[ASSIGN];

    if (typeof assign !== 'function') {
      throw new Error(
        `registry entry "${name}" is not a wormhole — the registry must contain defineWormhole() values only`,
      );
    }

    assign(name);
  }
}
