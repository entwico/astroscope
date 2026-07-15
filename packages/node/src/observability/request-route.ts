import { trace } from '@opentelemetry/api';
import { getRequestRecord } from './log/store.js';

/**
 * Apply a route label to the request record (final log line, request duration
 * metric) and the active server span.
 *
 * Last write wins — astro's routing stamps every pass, so a rewrite lands the
 * route that rendered. An override comes from the middleware that knows what it
 * served and outranks routing, whatever the middleware order.
 */
function applyRoute(route: string, method: string, override: boolean): void {
  const record = getRequestRecord();

  if (record) {
    if (!override && record.routeOverride) return;

    record.route = route;

    if (override) {
      record.routeOverride = true;
    }
  }

  const span = trace.getActiveSpan();

  if (span?.isRecording()) {
    span.setAttribute('http.route', route);

    if (!record?.actionName) {
      span.updateName(`${method} ${route}`);
    }
  }
}

/**
 * Report the route that actually served the current request, overriding the one
 * astro's routing matched.
 *
 * A middleware that rewrites (`next(url)`) or answers with its own response
 * serves a request astro has no page for, so routing matches `/404` and that is
 * what the request is logged and measured as — every such request collapsing
 * into one `/404` bucket in the request metrics. Calling this corrects the log
 * line, the metric and the server span name together.
 *
 * Pass a templated label rather than a concrete path, so metric cardinality
 * stays bounded. No-op outside instrumented requests.
 *
 * @example
 * ```ts
 * import { overrideRequestRoute } from '@astroscope/node/log';
 *
 * export const onRequest: MiddlewareHandler = (ctx, next) => {
 *   const page = lookupPage(ctx.url.pathname);
 *
 *   if (!page) return next();
 *
 *   overrideRequestRoute('/cms/pages/[id]');
 *
 *   return next(`/cms/pages/${page.id}`);
 * };
 * ```
 */
export function overrideRequestRoute(route: string): void {
  applyRoute(route, getRequestRecord()?.method ?? 'GET', true);
}

/**
 * Stamp the route astro's routing matched, unless it was overridden by the
 * middleware that served the request.
 * @internal
 */
export function setRequestRoute(route: string, method: string): void {
  applyRoute(route, method, false);
}
