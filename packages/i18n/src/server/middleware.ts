import { type ExcludePattern, RECOMMENDED_EXCLUDES, shouldExclude } from '@astroscope/node/excludes';
import { log, overrideRequestRoute } from '@astroscope/node/log';
import type { APIContext, MiddlewareHandler } from 'astro';
import { runWithContext } from './context.js';
import { i18n } from './i18n.js';
import { registerI18nEmitters, setRequestLocale } from './islands-emitter.js';
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
    log.error('i18n not configured, passing through');

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
 * Injected by the integration as `pre` middleware (before any user middleware) —
 * not part of the public API.
 *
 * @internal
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
 * Sets up the request context with locale and translations for `t()`, injects
 * the client i18n state into html responses, and records the locale for the
 * islands emitter. Place this after session middleware if your locale detection
 * depends on session/cookies.
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
  registerI18nEmitters();

  return (ctx, next) => {
    if (shouldExclude(ctx, options.exclude ?? RECOMMENDED_EXCLUDES)) {
      return next();
    }

    if (!i18n.isConfigured()) {
      log.error('i18n not configured, passing through');

      return next();
    }

    const locale = options.locale(ctx);

    // the islands emitter runs while the response streams, outside this ALS scope
    setRequestLocale(ctx, locale);

    const context: I18nContext = {
      locale,
      translations: i18n.getCompiledTranslations(locale),
      rawTranslations: i18n.getTranslations(locale),
      fallback: i18n.getConfig().fallback,
    };

    return runWithContext(context, () => next());
  };
}
