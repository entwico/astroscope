import { type StringPattern, matchesAny } from '@entwico/dash/match';
import type { APIContext, MiddlewareHandler } from 'astro';

/**
 * Patterns accepted by @astroscope/node exclude options. The serializable
 * subset of dash's `StringPattern` — no matcher functions, since integration
 * options cross a virtual-module boundary.
 */
export type ExcludePattern = Exclude<StringPattern, (value: string) => boolean>;

/**
 * Vite/Astro dev server paths - only relevant in development.
 */
export const DEV_EXCLUDES: ExcludePattern[] = [
  { prefix: '/@id/' },
  { prefix: '/@fs/' },
  { prefix: '/@vite/' },
  { prefix: '/src/' },
  { prefix: '/node_modules/' },
];

/**
 * Astro internal paths for static assets and image optimization.
 */
export const ASTRO_STATIC_EXCLUDES: ExcludePattern[] = [{ prefix: '/_astro/' }, { prefix: '/_image' }];

/**
 * Common static asset paths.
 */
export const STATIC_EXCLUDES: ExcludePattern[] = [
  { exact: '/favicon.ico' },
  { exact: '/robots.txt' },
  { exact: '/sitemap.xml' },
  { exact: '/browserconfig.xml' },
  { exact: '/manifest.json' },
  { exact: '/manifest.webmanifest' },
];

/**
 * Recommended excludes for middleware.
 * Includes dev paths and Astro internals.
 *
 * @example
 * ```ts
 * createI18nMiddleware({
 *   locale: (ctx) => ctx.locals.session?.locale ?? 'en',
 *   exclude: [
 *     ...RECOMMENDED_EXCLUDES,
 *     { exact: "/health" }, // your health endpoint
 *   ],
 * })
 * ```
 */
export const RECOMMENDED_EXCLUDES: ExcludePattern[] = [...DEV_EXCLUDES, ...ASTRO_STATIC_EXCLUDES];

/**
 * Check if a request should be excluded based on patterns or a function.
 */
export function shouldExclude(
  ctx: APIContext,
  exclude: readonly StringPattern[] | ((context: APIContext) => boolean) | undefined,
): boolean {
  if (!exclude) return false;

  if (typeof exclude === 'function') {
    return exclude(ctx);
  }

  return matchesAny(ctx.url.pathname, exclude);
}

/**
 * Wraps a middleware to skip execution for excluded paths.
 * Useful for third-party middlewares that don't have built-in exclude support.
 *
 * @example
 * ```ts
 * import { RECOMMENDED_EXCLUDES, withExcluded } from '@astroscope/node/excludes';
 * import { someExternalMiddleware } from 'some-package';
 *
 * export const onRequest = sequence(
 *   withExcluded(someExternalMiddleware(), [
 *     ...RECOMMENDED_EXCLUDES,
 *     { prefix: '/api/webhooks/' },
 *   ]),
 * );
 * ```
 */
export function withExcluded(
  middleware: MiddlewareHandler,
  exclude: readonly StringPattern[] | ((context: APIContext) => boolean),
): MiddlewareHandler {
  return (ctx, next) => {
    if (shouldExclude(ctx, exclude)) {
      return next();
    }

    return middleware(ctx, next);
  };
}
