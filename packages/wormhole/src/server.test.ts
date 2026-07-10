import { describe, expect, test } from 'vitest';
import { defineWormhole } from './define';
import { open } from './server';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('open', () => {
  test('single wormhole is readable inside fn and across await', async () => {
    const wh = defineWormhole<{ v: number }>('srv-single');

    await open(wh, { v: 1 }, async () => {
      expect(wh.get()).toEqual({ v: 1 });

      await sleep(5);

      expect(wh.get()).toEqual({ v: 1 });
    });
  });

  test('returns the value of fn', () => {
    const wh = defineWormhole<number>('srv-return');

    expect(open(wh, 1, () => 'result')).toBe('result');
  });

  test('multiple wormholes open in a single call', () => {
    const a = defineWormhole<{ items: string[] }>('srv-multi-a');
    const b = defineWormhole<{ loggedIn: boolean }>('srv-multi-b');

    open(
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
    expect(open([], () => 42)).toBe(42);
  });

  test('nested open shadows only its own wormhole', () => {
    const a = defineWormhole<number>('srv-shadow-a');
    const b = defineWormhole<number>('srv-shadow-b');

    open(
      [
        [a, 1],
        [b, 10],
      ],
      () => {
        open(a, 2, () => {
          expect(a.get()).toBe(2);
          expect(b.get()).toBe(10);
        });

        expect(a.get()).toBe(1);
      },
    );
  });

  test('concurrent async contexts stay isolated', async () => {
    const wh = defineWormhole<number>('srv-concurrent');

    const run = (value: number) =>
      open(wh, value, async () => {
        await sleep(value === 1 ? 10 : 1);

        return wh.get();
      });

    expect(await Promise.all([run(1), run(2)])).toEqual([1, 2]);
  });

  test('get() outside an open context throws even after the accessor exists', () => {
    const wh = defineWormhole<number>('srv-outside');

    open(wh, 1, () => {});

    expect(() => wh.get()).toThrow('wormhole "srv-outside" is not initialized');
  });

  test('falsy data is preserved', () => {
    const wh = defineWormhole<number>('srv-falsy');

    open(wh, 0, () => {
      expect(wh.get()).toBe(0);
    });
  });

  describe('typing', () => {
    test('each entry is checked against its own wormhole', () => {
      const cart = defineWormhole<{ items: string[] }>('srv-type-cart');
      const session = defineWormhole<{ loggedIn: boolean }>('srv-type-session');

      const use = (): void => {
        open(
          [
            [cart, { items: [] }],
            [session, { loggedIn: true }],
          ],
          () => {},
        );

        open(
          [
            // @ts-expect-error data does not match this entry's wormhole
            [cart, { loggedIn: true }],
            [session, { loggedIn: true }],
          ],
          () => {},
        );

        // @ts-expect-error data does not match the wormhole
        open(cart, { loggedIn: true }, () => {});
      };

      expect(use).toBeTypeOf('function');
    });
  });
});
