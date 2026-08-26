/**
 * Recursively marks all properties of `T` as `readonly`.
 *
 * Wormhole data is JSON-serializable by design (it is inlined into a `<script>` tag),
 * so only plain objects, arrays, and primitives need to be handled.
 */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/**
 * A wormhole transfers state from server middleware to client-side components.
 *
 * **Security:** wormhole data is serialized into an inline `<script>` tag and sent to the browser.
 * Never store secrets (tokens, API keys, credentials) in a wormhole.
 *
 * The stored value is exposed as deeply readonly — the only way to change it is `set()`
 * (client) or the middleware's per-request values (server), which keeps subscribers in sync.
 */
// `in out` forces invariance: methods are bivariant in TS, so without it a
// Wormhole<A> unifies into Wormhole<A | B> and mismatched open() data slips through
export interface Wormhole<in out T> {
  readonly name: string;
  readonly key: string;
  get(): DeepReadonly<T>;
  /**
   * Update the wormhole value on the **client only** — every subscriber on the page
   * (islands and scripts alike) is notified. Throws on the server, where values are
   * request-scoped and provided by the middleware.
   */
  set(data: DeepReadonly<T>): void;
  subscribe(fn: (data: DeepReadonly<T>) => void): () => void;
}

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
