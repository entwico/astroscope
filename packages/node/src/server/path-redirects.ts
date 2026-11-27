import type { IncomingMessage, ServerResponse } from 'node:http';
import { overrideRequestRoute } from '../observability/request-route.js';

/**
 * A request path with duplicate slashes (`//products`, `/docs///x`) or the wrong trailing slash
 * for the `trailingSlash` setting is not a distinct resource: astro collapses duplicates before
 * routing and renders the page as if the path were clean, and in production redirects the
 * trailing-slash mismatch while the dev server answers it with a 404 page. This handler redirects
 * both to the canonical path in one hop, before native mounts, static serving and astro, in dev
 * and prod alike — so a page, an endpoint, a public asset and a mounted handler all answer alike,
 * and every such request is logged and measured under its own route label (`duplicate-slashes`,
 * `trailing-slash`) instead of as an anonymous 301.
 *
 * Only literal slashes in the raw request target count — `%2F` stays as sent. Absolute-form
 * targets (`GET http://host/x`) and `*` are not paths and pass through untouched.
 */

export type TrailingSlash = 'always' | 'never' | 'ignore';

export type PathRedirectRoute = 'duplicate-slashes' | 'trailing-slash';

export interface PathRedirect {
  status: 301 | 308;
  location: string;
  route: PathRedirectRoute;
}

const DUPLICATE_SLASHES = /\/{2,}/g;

// astro's notion of a file path: a last segment with an extension
const FILE_EXTENSION = /\/[^/]+\.\w+$/;

/**
 * Decide whether a raw request target should redirect to its canonical path. Returns `undefined`
 * when the path is already canonical — and when the collapsed path would start with `/\`, which
 * browsers resolve as a scheme-relative url: that request is left to astro, which treats such
 * paths as internal instead of echoing them into a `Location` header.
 *
 * Runs on every request, so the canonical case (by far the most common) is decided with string
 * checks only; the regexes run on candidates.
 */
export function evaluatePathRedirect(
  url: string,
  method: string | undefined,
  trailingSlash: TrailingSlash,
): PathRedirect | undefined {
  if (!url.startsWith('/')) return undefined;

  const queryIndex = url.indexOf('?');
  const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : url.slice(queryIndex);

  const collapsed = pathname.includes('//') ? pathname.replaceAll(DUPLICATE_SLASHES, '/') : pathname;

  if (collapsed.startsWith('/\\')) return undefined;

  const canonical = applyTrailingSlash(collapsed, trailingSlash);

  if (canonical === pathname) return undefined;

  return {
    status: method === 'GET' || method === 'HEAD' ? 301 : 308,
    location: canonical + query,
    route: collapsed === pathname ? 'trailing-slash' : 'duplicate-slashes',
  };
}

function applyTrailingSlash(pathname: string, trailingSlash: TrailingSlash): string {
  const hasSlash = pathname.endsWith('/');

  if (trailingSlash === 'never') {
    return hasSlash && pathname !== '/' && !isInternalPath(pathname) ? pathname.slice(0, -1) : pathname;
  }

  if (trailingSlash === 'always') {
    return hasSlash || isInternalPath(pathname) || FILE_EXTENSION.test(pathname) ? pathname : `${pathname}/`;
  }

  return pathname;
}

const INTERNAL_PREFIXES = new Set(['_', '@', '.']);

// astro's internal urls (`/_astro/`, `/@vite/`, `/.well-known/`) are left as they are. astro counts
// a leading `//` or `/\` too: neither gets here, duplicates are collapsed and `/\` returned early
function isInternalPath(pathname: string): boolean {
  return INTERNAL_PREFIXES.has(pathname.charAt(1));
}

/**
 * Redirect a request whose path is not canonical. Returns `false` when the request needs no
 * redirect — the caller continues with mounts, static files and astro.
 */
export function redirectPath(req: IncomingMessage, res: ServerResponse, trailingSlash: TrailingSlash): boolean {
  const redirect = evaluatePathRedirect(req.url ?? '', req.method, trailingSlash);

  if (!redirect) return false;

  overrideRequestRoute(redirect.route);

  res.writeHead(redirect.status, { location: redirect.location });
  res.end();

  return true;
}
