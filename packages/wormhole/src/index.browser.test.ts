import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createWormholeMergeScript } from './client-state';

async function load() {
  delete (globalThis as any).__wormholes__;
  vi.resetModules();

  return import('./index.browser');
}

/** run an emitted merge script the way the browser would, against globalThis */
function runMergeScript(script: string): void {
  const js = script.replace(/^<script>/, '').replace(/<\/script>$/, '');

  new Function('self', js)(globalThis);
}

describe('wormhole proxy (browser)', () => {
  beforeEach(() => {
    delete (globalThis as any).__wormholes__;
  });

  test('get() throws before any data arrived', async () => {
    const { wormholes } = await load();

    expect(() => (wormholes as any).cart.get()).toThrow('wormhole "cart" has no data');
  });

  test('reads values written by an emitted merge script, in either order', async () => {
    // script first, proxy later
    const first = await load();

    runMergeScript(createWormholeMergeScript({ cart: { items: ['a'] } }));

    expect((first.wormholes as any).cart.get()).toEqual({ items: ['a'] });

    // proxy first (with a subscriber), script later
    const second = await load();
    const seen = vi.fn();

    (second.wormholes as any).counter.subscribe(seen);

    runMergeScript(createWormholeMergeScript({ counter: { count: 3 } }));

    expect((second.wormholes as any).counter.get()).toEqual({ count: 3 });
    expect(seen).toHaveBeenCalledExactlyOnceWith({ count: 3 });
  });

  test('set() updates the value and notifies all subscribers', async () => {
    const { wormholes } = await load();
    const a = vi.fn();
    const b = vi.fn();

    (wormholes as any).counter.subscribe(a);
    (wormholes as any).counter.subscribe(b);
    (wormholes as any).counter.set({ count: 1 });

    expect((wormholes as any).counter.get()).toEqual({ count: 1 });
    expect(a).toHaveBeenCalledExactlyOnceWith({ count: 1 });
    expect(b).toHaveBeenCalledExactlyOnceWith({ count: 1 });
  });

  test('unsubscribe stops notifications', async () => {
    const { wormholes } = await load();
    const seen = vi.fn();

    const unsubscribe = (wormholes as any).counter.subscribe(seen);

    unsubscribe();
    (wormholes as any).counter.set(42);

    expect(seen).not.toHaveBeenCalled();
  });

  test('the same stub is returned for repeated accesses', async () => {
    const { wormholes } = await load();

    expect((wormholes as any).cart).toBe((wormholes as any).cart);
  });

  test('name and key are exposed', async () => {
    const { wormholes } = await load();

    expect((wormholes as any).cart.name).toBe('cart');
    expect((wormholes as any).cart.key).toBe('__wormhole_cart__');
  });

  test('defineWormhole throws — the registry is server-only', async () => {
    const { defineWormhole } = await load();

    expect(() => defineWormhole()).toThrow('server-only');
  });
});
