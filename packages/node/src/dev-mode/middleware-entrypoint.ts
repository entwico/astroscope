import type { MiddlewareHandler } from 'astro';
import { GEN_HEADER, getCurrentGeneration, recordStaleError } from './generation.js';

/**
 * Wrap every request so errors thrown by a stale render (one whose user
 * singletons were torn down mid-render by a dev-server restart) are swallowed
 * instead of polluting the logs. The request was stamped with the generation
 * it entered under by the integration's connect middleware; if that doesn't
 * match the current generation, the error is recorded for an aggregated log
 * line and a 503 is returned (the client socket is usually gone too).
 */
export const onRequest: MiddlewareHandler = async (context, next) => {
  const stamp = context.request.headers.get(GEN_HEADER);

  try {
    return await next();
  } catch (err) {
    if (stamp != null && Number(stamp) !== getCurrentGeneration()) {
      recordStaleError();

      return new Response(null, { status: 503 });
    }

    throw err;
  }
};
