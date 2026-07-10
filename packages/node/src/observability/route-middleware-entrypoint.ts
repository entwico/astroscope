import { trace } from '@opentelemetry/api';
import type { MiddlewareHandler } from 'astro';
import { getRequestRecord } from './log/store.js';

/**
 * Route enrichment: the native handler starts spans and request logging
 * before routing, so the route pattern is the one thing only astro knows.
 * Feeds it back into the request record (final log line, metrics) and the
 * active server span. No-op outside instrumented requests.
 */
export const onRequest: MiddlewareHandler = (ctx, next) => {
  const record = getRequestRecord();
  const route = ctx.routePattern;

  if (record && !record.route) {
    record.route = route;
  }

  const span = trace.getActiveSpan();

  if (span?.isRecording() && route) {
    span.setAttribute('http.route', route);

    if (!record?.actionName) {
      span.updateName(`${ctx.request.method} ${route}`);
    }
  }

  return next();
};
