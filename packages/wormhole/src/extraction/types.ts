/**
 * Produced by the build and read back at runtime. Chunk keys are basenames without
 * `.js` (e.g. `Counter.abc123`) — the same form the islands emitter derives from an
 * island's public chunk URLs.
 *
 * `*` stands for "all open wormholes": a module accessed the proxy dynamically
 * (`wormholes[name]`, aliasing, namespace import), so the scan degrades to sound
 * over-emission for the chunks containing it.
 */
export type WormholeManifest = {
  /** wormhole names referenced per client chunk */
  chunks: Record<string, string[]>;
  /** names reachable from astro `<script>` entries — non-island consumers, delivered at stream end */
  scripts: string[];
  /**
   * names the middleware must load per route pattern: reads on the server —
   * frontmatter, endpoints, helpers and server-rendered islands, from the server
   * build's module graph — plus the reads of `<script>` entries the route's
   * components own. Island reads join at runtime through the route's islands.
   * Routes whose module the server build did not see are absent (unknown)
   */
  routes: Record<string, string[]>;
};
