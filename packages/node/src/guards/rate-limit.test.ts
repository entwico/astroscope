import type { APIContext } from 'astro';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { guard } from './pages';
import { PRUNE_ABOVE, rateLimit } from './rate-limit';

vi.mock('astro:actions', () => {
  class ActionError extends Error {
    code: string;

    constructor({ code, message }: { code: string; message?: string }) {
      super(message ?? code);
      this.code = code;
    }

    static codeToStatus(code: string) {
      return code === 'TOO_MANY_REQUESTS' ? 429 : 500;
    }
  }

  return { ActionError };
});

function createContext(clientAddress: string | null = '203.0.113.7'): APIContext {
  return {
    request: new Request('https://example.com/x', { method: 'POST' }),
    locals: {},
    get clientAddress() {
      if (clientAddress === null) throw new Error('not available');

      return clientAddress;
    },
  } as unknown as APIContext;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rateLimit', () => {
  test('allows max requests per window and denies the next with 429 until the window ends', async () => {
    const limited = rateLimit({ max: 2, window: 1000 });

    expect((await guard(createContext(), [limited])).denied).toBeUndefined();
    expect((await guard(createContext(), [limited])).denied).toBeUndefined();

    const denied = (await guard(createContext(), [limited])).denied;

    expect(denied?.status).toBe(429);
    expect(await denied?.json()).toEqual({ error: { code: 'TOO_MANY_REQUESTS', message: 'too many requests' } });

    vi.setSystemTime(1_001_000);

    expect((await guard(createContext(), [limited])).denied).toBeUndefined();
  });

  test('counts per key: other addresses have their own window', async () => {
    const limited = rateLimit({ max: 1, window: 1000 });

    expect((await guard(createContext('10.0.0.1'), [limited])).denied).toBeUndefined();
    expect((await guard(createContext('10.0.0.2'), [limited])).denied).toBeUndefined();
    expect((await guard(createContext('10.0.0.1'), [limited])).denied?.status).toBe(429);
  });

  test('a custom key, and an undefined key exempts the request', async () => {
    const perPath = rateLimit({ max: 1, window: 1000, key: (ctx) => new URL(ctx.request.url).pathname });

    expect((await guard(createContext('10.0.0.1'), [perPath])).denied).toBeUndefined();
    expect((await guard(createContext('10.0.0.2'), [perPath])).denied?.status).toBe(429);

    const exempt = rateLimit({ max: 1, window: 1000, key: () => undefined });

    for (let i = 0; i < 3; i++) {
      expect((await guard(createContext(), [exempt])).denied).toBeUndefined();
    }
  });

  test('a request without a client address is not limited', async () => {
    const limited = rateLimit({ max: 1, window: 1000 });

    expect((await guard(createContext(null), [limited])).denied).toBeUndefined();
    expect((await guard(createContext(null), [limited])).denied).toBeUndefined();
  });

  test('separate guards keep separate buckets', async () => {
    const first = rateLimit({ max: 1, window: 1000 });
    const second = rateLimit({ max: 1, window: 1000 });

    expect((await guard(createContext(), [first])).denied).toBeUndefined();
    expect((await guard(createContext(), [second])).denied).toBeUndefined();
    expect((await guard(createContext(), [first])).denied?.status).toBe(429);
  });

  test('drops the buckets of expired windows once many keys are tracked, keeping live ones', async () => {
    const limited = rateLimit({ max: 1, window: 1000 });

    for (let i = 0; i < PRUNE_ABOVE - 1; i++) {
      await guard(createContext(`10.0.${Math.floor(i / 256)}.${i % 256}`), [limited]);
    }

    vi.setSystemTime(1_000_500);
    await guard(createContext('live'), [limited]);

    // the early keys expired, the live one has half its window left: a new key triggers the prune
    vi.setSystemTime(1_001_001);

    const deletions = vi.spyOn(Map.prototype, 'delete');

    await guard(createContext('trigger'), [limited]);

    expect(deletions).toHaveBeenCalledTimes(PRUNE_ABOVE - 1);
    deletions.mockRestore();

    expect((await guard(createContext('live'), [limited])).denied?.status).toBe(429);
    expect((await guard(createContext('10.0.0.0'), [limited])).denied).toBeUndefined();
  });
});
