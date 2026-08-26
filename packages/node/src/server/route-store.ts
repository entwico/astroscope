import type { RouteData } from 'astro';

/**
 * The route matched for a request, stashed by the server handler before
 * rendering so middleware can tell what kind of route produced a response —
 * a `.astro` page or an endpoint that happens to return html (a proxy
 * catch-all, an html-returning `.ts` route). Keyed on `globalThis` via
 * `Symbol.for` so the vite-runner and native module instances share it —
 * same pattern as the log store.
 *
 * Absent in dev (no adapter handler) — consumers fall back to their
 * content-type gates.
 */
const STORE = Symbol.for('@astroscope/node.requestRoutes');

type Scope = { [STORE]?: WeakMap<Request, RouteData> };

function store(): WeakMap<Request, RouteData> {
  const scope = globalThis as Scope;

  return (scope[STORE] ??= new WeakMap());
}

export function setRequestRouteData(request: Request, routeData: RouteData): void {
  store().set(request, routeData);
}

export function getRequestRouteData(request: Request): RouteData | undefined {
  return store().get(request);
}
