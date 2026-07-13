import { describe, expect, test, vi } from 'vitest';
import type { Wormhole } from '../types';
import { useWormhole } from './index';

const useSyncExternalStore = vi.hoisted(() =>
  vi.fn((_subscribe: () => void, getSnapshot: () => unknown) => getSnapshot()),
);

vi.mock('react', () => ({ useSyncExternalStore }));

describe('useWormhole', () => {
  test('subscribes to the wormhole and returns its current value', () => {
    const subscribe = vi.fn(() => () => {});
    const get = vi.fn(() => ({ value: 42 }));
    const wormhole = { name: 'test', key: 'key', get, set: vi.fn(), subscribe } as unknown as Wormhole<{
      value: number;
    }>;

    const result = useWormhole(wormhole);

    expect(result).toEqual({ value: 42 });
    // the server snapshot must be the same getter so SSR and hydration render identically
    expect(useSyncExternalStore).toHaveBeenCalledWith(subscribe, get, get);
  });
});
