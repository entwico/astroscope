import { afterEach, describe, expect, test, vi } from 'vitest';
import { activateHealthChecks, deactivateHealthChecks, getHealthStore } from './store';

const STORE_KEY = Symbol.for('@astroscope/node/health');

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[STORE_KEY];
});

describe('getHealthStore', () => {
  test('creates the store on first access', () => {
    const store = getHealthStore();

    expect(store.registry).toBeUndefined();
    expect(store.unregisters.size).toBe(0);
  });

  test('returns the same store on subsequent access', () => {
    const first = getHealthStore();
    const second = getHealthStore();

    expect(second).toBe(first);
  });
});

describe('activateHealthChecks', () => {
  test('attaches the registry to the store', () => {
    const registry = { register: vi.fn(() => () => {}) };

    activateHealthChecks(registry);

    expect(getHealthStore().registry).toBe(registry);
  });
});

describe('deactivateHealthChecks', () => {
  test('runs every remaining unregister, clears them and detaches the registry', () => {
    const registry = { register: vi.fn(() => () => {}) };
    const unregisterA = vi.fn(() => {});
    const unregisterB = vi.fn(() => {});
    const store = getHealthStore();

    activateHealthChecks(registry);

    store.unregisters.set('a', unregisterA);
    store.unregisters.set('b', unregisterB);

    deactivateHealthChecks();

    expect(unregisterA).toHaveBeenCalledTimes(1);
    expect(unregisterB).toHaveBeenCalledTimes(1);
    expect(store.unregisters.size).toBe(0);
    expect(store.registry).toBeUndefined();
  });

  test('is a no-op when nothing was registered', () => {
    deactivateHealthChecks();

    expect(getHealthStore().registry).toBeUndefined();
  });
});
