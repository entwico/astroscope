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
 * (client) or `open()` (server) with a new value, which keeps subscribers in sync.
 */
// `in out` forces invariance: methods are bivariant in TS, so without it a
// Wormhole<A> unifies into Wormhole<A | B> and mismatched open() data slips through
export interface Wormhole<in out T> {
  readonly name: string;
  readonly key: string;
  get(): DeepReadonly<T>;
  /**
   * Update the wormhole value on the **client only**.
   * Throws on the server — use `open(wormhole, data, fn)` from `@astroscope/wormhole/server` instead.
   */
  set(data: DeepReadonly<T>): void;
  subscribe(fn: (data: DeepReadonly<T>) => void): () => void;
}
