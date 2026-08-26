import { describe, expect, test } from 'vitest';
import { scanWormholeAccess } from './scan';

const scan = (code: string, id = 'file.ts') => scanWormholeAccess(code, id);

describe('scanWormholeAccess', () => {
  test('returns null for modules that do not use the package', () => {
    expect(scan(`const wormholes = { cart: 1 }; wormholes.cart;`)).toBeNull();
    expect(scan(`import { other } from 'somewhere'; other.cart;`)).toBeNull();
  });

  test('collects static member accesses', () => {
    const result = scan(`
      import { wormholes } from '@astroscope/wormhole';

      wormholes.cart.get();
      const s = wormholes.session;
      wormholes['stats'].subscribe(() => {});
    `);

    expect(result).toEqual({ names: new Set(['cart', 'session', 'stats']), dynamic: false });
  });

  test('supports aliased imports', () => {
    const result = scan(`
      import { wormholes as w } from '@astroscope/wormhole';

      w.cart.get();
    `);

    expect(result).toEqual({ names: new Set(['cart']), dynamic: false });
  });

  test('ignores same-named identifiers in name positions', () => {
    const result = scan(`
      import { wormholes } from '@astroscope/wormhole';

      wormholes.cart.get();

      const obj = { wormholes: 1 };
      obj.wormholes;
    `);

    expect(result).toEqual({ names: new Set(['cart']), dynamic: false });
  });

  test('ignores type-only positions', () => {
    const result = scan(`
      import { wormholes } from '@astroscope/wormhole';

      type T = typeof wormholes;

      wormholes.cart.get();
    `);

    expect(result).toEqual({ names: new Set(['cart']), dynamic: false });
  });

  test('computed access with a non-literal key degrades to dynamic', () => {
    const result = scan(`
      import { wormholes } from '@astroscope/wormhole';

      const name = pick();
      wormholes[name].get();
    `);

    expect(result?.dynamic).toBe(true);
  });

  test('aliasing the proxy into a variable degrades to dynamic', () => {
    expect(
      scan(`
        import { wormholes } from '@astroscope/wormhole';

        const w = wormholes;
      `)?.dynamic,
    ).toBe(true);

    expect(
      scan(`
        import { wormholes } from '@astroscope/wormhole';

        const { cart } = wormholes;
      `)?.dynamic,
    ).toBe(true);
  });

  test('namespace imports and re-exports degrade to dynamic', () => {
    expect(scan(`import * as pkg from '@astroscope/wormhole'; pkg.wormholes.cart;`)?.dynamic).toBe(true);
    expect(scan(`export { wormholes } from '@astroscope/wormhole';`)?.dynamic).toBe(true);
    expect(scan(`export * from '@astroscope/wormhole';`)?.dynamic).toBe(true);
  });

  test('re-exporting the local binding degrades to dynamic', () => {
    const result = scan(`
      import { wormholes } from '@astroscope/wormhole';

      export { wormholes };
    `);

    expect(result?.dynamic).toBe(true);
  });

  test('parses tsx and jsx', () => {
    const tsx = scan(
      `
      import { wormholes } from '@astroscope/wormhole';

      export function C(): JSX.Element {
        return <div>{String(wormholes.cart.get())}</div>;
      }
    `,
      'file.tsx',
    );

    expect(tsx).toEqual({ names: new Set(['cart']), dynamic: false });
  });

  test('unparseable modules degrade to dynamic', () => {
    const result = scan(`import { wormholes } from '@astroscope/wormhole'; const = ;`);

    expect(result).toEqual({ names: new Set(), dynamic: true });
  });

  test('other imports from the package do not trigger a scan result by themselves', () => {
    expect(scan(`import { defineWormhole } from '@astroscope/wormhole'; defineWormhole();`)).toBeNull();
  });
});
