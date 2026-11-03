/**
 * Script generation for wormhole delivery, shipped through the `@astroscope/node`
 * islands pipeline (see islands-emitter.ts for the placement policy).
 */

/** values may contain `</script>` — escape `<` so they cannot end the tag */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', String.raw`\u003c`);
}

/**
 * Inline script writing entries onto `self.__wormholes__` and notifying listeners —
 * the counterpart of the browser proxy's entry protocol, safe in either order.
 */
export function createWormholeMergeScript(entries: Record<string, unknown>): string {
  return createWormholeMergeScriptFromEntries(
    Object.entries(entries).map(([name, value]) => `${JSON.stringify(name)}:${jsonForScript(value)}`),
  );
}

/**
 * The same script from already serialized `"name":json` entries, so a caller can
 * serialize values one by one and leave a failing one out.
 */
export function createWormholeMergeScriptFromEntries(entries: string[]): string {
  // the store and the delivered object have no prototype, so a name like `constructor`
  // or `__proto__` is an own entry and never reaches a builtin
  return (
    `<script>{const s=self.__wormholes__??=Object.create(null),d={__proto__:null,${entries.join(',')}};` +
    `for(const n in d){const e=s[n]??={};e.v=d[n];e.l&&e.l.forEach(f=>f(e.v))}}</script>`
  );
}
