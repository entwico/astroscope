import { type ExcludePattern, RECOMMENDED_EXCLUDES, shouldExclude } from '@astroscope/node/excludes';
import { overrideRequestRoute } from '@astroscope/node/log';
import type { APIContext, MiddlewareHandler } from 'astro';
import { runWithContext } from './context.js';
import { i18n } from './i18n.js';
import type { I18nContext } from './types.js';

export type I18nMiddlewareOptions = {
  locale: (ctx: APIContext) => string;
  /**
   * Patterns to exclude from locale context setup.
   * Defaults to RECOMMENDED_EXCLUDES if not provided.
   *
   * @example
   * ```ts
   * import { RECOMMENDED_EXCLUDES } from '@astroscope/node/excludes';
   *
   * // extend defaults
   * createI18nMiddleware({
   *   locale: (ctx) => ctx.locals.session?.locale ?? 'en',
   *   exclude: [...RECOMMENDED_EXCLUDES, { exact: '/health' }],
   * })
   *
   * // disable excludes entirely
   * createI18nMiddleware({
   *   locale: (ctx) => ctx.locals.session?.locale ?? 'en',
   *   exclude: [],
   * })
   * ```
   */
  exclude?: ExcludePattern[] | ((context: APIContext) => boolean) | undefined;
};

const I18N_ENDPOINT_PREFIX = '/_i18n/';

// astro has no route behind the chunk endpoint, so requests would otherwise be
// logged and measured under whatever routing matched — typically `/404`
const I18N_ENDPOINT_ROUTE = '/_i18n/[locale]/[chunk]';

/**
 * Serve a translation chunk. Returns `undefined` when the path isn't a chunk
 * request, and the caller passes it on to astro.
 */
function createChunkResponse(pathname: string): Response | undefined {
  if (!pathname.startsWith(I18N_ENDPOINT_PREFIX)) {
    return undefined;
  }

  if (!i18n.isConfigured()) {
    console.warn(`[@astroscope/i18n] not configured, passing through: ${pathname}`);

    return undefined;
  }

  const path = pathname.slice(I18N_ENDPOINT_PREFIX.length);

  // attempt to parse as efficient as possible
  // expected path format: {locale}/{chunkName}.{hash}.js
  // avoiding regex or split for performance
  const slashIdx = path.indexOf('/');

  if (slashIdx === -1) {
    return undefined;
  }

  const locale = path.slice(0, slashIdx);

  // validate locale against configured locales to prevent arbitrary locale injection
  const config = i18n.getConfig();

  if (!config.locales.includes(locale)) {
    return new Response('/* unknown locale */', {
      status: 404,
      headers: { 'Content-Type': 'application/javascript' },
    });
  }

  const rest = path.slice(slashIdx + 1);

  if (!rest.endsWith('.js')) {
    return undefined;
  }

  const withoutJs = rest.slice(0, -3);
  const lastDotIdx = withoutJs.lastIndexOf('.');

  if (lastDotIdx === -1) {
    return undefined;
  }

  const chunkName = withoutJs.slice(0, lastDotIdx);
  const body = i18n.getChunkBody(locale, chunkName);

  if (!body) {
    return new Response(`/* chunk not found: ${chunkName} */`, {
      status: 404,
      headers: { 'Content-Type': 'application/javascript' },
    });
  }

  return new Response(body as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

/**
 * Create the i18n chunk middleware that serves translation chunks at `/_i18n/` endpoints.
 *
 * Place this early in your middleware sequence (before session/auth)
 * to avoid unnecessary overhead for static translation requests.
 *
 * @example
 * ```typescript
 * // src/middleware.ts
 * import { sequence } from 'astro:middleware';
 * import { createI18nChunkMiddleware, createI18nMiddleware } from '@astroscope/i18n';
 *
 * export const onRequest = sequence(
 *   createI18nChunkMiddleware(),  // early: serves /_i18n/ chunks
 *   sessionMiddleware,
 *   createI18nMiddleware({ locale: (ctx) => ... }),  // after session
 * );
 * ```
 */
export function createI18nChunkMiddleware(): MiddlewareHandler {
  return (ctx, next) => {
    const response = createChunkResponse(ctx.url.pathname);

    if (!response) {
      return next();
    }

    // this middleware, not astro's routing, is what serves the request
    overrideRequestRoute(I18N_ENDPOINT_ROUTE);

    return response;
  };
}

/**
 * Create the i18n locale middleware.
 *
 * Sets up the request context with locale and translations for use by
 * `t()` and `<I18nScript />`. Place this after session middleware if
 * your locale detection depends on session/cookies.
 *
 * @example
 * ```typescript
 * import { createI18nMiddleware, detectLocale, i18n } from '@astroscope/i18n';
 *
 * export const i18nMiddleware = createI18nMiddleware({
 *   locale: (ctx) =>
 *     ctx.cookies.get('locale')?.value ??
 *     detectLocale(ctx.request) ??
 *     i18n.getConfig().defaultLocale,
 * });
 * ```
 */
export function createI18nMiddleware(options: I18nMiddlewareOptions): MiddlewareHandler {
  return (ctx, next) => {
    if (shouldExclude(ctx, options.exclude ?? RECOMMENDED_EXCLUDES)) {
      return next();
    }

    if (!i18n.isConfigured()) {
      console.warn(`[@astroscope/i18n] not configured, passing through: ${ctx.url.pathname}`);

      return next();
    }

    const locale = options.locale(ctx);

    const context: I18nContext = {
      locale,
      translations: i18n.getCompiledTranslations(locale),
      rawTranslations: i18n.getTranslations(locale),
      fallback: i18n.getConfig().fallback,
    };

    return runWithContext(context, () => next());
  };
}
