import type { IncomingMessage, ServerResponse } from 'node:http';
import { overrideRequestRoute } from '../observability/request-route.js';

/**
 * Duplicate slashes in a request path (`//weine`, `/seminare///x`) are not
 * a distinct resource: astro collapses them before routing and renders the
 * page as if the path were clean, so every such spelling is duplicate
 * content. Astro itself only redirects duplicate *trailing* slashes; this
 * handler redirects the rest, before native mounts and static serving, so a
 * page, an endpoint, a public asset and a mounted handler all answer alike.
 *
 * Only literal slashes in the raw request target count — `%2F` stays as
 * sent. Absolute-form targets (`GET http://host/x`) and `*` are not paths
 * and pass through untouched.
 */

const DUPLICATE_SLASHES = /\/{2,}/g;

export interface DuplicateSlashRedirect {
  status: 301 | 308;
  location: string;
}

/**
 * Decide whether a raw request target with duplicate slashes in its path
 * should redirect to the collapsed path. Returns `undefined` when the path
 * is already clean — and when the collapsed path would start with `/\`,
 * which browsers resolve as a scheme-relative url: that request is left to
 * astro, which treats such paths as internal instead of echoing them into
 * a `Location` header.
 */
export function evaluateDuplicateSlashes(url: string, method: string | undefined): DuplicateSlashRedirect | undefined {
  if (!url.startsWith('/')) return undefined;

  const queryIndex = url.indexOf('?');
  const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex);

  if (!pathname.includes('//')) return undefined;

  const collapsed = pathname.replace(DUPLICATE_SLASHES, '/');

  if (collapsed.startsWith('/\\')) return undefined;

  return {
    status: method === 'GET' || method === 'HEAD' ? 301 : 308,
    location: queryIndex === -1 ? collapsed : collapsed + url.slice(queryIndex),
  };
}

/**
 * Redirect a request whose path carries duplicate slashes to the collapsed
 * path. Returns `false` when the request needs no redirect — the caller
 * continues with mounts, static files and astro.
 */
export function redirectDuplicateSlashes(req: IncomingMessage, res: ServerResponse): boolean {
  const redirect = evaluateDuplicateSlashes(req.url ?? '', req.method);

  if (!redirect) return false;

  overrideRequestRoute('duplicate-slashes');

  res.writeHead(redirect.status, { location: redirect.location });
  res.end();

  return true;
}
