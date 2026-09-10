import type { ReadonlyDeep } from '@entwico/dash';
import { wormholeKey } from './key.js';
import type { Wormhole, WormholeMap } from './types.js';

export type {
  UnwrapWormholes,
  Wormhole,
  WormholeDefinition,
  WormholeHandler,
  WormholeMap,
  WormholeRegistry,
} from './types.js';

/**
 * Browser side of the `wormholes` proxy. Values live on `self.__wormholes__` — written
 * by the inline merge scripts the server emits before each island (and at stream end
 * for script consumers), or by client-side `set()` calls. The entry protocol is
 * `{ v: value, l: listeners }`, shared with the emitted scripts, so writes land in
 * either order.
 */

type Entry = { v?: unknown; l?: ((value: unknown) => void)[] | undefined };

const store: Record<string, Entry> = ((globalThis as any).__wormholes__ ??= {});

const stubs = new Map<string, Wormhole<unknown>>();

function stub(name: string): Wormhole<unknown> {
  let wormhole = stubs.get(name);

  if (wormhole) {
    return wormhole;
  }

  const entry = (): Entry => (store[name] ??= {});

  wormhole = {
    name,
    key: wormholeKey(name),

    get(): ReadonlyDeep<unknown> {
      const value = entry().v;

      if (value === undefined) {
        throw new Error(`wormhole "${name}" has no data — is it provided by the wormhole middleware?`);
      }

      return value;
    },

    set(data): void {
      const current = entry();

      current.v = data;
      current.l?.forEach((fn) => fn(data));
    },

    subscribe(fn): () => void {
      const current = entry();

      (current.l ??= []).push(fn);

      return () => {
        current.l = current.l?.filter((listener) => listener !== fn);
      };
    },
  };

  stubs.set(name, wormhole);

  return wormhole;
}

export const wormholes: WormholeMap = new Proxy({} as WormholeMap, {
  get(_target, prop) {
    return typeof prop === 'string' ? stub(prop) : undefined;
  },
});

export function defineWormhole(): never {
  throw new Error(
    'defineWormhole() is server-only — do not import the wormhole registry in client code; access wormholes via the `wormholes` proxy instead',
  );
}

export function assignWormholeNames(): never {
  throw new Error('assignWormholeNames() is server-only');
}

export default function wormholeIntegration(): never {
  throw new Error('the @astroscope/wormhole integration is server-only');
}
