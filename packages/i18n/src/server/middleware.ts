import { type ExcludePattern, RECOMMENDED_EXCLUDES, shouldExclude } from '@astroscope/node/excludes';
import { log, overrideRequestRoute } from '@astroscope/node/log';
import type { APIContext, MiddlewareHandler } from 'astro';
import { I18N_CHUNK_PATH } from '../shared/url.js';
import { runWithContext } from './context.js';
import { i18n } from './i18n.js';
import { registerI18nEmitters, setRequestLocale } from './islands-emitter.js';
import type { I18nContext } from './types.js';

export type I18nLocaleMiddlewareOptions = {
  /** patterns to skip locale context setup for; defaults to RECOMMENDED_EXCLUDES */
  exclude?: ExcludePattern[] | undefined;
  /** the chunk endpoint's url prefix the islands emitter links to; defaults to `/_i18n/` */
  chunkPrefix?: string | undefined;
};

export type I18nChunkMiddlewareOptions = {
  /** the url prefix the chunks are served under, the site's base followed by `/_i18n/`; defaults to `/_i18n/` */
  prefix?: string | undefined;
};

// astro has no route behind the chunk endpoint, so requests would otherwise be
// logged and measured under whatever routing matched — typically `/404`
const I18N_ENDPOINT_ROUTE = '/_i18n/[locale]/[chunk]';

const CHUNK_HEADERS = {
  'Content-Type': 'text/javascript; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
};

// a url carrying the current hash is pinned for a year; any other hash (a page rendered
// before the translations changed) gets the current body uncached, so it never pins a
// body under a hash that may come back
function chunkCacheControl(locale: string, chunkName: string, hash: string): string {
  const hashes = i18n.getHashes(locale);
  const current = Object.hasOwn(hashes, chunkName) ? hashes[chunkName] : undefined;

  return current === hash ? 'public, max-age=31536000, immutable' : 'no-cache';
}

/**
 * Serve a translation chunk. Returns `undefined` when the path isn't a chunk
 * request, and the caller passes it on to astro.
 */
function createChunkResponse(pathname: string, prefix: string): Response | undefined {
  if (!pathname.startsWith(prefix)) {
    return undefined;
  }

  if (!i18n.isConfigured()) {
    log.error('i18n not configured, passing through');

    return undefined;
  }

  const path = pathname.slice(prefix.length);

  // {locale}/{chunkName}.{hash}.js — sliced by hand, this runs for every chunk request
  const slashIdx = path.indexOf('/');

  if (slashIdx === -1) {
    return undefined;
  }

  const locale = path.slice(0, slashIdx);

  // validate locale against configured locales to prevent arbitrary locale injection
  const config = i18n.getConfig();

  if (!config.locales.includes(locale)) {
    return new Response('/* unknown locale */', { status: 404, headers: CHUNK_HEADERS });
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
  const hash = withoutJs.slice(lastDotIdx + 1);
  const body = i18n.getChunkBody(locale, chunkName);

  if (!body) {
    // the name is request-controlled and stays out of the body
    return new Response('/* chunk not found */', { status: 404, headers: CHUNK_HEADERS });
  }

  return new Response(body as BodyInit, {
    status: 200,
    headers: {
      ...CHUNK_HEADERS,
      'Content-Length': String(body.byteLength),
      'Cache-Control': chunkCacheControl(locale, chunkName, hash),
    },
  });
}

/**
 * Create the i18n chunk middleware that serves translation chunks at `/_i18n/`
 * under the site's base.
 *
 * Injected by the integration as `pre` middleware (before any user middleware) —
 * not part of the public API.
 *
 * @internal
 */
export function createI18nChunkMiddleware(options: I18nChunkMiddlewareOptions = {}): MiddlewareHandler {
  const prefix = options.prefix ?? I18N_CHUNK_PATH;

  return (ctx, next) => {
    const response = createChunkResponse(ctx.url.pathname, prefix);

    if (!response) {
      return next();
    }

    // this middleware, not astro's routing, is what serves the request
    overrideRequestRoute(I18N_ENDPOINT_ROUTE);

    return response;
  };
}

// the resolver's value is request-controlled (a cookie, a url segment): anything outside the
// configured locales would get its own compiled translation set cached for the process lifetime
function resolveLocale(ctx: APIContext, config: ReturnType<typeof i18n.getConfig>): string {
  const resolved = config.locale?.(ctx);

  if (resolved === undefined) {
    return config.defaultLocale;
  }

  if (config.locales.includes(resolved)) {
    return resolved;
  }

  log.debug(`i18n: resolved locale "${resolved}" is not configured, using "${config.defaultLocale}"`);

  return config.defaultLocale;
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
  registerI18nEmitters({ chunkPrefix: options.chunkPrefix });

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
    const locale = resolveLocale(ctx, config);

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
