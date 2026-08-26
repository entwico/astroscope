/**
 * Script generation for wormhole delivery, shipped through the `@astroscope/node`
 * islands pipeline (see islands-emitter.ts for the placement policy).
 */

/** values may contain `</script>` — escape `<` so they cannot end the tag */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Inline script writing entries onto `self.__wormholes__` and notifying listeners —
 * the counterpart of the browser proxy's entry protocol, safe in either order.
 */
export function createWormholeMergeScript(entries: Record<string, unknown>): string {
  return (
    `<script>{const s=self.__wormholes__??={},d=${jsonForScript(entries)};` +
    `for(const n in d){const e=s[n]??={};e.v=d[n];e.l&&e.l.forEach(f=>f(e.v))}}</script>`
  );
}
