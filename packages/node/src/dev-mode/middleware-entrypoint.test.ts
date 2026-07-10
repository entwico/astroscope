import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { GEN_HEADER, incrementGeneration } from './generation';
import { onRequest } from './middleware-entrypoint';

const STATE_KEY = Symbol.for('@astroscope/node/generation');

beforeEach(() => {
  (globalThis as Record<symbol, unknown>)[STATE_KEY] = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function createContext(stamp: string | null): { request: Request; url: URL } {
  const headers = new Headers();

  if (stamp !== null) headers.set(GEN_HEADER, stamp);

  return {
    request: new Request('http://example.test/page', { headers }),
    url: new URL('http://example.test/page'),
  };
}

describe('onRequest', () => {
  test('passes through when next() resolves', async () => {
    const ctx = createContext('0');
    const expected = new Response('ok');

    const result = await onRequest(ctx as never, () => Promise.resolve(expected));

    expect(result).toBe(expected);
  });

  test('rethrows when stamp matches the current generation', async () => {
    incrementGeneration(); // current = 1

    const ctx = createContext('1');
    const boom = new Error('real bug');

    await expect(onRequest(ctx as never, () => Promise.reject(boom))).rejects.toBe(boom);
  });

  test('rethrows when no stamp is present (we only suppress when we have a clear stale signal)', async () => {
    incrementGeneration();

    const ctx = createContext(null);
    const boom = new Error('real bug');

    await expect(onRequest(ctx as never, () => Promise.reject(boom))).rejects.toBe(boom);
  });

  test('swallows the error and returns 503 when stamp lags the current generation', async () => {
    incrementGeneration();
    incrementGeneration(); // current = 2

    const ctx = createContext('1');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const boom = new Error('singleton used after dispose');

    const result = (await onRequest(ctx as never, () => Promise.reject(boom))) as Response;

    expect(result.status).toBe(503);
    // recordStaleError schedules the flush — let it fire
    await new Promise((r) => setTimeout(r, 60));
    expect(log).toHaveBeenCalledOnce();
  });
});
