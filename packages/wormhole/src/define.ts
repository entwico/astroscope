import type { ReadonlyDeep } from '@entwico/dash';
import { als } from './als.js';
import { wormholeKey } from './key.js';
import type { Wormhole, WormholeDefinition, WormholeHandler } from './types.js';

// name assignment and the handler must survive dual module instances (vite runner +
// native), so both ride the wormhole object itself under Symbol.for keys
const ASSIGN = Symbol.for('@astroscope/wormhole.assign');
const SOURCE = Symbol.for('@astroscope/wormhole.source');

/** how the middleware opens a wormhole: its handler and whether every route loads it */
export type WormholeSource = { handler: WormholeHandler<unknown>; eager: boolean };

type Internal = Wormhole<unknown> & { [ASSIGN](next: string): void; [SOURCE]?: WormholeSource | undefined };

/**
 * Define a wormhole for the `src/wormholes.ts` registry, actions-style. The
 * handler resolves the value per request; the middleware calls it only for routes
 * the build found a reader on (frontmatter, islands, scripts) — or on every
 * request with `eager: true`. The wormhole's name is the registry key, assigned
 * when the registry is passed to `createWormholeMiddleware()` (or
 * `assignWormholeNames()`).
 *
 * **Security:** wormhole data is serialized into the HTML and sent to the browser.
 * Never store secrets (tokens, API keys, credentials) in a wormhole.
 *
 * @example
 * ```typescript
 * export const wormholes = {
 *   cart: defineWormhole({ handler: (ctx) => ctx.locals.cart }),
 *   config: defineWormhole({ handler: () => loadConfig(), eager: true }),
 * };
 * ```
 */
export function defineWormhole<T>(definition: WormholeDefinition<T>): Wormhole<T> {
  const wormhole = createWormhole() as Internal;

  wormhole[SOURCE] = { handler: definition.handler as WormholeHandler<unknown>, eager: definition.eager ?? false };

  return wormhole as Wormhole<T>;
}

/** the server-side wormhole object without a handler — the `wormholes` proxy stubs (internal) */
export function createWormhole<T>(): Wormhole<T> {
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

    get(): ReadonlyDeep<T> {
      const value = als.getStore()?.get(key());

      if (value === undefined) {
        throw new Error(
          `wormhole "${requireName()}" is not open for this request — is it provided by the wormhole middleware?`,
        );
      }

      return value as ReadonlyDeep<T>;
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

/** the definition a registry entry was created with — undefined for proxy stubs */
export function getWormholeSource<T>(wormhole: Wormhole<T>): WormholeSource | undefined {
  return (wormhole as unknown as Internal)[SOURCE];
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
