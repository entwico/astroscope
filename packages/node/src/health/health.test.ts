import { afterEach, describe, expect, test, vi } from 'vitest';
import { registerHealthCheck } from './health';
import { type RegistrableCheck, activateHealthChecks, deactivateHealthChecks, getHealthStore } from './store';

const STORE_KEY = Symbol.for('@astroscope/node/health');

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[STORE_KEY];
});

describe('registerHealthCheck', () => {
  test('is a no-op without an active registry', () => {
    const unregister = registerHealthCheck({ name: 'db', check: () => {} });

    expect(getHealthStore().unregisters.size).toBe(0);
    expect(() => unregister()).not.toThrow();
  });

  test('registers the check with the active registry', () => {
    const registered: RegistrableCheck[] = [];
    const registry = {
      register: vi.fn((check: RegistrableCheck) => {
        registered.push(check);

        return () => {};
      }),
    };
    const check = () => {};

    activateHealthChecks(registry);
    registerHealthCheck({ name: 'db', check });

    expect(registry.register).toHaveBeenCalledTimes(1);
    expect(registered[0]).toEqual({ name: 'db', check });
  });

  test('passes optional and timeout only when defined', () => {
    const registered: RegistrableCheck[] = [];
    const registry = {
      register: (check: RegistrableCheck) => {
        registered.push(check);

        return () => {};
      },
    };

    activateHealthChecks(registry);

    registerHealthCheck({ name: 'a', check: () => {} });
    registerHealthCheck({ name: 'b', check: () => {}, optional: false, timeout: 1000 });

    expect(registered[0]).not.toHaveProperty('optional');
    expect(registered[0]).not.toHaveProperty('timeout');
    expect(registered[1]).toMatchObject({ optional: false, timeout: 1000 });
  });

  test('returned function unregisters exactly once', () => {
    const underlying = vi.fn(() => {});
    const registry = { register: () => underlying };

    activateHealthChecks(registry);

    const unregister = registerHealthCheck({ name: 'db', check: () => {} });

    expect(getHealthStore().unregisters.size).toBe(1);

    unregister();

    expect(underlying).toHaveBeenCalledTimes(1);
    expect(getHealthStore().unregisters.size).toBe(0);

    unregister();

    expect(underlying).toHaveBeenCalledTimes(1);
  });

  test('checks still registered are removed by deactivation, making the returned function a no-op', () => {
    const underlying = vi.fn(() => {});
    const registry = { register: () => underlying };

    activateHealthChecks(registry);

    const unregister = registerHealthCheck({ name: 'db', check: () => {} });

    deactivateHealthChecks();

    expect(underlying).toHaveBeenCalledTimes(1);

    unregister();

    expect(underlying).toHaveBeenCalledTimes(1);
  });
});
