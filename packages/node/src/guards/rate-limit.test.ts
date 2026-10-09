import type { APIContext } from 'astro';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Guard } from './guard';
import { guard } from './pages';
import { PRUNE_ABOVE, rateLimit } from './rate-limit';

vi.mock('astro:actions', () => {
  class ActionError extends Error {
    static codeToStatus(code: string) {
      return code === 'TOO_MANY_REQUESTS' ? 429 : 500;
    }

    code: string;

    constructor({ code, message }: { code: string; message?: string }) {
      super(message ?? code);
      this.code = code;
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

/** the denial status of one guarded request, undefined when it passed */
async function attempt(ctx: APIContext, limited: Guard): Promise<number | undefined> {
  const { denied } = await guard(ctx, [limited]);

  return denied?.status;
}

describe('rateLimit', () => {
  test('allows max requests per window and denies the next with 429 until the window ends', async () => {
    const limited = rateLimit({ max: 2, window: 1000 });

    expect(await attempt(createContext(), limited)).toBeUndefined();
    expect(await attempt(createContext(), limited)).toBeUndefined();

    const { denied } = await guard(createContext(), [limited]);

    expect(denied?.status).toBe(429);
    expect(await denied?.json()).toEqual({ error: { code: 'TOO_MANY_REQUESTS', message: 'too many requests' } });

    vi.setSystemTime(1_001_000);

    expect(await attempt(createContext(), limited)).toBeUndefined();
  });

  test('counts per key: other addresses have their own window', async () => {
    const limited = rateLimit({ max: 1, window: 1000 });

    expect(await attempt(createContext('10.0.0.1'), limited)).toBeUndefined();
    expect(await attempt(createContext('10.0.0.2'), limited)).toBeUndefined();
    expect(await attempt(createContext('10.0.0.1'), limited)).toBe(429);
  });

  test('a custom key, and an undefined key exempts the request', async () => {
    const perPath = rateLimit({ max: 1, window: 1000, key: (ctx) => new URL(ctx.request.url).pathname });

    expect(await attempt(createContext('10.0.0.1'), perPath)).toBeUndefined();
    expect(await attempt(createContext('10.0.0.2'), perPath)).toBe(429);

    const exempt = rateLimit({ max: 1, window: 1000, key: () => {} });

    for (let i = 0; i < 3; i++) {
      expect(await attempt(createContext(), exempt)).toBeUndefined();
    }
  });

  test('a request without a client address is not limited', async () => {
    const limited = rateLimit({ max: 1, window: 1000 });

    expect(await attempt(createContext(null), limited)).toBeUndefined();
    expect(await attempt(createContext(null), limited)).toBeUndefined();
  });

  test('separate guards keep separate buckets', async () => {
    const first = rateLimit({ max: 1, window: 1000 });
    const second = rateLimit({ max: 1, window: 1000 });

    expect(await attempt(createContext(), first)).toBeUndefined();
    expect(await attempt(createContext(), second)).toBeUndefined();
    expect(await attempt(createContext(), first)).toBe(429);
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

    expect(await attempt(createContext('live'), limited)).toBe(429);
    expect(await attempt(createContext('10.0.0.0'), limited)).toBeUndefined();
  });
});
