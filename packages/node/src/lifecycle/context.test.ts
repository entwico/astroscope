import { afterEach, describe, expect, test } from 'vitest';
import { getBootContext, setBootContext } from './context';
import type { BootContext } from './types';

const STORE_KEY = Symbol.for('@astroscope/node/boot-context');

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[STORE_KEY];
});

describe('boot context store', () => {
  test('getBootContext returns undefined before any server booted', () => {
    expect(getBootContext()).toBeUndefined();
  });

  test('setBootContext makes the context retrievable', () => {
    const context: BootContext = { dev: true, host: 'localhost', port: 4321 };

    setBootContext(context);

    expect(getBootContext()).toBe(context);
  });

  test('setBootContext replaces a previously set context', () => {
    setBootContext({ dev: true, host: 'localhost', port: 4321 });

    const next: BootContext = { dev: false, host: '0.0.0.0', port: 8080 };

    setBootContext(next);

    expect(getBootContext()).toBe(next);
  });
});
