import { describe, expect, test, vi } from 'vitest';
import { assignWormholeNames, defineWormhole } from './define';
import { openWormholes } from './server';
import type { Wormhole } from './types';

vi.mock('virtual:@astroscope/wormhole/manifest', () => ({ manifest: null }));
vi.mock('virtual:@astroscope/wormhole/registry', () => ({ wormholes: {} }));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function named<T>(name: string): Wormhole<T> {
  const wormhole = defineWormhole<T>({ handler: () => undefined });

  assignWormholeNames({ [name]: wormhole });

  return wormhole;
}

describe('openWormholes', () => {
  test('single wormhole is readable inside fn and across await', async () => {
    const wh = named<{ v: number }>('srv-single');

    await openWormholes(wh, { v: 1 }, async () => {
      expect(wh.get()).toEqual({ v: 1 });

      await sleep(5);

      expect(wh.get()).toEqual({ v: 1 });
    });
  });

  test('returns the value of fn', () => {
    const wh = named<number>('srv-return');

    expect(openWormholes(wh, 1, () => 'result')).toBe('result');
  });

  test('multiple wormholes open in a single call', () => {
    const a = named<{ items: string[] }>('srv-multi-a');
    const b = named<{ loggedIn: boolean }>('srv-multi-b');

    openWormholes(
      [
        [a, { items: ['x'] }],
        [b, { loggedIn: true }],
      ],
      () => {
        expect(a.get()).toEqual({ items: ['x'] });
        expect(b.get()).toEqual({ loggedIn: true });
      },
    );
  });

  test('empty entries array just runs fn', () => {
    expect(openWormholes([], () => 42)).toBe(42);
  });

  test('nested open shadows only its own wormhole', () => {
    const a = named<number>('srv-shadow-a');
    const b = named<number>('srv-shadow-b');

    openWormholes(
      [
        [a, 1],
        [b, 10],
      ],
      () => {
        openWormholes(a, 2, () => {
          expect(a.get()).toBe(2);
          expect(b.get()).toBe(10);
        });

        expect(a.get()).toBe(1);
      },
    );
  });

  test('concurrent async contexts stay isolated', async () => {
    const wh = named<number>('srv-concurrent');

    const run = (value: number) =>
      openWormholes(wh, value, async () => {
        await sleep(value === 1 ? 10 : 1);

        return wh.get();
      });

    expect(await Promise.all([run(1), run(2)])).toEqual([1, 2]);
  });

  test('get() outside an open context throws', () => {
    const wh = named<number>('srv-outside');

    openWormholes(wh, 1, () => {});

    expect(() => wh.get()).toThrow('wormhole "srv-outside" is not open for this request');
  });

  test('falsy data is preserved', () => {
    const wh = named<number>('srv-falsy');

    openWormholes(wh, 0, () => {
      expect(wh.get()).toBe(0);
    });
  });

  describe('typing', () => {
    test('each entry is checked against its own wormhole', () => {
      const cart = named<{ items: string[] }>('srv-type-cart');
      const session = named<{ loggedIn: boolean }>('srv-type-session');

      const use = (): void => {
        openWormholes(
          [
            [cart, { items: [] }],
            [session, { loggedIn: true }],
          ],
          () => {},
        );

        openWormholes(
          [
            // @ts-expect-error data does not match this entry's wormhole
            [cart, { loggedIn: true }],
            [session, { loggedIn: true }],
          ],
          () => {},
        );

        // @ts-expect-error data does not match the wormhole
        openWormholes(cart, { loggedIn: true }, () => {});
      };

      expect(use).toBeTypeOf('function');
    });
  });
});
