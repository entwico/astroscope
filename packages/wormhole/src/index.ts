import { assignWormholeNames, createWormhole } from './define.js';
import type { Wormhole, WormholeMap } from './types.js';

export { default } from './integration.js';
export type { WormholeIntegrationOptions } from './integration.js';
export { defineWormhole, assignWormholeNames } from './define.js';
export type {
  UnwrapWormholes,
  Wormhole,
  WormholeDefinition,
  WormholeHandler,
  WormholeMap,
  WormholeRegistry,
} from './types.js';

const stubs = new Map<string, Wormhole<unknown>>();

function stub(name: string): Wormhole<unknown> {
  let wormhole = stubs.get(name);

  if (!wormhole) {
    wormhole = createWormhole();

    assignWormholeNames({ [name]: wormhole });
    stubs.set(name, wormhole);
  }

  return wormhole;
}

/**
 * Access wormholes by name — `wormholes.cart.get()`. This is the server side of the
 * proxy (the browser build ships its own): values come from the request's
 * wormhole middleware scope, so it works in frontmatter, endpoints, and
 * server-rendered islands alike. Typed via the registry type stub the integration
 * generates from `src/wormholes.ts`.
 */
export const wormholes: WormholeMap = new Proxy({} as WormholeMap, {
  get(_target, prop) {
    return typeof prop === 'string' ? stub(prop) : undefined;
  },
});
