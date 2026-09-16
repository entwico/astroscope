import type { APIContext, RouteData } from 'astro';

/**
 * The route matched for a request, stashed by the server handler before
 * rendering so middleware can tell what kind of route produced a response —
 * a `.astro` page or an endpoint that happens to return html (a proxy
 * catch-all, an html-returning `.ts` route). Keyed on `globalThis` via
 * `Symbol.for` so the vite-runner and native module instances share it —
 * same pattern as the log store.
 *
 * Stored under the request and under its `locals` object. `locals` is the
 * one object astro hands to every middleware unchanged — `context.request`
 * is no identity for a request, as every `next(url)` rewrite replaces it
 * with a copy (once per nesting level of `sequence`).
 *
 * Absent in dev (no adapter handler) — consumers fall back to their
 * content-type gates.
 */
const STORE = Symbol.for('@astroscope/node.requestRoutes');

type Scope = { [STORE]?: WeakMap<object, RouteData> };

function store(): WeakMap<object, RouteData> {
  const scope = globalThis as Scope;

  return (scope[STORE] ??= new WeakMap());
}

export function setRequestRouteData(request: Request, locals: object, routeData: RouteData): void {
  store().set(request, routeData);
  store().set(locals, routeData);
}

/**
 * Look the route up by the api context (survives `next(url)` rewrites) or by
 * the request as the handler created it.
 */
export function getRequestRouteData(key: Request | Pick<APIContext, 'locals'>): RouteData | undefined {
  return store().get('locals' in key ? key.locals : key);
}
