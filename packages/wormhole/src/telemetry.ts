import { log } from '@astroscope/node/log';
import { DURATION_BUCKETS, createCounter, createHistogram, errorType, withSpan } from '@astroscope/node/telemetry';
import { type MaybePromise, maybeThen } from '@entwico/dash';

const SCOPE = '@astroscope/wormhole';

const handlerDuration = createHistogram('astro.wormhole.handler.duration', {
  scope: SCOPE,
  description: 'Wormhole handler execution per request',
  unit: 's',
  buckets: DURATION_BUCKETS.io,
});

const handlerFailures = createCounter('astro.wormhole.handler.failures', {
  scope: SCOPE,
  description: 'Wormhole handlers that threw',
  unit: '{handler}',
});

/**
 * Runs one handler under its own span (child of the request span — the
 * handlers run in parallel, so the trace shows which one holds the page's
 * first byte), records its duration and counts and logs a failure. A
 * synchronous handler stays synchronous.
 */
export function measureHandler<T>(name: string, run: () => MaybePromise<T>): MaybePromise<T> {
  const attributes = { 'astro.wormhole.name': name };
  const started = performance.now();

  const fail = (error: unknown): never => {
    handlerFailures.add(1, { ...attributes, 'error.type': errorType(error) });
    log.error(
      error instanceof Error ? { err: error, wormhole: name } : { reason: error, wormhole: name },
      'wormhole handler failed',
    );

    throw error;
  };

  return withSpan(`wormhole ${name}`, { scope: SCOPE, attributes }, () => {
    let result: MaybePromise<T>;

    try {
      result = run();
    } catch (error) {
      return fail(error);
    }

    return maybeThen(
      result,
      (value) => {
        handlerDuration.record((performance.now() - started) / 1000, attributes);

        return value;
      },
      fail,
    );
  });
}
