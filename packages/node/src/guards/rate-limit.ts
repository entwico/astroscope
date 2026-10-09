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

// buckets of expired windows are dropped when the map has grown past this, so a key never
// seen again costs nothing after its window
export const PRUNE_ABOVE = 10_000;

/**
 * A fixed window per key, in memory and per process: the `max`-th request within `window` ms
 * still passes, the next one is denied with `TOO_MANY_REQUESTS` (429) until the window ends.
 * Per process means per pod; the total across replicas is still bounded, just by that factor.
 * Put it first in a guard list so a flood is refused before any guard that costs something
 * (a captcha verification, a database lookup) runs.
 */
export function rateLimit(options: RateLimitOptions): Guard {
  const buckets = new Map<string, Bucket>();
  const key = options.key ?? clientAddress;

  return defineGuard({
    name: options.name ?? 'rate-limit',
    check: (ctx) => {
      const id = key(ctx);

      if (id === undefined) return;

      const now = Date.now();
      const bucket = buckets.get(id);

      if (!bucket || bucket.resetAt <= now) {
        if (buckets.size >= PRUNE_ABOVE) prune(buckets, now);

        buckets.set(id, { count: 1, resetAt: now + options.window });

        return;
      }

      if (bucket.count >= options.max) {
        deny('TOO_MANY_REQUESTS', 'too many requests');
      }

      bucket.count += 1;
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

function prune(buckets: Map<string, Bucket>, now: number): void {
  for (const [id, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(id);
  }
}
