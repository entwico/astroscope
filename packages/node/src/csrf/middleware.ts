import type { MiddlewareHandler } from 'astro';
import { type ExcludePattern, shouldExclude } from '../excludes/excludes.js';

const FORBIDDEN_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF protection middleware: compares the request's Origin header against
 * `context.url.origin` for state-changing methods. Replaces Astro's built-in
 * `security.checkOrigin`, adding path exclusions.
 */
export function createCsrfMiddleware(exclude: ExcludePattern[]): MiddlewareHandler {
  return (context, next) => {
    if (shouldExclude(context, exclude)) {
      return next();
    }

    if (!FORBIDDEN_METHODS.has(context.request.method)) {
      return next();
    }

    const origin = context.request.headers.get('origin');

    if (!origin || origin !== context.url.origin) {
      return new Response(`Cross-site ${context.request.method} request forbidden`, { status: 403 });
    }

    return next();
  };
}
