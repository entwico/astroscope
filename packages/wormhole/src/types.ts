import type { ReadonlyDeep } from '@entwico/dash';
import type { APIContext } from 'astro';

/**
 * A wormhole transfers state from server middleware to client-side components.
 *
 * **Security:** wormhole data is serialized into an inline `<script>` tag and sent to the browser.
 * Never store secrets (tokens, API keys, credentials) in a wormhole.
 *
 * The stored value is exposed as deeply readonly (`ReadonlyDeep` of `@entwico/dash`) — the only way to change it is `set()`
 * (client) or the middleware's per-request values (server), which keeps subscribers in sync.
 */
// `in out` forces invariance: methods are bivariant in TS, so without it a
// Wormhole<A> unifies into Wormhole<A | B> and mismatched open() data slips through
export interface Wormhole<in out T> {
  readonly name: string;
  readonly key: string;
  get(): ReadonlyDeep<T>;
  /**
   * Update the wormhole value on the **client only** — every subscriber on the page
   * (islands and scripts alike) is notified. Throws on the server, where values are
   * request-scoped and provided by the middleware.
   */
  set(data: ReadonlyDeep<T>): void;
  subscribe(fn: (data: ReadonlyDeep<T>) => void): () => void;
}

/**
 * Resolves a wormhole's value for one request — called by the wormhole middleware
 * for every request whose route can read the wormhole. Return `undefined` to
 * leave it closed for the request.
 */
export type WormholeHandler<T> = (context: APIContext) => T | undefined | Promise<T | undefined>;

/** what `defineWormhole()` takes — the actions-style definition object */
export type WormholeDefinition<T> = {
  handler: WormholeHandler<T>;
  /**
   * Load on every request instead of only where the build found a reader — for
   * wormholes read by components the build cannot attribute to a route (islands
   * chosen dynamically at render time).
   */
  eager?: boolean | undefined;
};

/**
 * The project's wormhole names and value types. Empty by default — the integration
 * generates a type stub (via `injectTypes`) that merges the `src/wormholes.ts`
 * registry into this interface, which types the `wormholes` proxy.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface WormholeRegistry {}

/** maps a registry module's `{ name: Wormhole<T> }` shape to `{ name: T }` */
export type UnwrapWormholes<R> = { [K in keyof R]: R[K] extends Wormhole<infer T> ? T : never };

/** the shape of the `wormholes` proxy: one typed accessor per registry entry */
export type WormholeMap = { readonly [K in keyof WormholeRegistry]: Wormhole<WormholeRegistry[K]> };
