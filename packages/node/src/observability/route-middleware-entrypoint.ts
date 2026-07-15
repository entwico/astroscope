import type { MiddlewareHandler } from 'astro';
import { setRequestRoute } from './request-route.js';

/**
 * Route enrichment: the native handler starts spans and request logging
 * before routing, so the route pattern is the one thing only astro knows.
 * Feeds it back into the request record (final log line, metrics) and the
 * active server span. A middleware that serves a route astro never matched
 * reports it itself via `overrideRequestRoute`, which wins over this. No-op
 * outside instrumented requests.
 */
export const onRequest: MiddlewareHandler = (ctx, next) => {
  if (ctx.routePattern) {
    setRequestRoute(ctx.routePattern, ctx.request.method);
  }

  return next();
};
