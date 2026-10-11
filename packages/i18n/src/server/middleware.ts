import { type ExcludePattern, RECOMMENDED_EXCLUDES, shouldExclude } from '@astroscope/node/excludes';
import { log, overrideRequestRoute } from '@astroscope/node/log';
import type { MiddlewareHandler } from 'astro';
import { runWithContext } from './context.js';
import { i18n } from './i18n.js';
import { registerI18nEmitters, setRequestLocale } from './islands-emitter.js';
import type { I18nContext } from './types.js';

export type I18nLocaleMiddlewareOptions = {
  /** patterns to skip locale context setup for; defaults to RECOMMENDED_EXCLUDES */
  exclude?: ExcludePattern[] | undefined;
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

  // {locale}/{chunkName}.{hash}.js — sliced by hand, this runs for every chunk request
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
 * Resolves the request's locale through the resolver from `i18n.configure({ locale })`
 * (the default locale when there is none or it returns `undefined`), sets up the
 * request context for `t()`, records the locale for the islands emitter, which
 * delivers the client state, and runs the rest of the chain inside that context.
 *
 * Injected by the integration as `post` middleware, after the project's own, so the
 * resolver sees whatever a session middleware put on `locals` — not part of the
 * public API.
 *
 * @internal
 */
export function createI18nLocaleMiddleware(options: I18nLocaleMiddlewareOptions = {}): MiddlewareHandler {
  registerI18nEmitters();

  const exclude = options.exclude ?? RECOMMENDED_EXCLUDES;

  return (ctx, next) => {
    if (shouldExclude(ctx, exclude)) {
      return next();
    }

    if (!i18n.isConfigured()) {
      log.error('i18n not configured, passing through');

      return next();
    }

    const config = i18n.getConfig();
    const locale = config.locale?.(ctx) ?? config.defaultLocale;

    // the islands emitter runs while the response streams, outside this ALS scope
    setRequestLocale(ctx, locale);

    const context: I18nContext = {
      locale,
      translations: i18n.getCompiledTranslations(locale),
      rawTranslations: i18n.getTranslations(locale),
      fallback: config.fallback,
    };

    return runWithContext(context, () => next());
  };
}
