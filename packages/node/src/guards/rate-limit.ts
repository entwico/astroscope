import { type Guard, type GuardContext, defineGuard, deny } from './guard.js';

export type RateLimitOptions = {
  /** requests allowed per key within the window */
  max: number;
  /** window length in milliseconds */
  window: number;
  /**
   * What the limit is counted against; defaults to the client address. Return `undefined` to
   * exempt a request.
   */
  key?: ((ctx: GuardContext) => string | undefined) | undefined;
  /** the guard's name in denials and logs; default `rate-limit` */
  name?: string | undefined;
};

type Bucket = { count: number; resetAt: number };

/**
 * A fixed window per key, in memory and per process: the `max`-th request within `window` ms
 * still passes, the next one is denied with `TOO_MANY_REQUESTS` (429) until the window ends.
 * Per process means per pod; the total across replicas is still bounded, just by that factor.
 * Put it first in a guard list so a flood is refused before any guard that costs something
 * (a captcha verification, a database lookup) runs.
 */
export function rateLimit(options: RateLimitOptions): Guard {
  // every window has the same length, so the map's insertion order is the order the windows
  // end in: the expired buckets are a prefix, dropped whenever a new window starts
  const buckets = new Map<string, Bucket>();
  const key = options.key ?? clientAddress;

  return defineGuard({
    name: options.name ?? 'rate-limit',
    check: (ctx) => {
      const id = key(ctx);

      if (id === undefined) return;

      const now = Date.now();
      const bucket = buckets.get(id);

      if (bucket && bucket.resetAt > now) {
        if (bucket.count >= options.max) {
          deny('TOO_MANY_REQUESTS', 'too many requests');
        }

        bucket.count += 1;

        return;
      }

      evictExpired(buckets, now);

      // set() keeps the position of an existing key, so an expired bucket the eviction left
      // behind (a clock that went backwards) must move to the end explicitly
      if (bucket) buckets.delete(id);

      buckets.set(id, { count: 1, resetAt: now + options.window });
    },
  });
}

function clientAddress(ctx: GuardContext): string | undefined {
  try {
    return ctx.clientAddress;
  } catch {
    return undefined;
  }
}

function evictExpired(buckets: Map<string, Bucket>, now: number): void {
  for (const [id, bucket] of buckets) {
    if (bucket.resetAt > now) return;

    buckets.delete(id);
  }
}
