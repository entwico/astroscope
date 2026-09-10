import { beforeEach, describe, expect, test, vi } from 'vitest';

const { record, add, logError, spans } = vi.hoisted(() => ({
  record: vi.fn(),
  add: vi.fn(),
  logError: vi.fn(),
  spans: [] as { name: string; attributes: unknown }[],
}));

vi.mock('@astroscope/node/telemetry', () => ({
  DURATION_BUCKETS: { compute: [], io: [], http: [] },
  createHistogram: () => ({ record }),
  createCounter: () => ({ add }),
  errorType: (error: unknown) => (error instanceof Error ? error.constructor.name : typeof error),
  withSpan: (name: string, options: { attributes: unknown }, fn: () => unknown) => {
    spans.push({ name, attributes: options.attributes });

    return fn();
  },
}));

vi.mock('@astroscope/node/log', () => ({ log: { error: logError } }));

const { measureHandler } = await import('./telemetry.js');

beforeEach(() => {
  vi.clearAllMocks();
  spans.length = 0;
});

describe('measureHandler', () => {
  test('a synchronous handler returns synchronously under a named span', () => {
    expect(measureHandler('cart', () => 1)).toBe(1);

    expect(spans).toEqual([{ name: 'wormhole cart', attributes: { 'astro.wormhole.name': 'cart' } }]);
    expect(record).toHaveBeenCalledWith(expect.any(Number), { 'astro.wormhole.name': 'cart' });
    expect(add).not.toHaveBeenCalled();
  });

  test('an async handler is measured when it settles', async () => {
    const result = measureHandler('session', () => Promise.resolve('s'));

    expect(record).not.toHaveBeenCalled();
    expect(await result).toBe('s');
    expect(record).toHaveBeenCalledWith(expect.any(Number), { 'astro.wormhole.name': 'session' });
  });

  test('a synchronous throw is counted, logged and rethrown', () => {
    expect(() =>
      measureHandler('cart', () => {
        throw new TypeError('bad');
      }),
    ).toThrow('bad');

    expect(add).toHaveBeenCalledWith(1, { 'astro.wormhole.name': 'cart', 'error.type': 'TypeError' });
    expect(logError).toHaveBeenCalledWith({ err: expect.any(TypeError), wormhole: 'cart' }, 'wormhole handler failed');
    expect(record).not.toHaveBeenCalled();
  });

  test('a rejection is counted, logged and rethrown', async () => {
    await expect(measureHandler('cart', () => Promise.reject(new Error('later')))).rejects.toThrow('later');

    expect(add).toHaveBeenCalledWith(1, { 'astro.wormhole.name': 'cart', 'error.type': 'Error' });
    expect(logError).toHaveBeenCalledTimes(1);
  });
});
