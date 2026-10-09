import { log } from '@astroscope/node/log';
import type { APIContext, MiddlewareHandler } from 'astro';
import { cap } from './runtime.js';
import { normalizeCapPath } from './shared.js';

export type CapMiddlewareOptions = {
  path: string;
};

// the only endpoints the browser may reach; everything else on the cap service
// (siteverify, the dashboard api) stays unreachable from the outside
const PROXIED_ENDPOINTS = new Set(['challenge', 'redeem']);

// headers cap needs: the payload description and the client for its per-ip rate limiting —
// cookies and other ambient headers never go upstream
const FORWARDED_HEADERS = ['content-type', 'accept', 'user-agent'];

/**
 * Serves the cap proxy under `path`: the browser solves the challenge against the site's own
 * origin, the site key is injected here and never appears client-side.
 */
export function createCapMiddleware(options: CapMiddlewareOptions): MiddlewareHandler {
  const path = normalizeCapPath(options.path);

  return (ctx, next) => {
    if (!ctx.url.pathname.startsWith(path)) {
      return next();
    }

    return proxy(ctx, ctx.url.pathname.slice(path.length));
  };
}

async function proxy(ctx: APIContext, endpoint: string): Promise<Response> {
  if (!PROXIED_ENDPOINTS.has(endpoint) || ctx.request.method !== 'POST') {
    return new Response('Not found', { status: 404 });
  }

  const config = cap.getConfig();

  if (!config) {
    log.error('cap is not configured — call cap.configure() in src/boot.ts');

    return Response.json({ success: false, error: 'captcha unavailable' }, { status: 503 });
  }

  const headers = new Headers();

  for (const name of FORWARDED_HEADERS) {
    const value = ctx.request.headers.get(name);

    if (value) headers.set(name, value);
  }

  const forwardedFor = ctx.request.headers.get('x-forwarded-for') ?? clientAddress(ctx);

  if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);

  try {
    const response = await fetch(`${config.baseUrl}/${config.siteKey}/${endpoint}`, {
      method: 'POST',
      headers,
      body: await ctx.request.arrayBuffer(),
    });

    return new Response(response.body, {
      status: response.status,
      headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
    });
  } catch (error) {
    log.error({ error, endpoint }, 'cap proxy request failed');

    return Response.json({ success: false, error: 'captcha unavailable' }, { status: 502 });
  }
}

function clientAddress(ctx: APIContext): string | undefined {
  try {
    return ctx.clientAddress;
  } catch {
    return undefined;
  }
}
