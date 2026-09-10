import { describe, expect, test, vi } from 'vitest';
import { assignWormholeNames, defineWormhole } from './define';
import { openWormholes } from './server';

vi.mock('virtual:@astroscope/wormhole/manifest', () => ({ manifest: null }));
vi.mock('virtual:@astroscope/wormhole/registry', () => ({ wormholes: {} }));

describe('defineWormhole', () => {
  test('name and key come from the registry key', () => {
    const wh = defineWormhole<number>({ handler: () => undefined });

    assignWormholeNames({ cart: wh });

    expect(wh.name).toBe('cart');
    expect(wh.key).toBe('__wormhole_cart__');
  });

  test('throws on any use before registration', () => {
    const wh = defineWormhole<number>({ handler: () => undefined });

    expect(() => wh.name).toThrow('wormhole is not registered');
    expect(() => wh.get()).toThrow('wormhole is not registered');
  });

  test('re-assigning the same name is idempotent, a different name throws', () => {
    const wh = defineWormhole<number>({ handler: () => undefined });

    assignWormholeNames({ cart: wh });
    assignWormholeNames({ cart: wh });

    expect(() => assignWormholeNames({ basket: wh })).toThrow('registered under two names: "cart" and "basket"');
  });

  test('rejects registry entries that are not wormholes', () => {
    expect(() => assignWormholeNames({ cart: { get: () => 1 } })).toThrow('registry entry "cart" is not a wormhole');
  });

  test('get() outside an open scope throws with the wormhole name', () => {
    const wh = defineWormhole<number>({ handler: () => undefined });

    assignWormholeNames({ session: wh });

    expect(() => wh.get()).toThrow('wormhole "session" is not open for this request');
  });

  test('keeps the handler and eager flag for the middleware', async () => {
    const { getWormholeSource } = await import('./define');
    const handler = () => 1;
    const plain = defineWormhole({ handler });
    const eager = defineWormhole({ handler, eager: true });

    expect(getWormholeSource(plain)).toEqual({ handler, eager: false });
    expect(getWormholeSource(eager)).toEqual({ handler, eager: true });
  });

  test('set() throws on the server', () => {
    const wh = defineWormhole<{ v: number }>({ handler: () => undefined });

    assignWormholeNames({ counter: wh });

    expect(() => wh.set({ v: 1 })).toThrow('cannot be called on the server');
  });

  test('subscribe() is inert on the server', () => {
    const wh = defineWormhole<number>({ handler: () => undefined });

    assignWormholeNames({ counter: wh });

    expect(wh.subscribe(() => {})).toBeTypeOf('function');
  });

  describe('readonly typing', () => {
    test('exposes the stored value as deeply readonly', () => {
      const wh = defineWormhole<{ cart: { items: string[] }; count: number }>({ handler: () => undefined });

      assignWormholeNames({ readonlyDemo: wh });

      const use = (): void => {
        openWormholes(wh, { cart: { items: [] }, count: 0 }, () => {
          const data = wh.get();

          // @ts-expect-error top-level properties are readonly
          data.count = 1;
          // @ts-expect-error nested properties are readonly
          data.cart.items = [];
          // @ts-expect-error nested arrays are readonly
          data.cart.items.push('x');
        });
      };

      expect(use).toBeTypeOf('function');
    });
  });
});
