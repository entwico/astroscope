import pino from 'pino';
import { afterEach, describe, expect, test } from 'vitest';
import { type RequestRecord, getLogStore, getRequestRecord } from './store';

const STORE_KEY = Symbol.for('@astroscope/node/log');

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[STORE_KEY];
});

describe('getLogStore', () => {
  test('creates the store with empty defaults on first access', () => {
    const store = getLogStore();

    expect(store.root).toBeUndefined();
    expect(store.buffer).toEqual([]);
    expect(store.dropped).toBe(0);
  });

  test('returns the same store on subsequent access', () => {
    const first = getLogStore();
    const second = getLogStore();

    expect(second).toBe(first);
  });
});

describe('getRequestRecord', () => {
  test('returns undefined outside a request context', () => {
    expect(getRequestRecord()).toBeUndefined();
  });

  test('returns the active record inside a request context', () => {
    const record: RequestRecord = {
      logger: pino({ level: 'silent' }),
      url: '/x',
      route: undefined,
      actionName: undefined,
    };

    getLogStore().requestStorage.run(record, () => {
      expect(getRequestRecord()).toBe(record);
    });

    expect(getRequestRecord()).toBeUndefined();
  });
});
