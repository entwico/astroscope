import type { APIContext } from 'astro';

/**
 * The islands manifest is produced by the client build (which runs after the server
 * build) and read back at runtime by the islands middleware. Chunk file names are
 * relative to the client dist (e.g. `_astro/Cart.abc123.js`) — the middleware maps
 * them to public URLs using the prefix observed on the island's own `component-url`,
 * so base and CDN asset prefixes need no configuration.
 */
export type IslandsManifest = {
  /** client-dist-relative file name of the emitted gate runtime script */
  runtime: string;
  /** direct imports per chunk: `i` static, `d` dynamic; file names relative to client dist */
  chunks: Record<string, { i?: string[] | undefined; d?: string[] | undefined }>;
};

/**
 * One island as seen by the streaming scanner, with its chunk closures resolved.
 * URLs are public (prefixed) — `staticClosure` and `fullClosure` include the
 * component and renderer entry URLs themselves.
 */
export type IslandInfo = {
  componentUrl: string;
  rendererUrl: string | null;
  /** raw `client` attribute value, e.g. `load`, `visible`, `idle-x` */
  client: string | null;
  /** transitive static imports of component + renderer — what preloading warms */
  staticClosure: string[];
  /** static + dynamic transitive imports — what data providers must cover */
  fullClosure: string[];
};

/**
 * What an emitter contributes for one island. `links` are merged across emitters and
 * either emitted as `<link rel="modulepreload">` tags (immediate directives) or
 * registered on the preload global for the gate runtime (deferred directives).
 * `html` is emitted right before the island tag regardless of directive — an inline
 * script there is parsed strictly before the island connects, so it is the place
 * for data the island's chunks read at execution time.
 */
export type IslandEmission = {
  links?: string[] | undefined;
  html?: string | undefined;
};

/**
 * `context` is the request's APIContext when the transform runs in the middleware,
 * and undefined when it runs over prerendered HTML at build time.
 */
export type IslandEmitter = (island: IslandInfo, context?: APIContext | undefined) => IslandEmission | null;

/**
 * What a document emitter contributes for one html page response.
 */
export type DocumentEmission = {
  head?: string | undefined;
  end?: (() => string | null) | undefined;
};

/**
 * Called once per html page response by the islands middleware, before the body
 * streams. Return null to contribute nothing. Unlike island emitters, document
 * emitters never run over prerendered HTML — their data is per-request by nature.
 */
export type DocumentEmitter = (context: APIContext) => DocumentEmission | null;
