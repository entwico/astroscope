import { describe, expect, test } from 'vitest';
import { createWormholeMergeScript, jsonForScript } from './client-state';

describe('jsonForScript', () => {
  test('escapes < so values cannot close the script tag', () => {
    expect(jsonForScript({ html: '</script><script>alert(1)' })).not.toContain('</script>');
  });
});

describe('createWormholeMergeScript', () => {
  test('writes values and notifies listeners on the shared store', () => {
    const script = createWormholeMergeScript({ cart: { items: [1] } });
    const js = script.replace(/^<script>/, '').replace(/<\/script>$/, '');
    const seen: unknown[] = [];
    const scope = { __wormholes__: { cart: { l: [(value: unknown) => seen.push(value)] } } };

    new Function('self', js)(scope);

    expect((scope.__wormholes__.cart as { v?: unknown }).v).toEqual({ items: [1] });
    expect(seen).toEqual([{ items: [1] }]);
  });
});
