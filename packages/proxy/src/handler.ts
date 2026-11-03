import type { APIContext } from 'astro';
import { type Agent, type Dispatcher, request as undiciRequest } from 'undici';
import { createHttpAgent } from './client.js';
import type { ProxyOptions } from './types.js';

/**
 * Creates an Astro API route handler that proxies requests to an upstream server.
 *
 * @example
 * ```ts
 * // src/pages/[...legacy].ts
 * import { createProxyHandler } from '@astroscope/proxy';
 *
 * export const ALL = createProxyHandler({
 *   upstream: process.env.LEGACY_UPSTREAM!,
 * });
 * ```
 */
export function createProxyHandler(options: ProxyOptions) {
  const upstreamUrl = parseUpstream(options.upstream);
  const basePath = upstreamUrl.pathname.replace(/\/$/, '');
  const httpAgent = createHttpAgent(options.client);

  return async (context: APIContext): Promise<Response> => {
    const { request } = context;

    const targetUrl = new URL(request.url);
    targetUrl.protocol = upstreamUrl.protocol;
    targetUrl.hostname = upstreamUrl.hostname;
    targetUrl.port = upstreamUrl.port;
    // a string prefix on purpose: url resolution would let `//host` or `..` paths leave the upstream
    targetUrl.pathname = basePath + targetUrl.pathname;

    try {
      if (options.onRequest) {
        const result = await options.onRequest(context, targetUrl);
        if (result instanceof Response) {
          return result;
        }
        if (result instanceof Request) {
          return await proxyRequest(context, result, targetUrl, upstreamUrl, httpAgent, options);
        }
      }

      return await proxyRequest(context, request, targetUrl, upstreamUrl, httpAgent, options);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      if (options.onError) {
        const result = await options.onError(context, err, targetUrl);
        if (result instanceof Response) {
          return result;
        }
      }

      // a hook of the site that threw is the site's own failure, not the upstream's
      return upstreamErrors.has(err)
        ? new Response('Upstream is down', { status: 502, headers: { 'Content-Type': 'text/plain' } })
        : new Response('Proxy hook failed', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    }
  };
}

// errors raised by the upstream request itself (unreachable, timed out, reset), as opposed to a hook
const upstreamErrors = new WeakSet<Error>();

function upstreamError(error: unknown): Error {
  const err = error instanceof Error ? error : new Error(String(error));

  upstreamErrors.add(err);

  return err;
}

/** the upstream is an origin plus a base path; anything else would be dropped silently */
function parseUpstream(upstream: string): URL {
  const url = new URL(upstream);

  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`upstream must be an origin with an optional base path, got ${upstream}`);
  }

  return url;
}

async function proxyRequest(
  context: APIContext,
  request: Request,
  targetUrl: URL,
  upstreamUrl: URL,
  httpAgent: Agent,
  options: ProxyOptions,
): Promise<Response> {
  const { method, body } = request;
  const headers = forwardableHeaders(request.headers);

  headers.set('host', targetUrl.host);
  appendForwardedHeaders(headers, context);

  let upstreamResponse;

  try {
    upstreamResponse = await undiciRequest(targetUrl, {
      method,
      headers: Object.fromEntries(headers.entries()),
      body: method !== 'GET' && method !== 'HEAD' ? (body as never) : null,
      dispatcher: httpAgent,
      signal: request.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return new Response(null, { status: 499 }); // 499 = Client Closed Request (nginx convention)
    }
    throw upstreamError(error);
  }

  const { statusCode, headers: resHeaders, body: resBody } = upstreamResponse;
  const responseHeaders = forwardableResponseHeaders(resHeaders);

  rewriteUpstreamReferences(responseHeaders, upstreamUrl, new URL(context.request.url).origin);

  if (NULL_BODY_STATUSES.has(statusCode)) {
    safeDestroyBody(resBody);

    const response = new Response(null, { status: statusCode, headers: responseHeaders });

    return maybeTransformResponse(context, response, targetUrl, options, resBody);
  }

  let response: Response;

  try {
    const stream = createBodyStream(resBody, request.signal);

    response = new Response(stream, { status: statusCode, headers: responseHeaders });
  } catch (error) {
    // a status the web Response refuses: release the upstream connection before failing
    safeDestroyBody(resBody);

    throw error;
  }

  return maybeTransformResponse(context, response, targetUrl, options, resBody);
}

// statuses a web Response refuses a body for
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

// rfc 9110 §7.6.1: headers meant for this hop only, plus whatever the client listed in `connection`;
// `expect` is answered by node already and the body arrives de-chunked, so `transfer-encoding` goes too
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'expect',
]);

function forwardableHeaders(incoming: Headers): Headers {
  const headers = new Headers(incoming);

  stripHopByHop(headers, incoming.get('connection'));

  return headers;
}

function forwardableResponseHeaders(incoming: Dispatcher.ResponseData['headers']): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(incoming)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  stripHopByHop(headers, headers.get('connection'));

  return headers;
}

/**
 * The standard forwarding headers, the way nginx writes them: the client address is
 * appended to `x-forwarded-for` (a proxy in front of astro may have written the chain
 * already — its last entry is the one to trust, and astro's `clientAddress` is skipped
 * when it is that entry already), host and proto are set from the incoming request
 * unless a proxy in front set them. The address is only as trustworthy as the
 * adapter's `clientAddress`.
 */
function appendForwardedHeaders(headers: Headers, context: APIContext): void {
  const address = clientAddressOf(context);

  if (address) {
    const chain = headers.get('x-forwarded-for');
    const last = chain?.split(',').at(-1)?.trim();

    if (!chain) {
      headers.set('x-forwarded-for', address);
    } else if (last !== address) {
      headers.set('x-forwarded-for', `${chain}, ${address}`);
    }
  }

  const incoming = new URL(context.request.url);

  if (!headers.has('x-forwarded-host')) {
    headers.set('x-forwarded-host', incoming.host);
  }

  if (!headers.has('x-forwarded-proto')) {
    headers.set('x-forwarded-proto', incoming.protocol.slice(0, -1));
  }
}

/**
 * Answers that point the browser at the upstream are pointed at the site instead:
 * an absolute `location` / `content-location` under the upstream origin and base path
 * gets the incoming origin, a `set-cookie` scoped to the upstream host with `Domain`
 * loses that attribute (the browser would reject it on the site's host). Other hosts
 * are left alone — they are not the upstream's internal name.
 */
function rewriteUpstreamReferences(headers: Headers, upstreamUrl: URL, origin: string): void {
  const basePath = upstreamUrl.pathname.replace(/\/$/, '');

  for (const name of ['location', 'content-location']) {
    const value = headers.get(name);

    if (!value) continue;

    let url: URL;

    try {
      url = new URL(value);
    } catch {
      continue;
    }

    if (url.origin !== upstreamUrl.origin) continue;

    if (basePath) {
      if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) continue;

      url.pathname = url.pathname.slice(basePath.length) || '/';
    }

    headers.set(name, origin + url.pathname + url.search + url.hash);
  }

  const cookies = headers.getSetCookie();

  if (cookies.length === 0) return;

  headers.delete('set-cookie');

  for (const cookie of cookies) {
    headers.append('set-cookie', withoutUpstreamDomain(cookie, upstreamUrl.hostname));
  }
}

function withoutUpstreamDomain(cookie: string, upstreamHost: string): string {
  return cookie
    .split(';')
    .filter((attribute, index) => {
      if (index === 0) return true;

      const [key, value] = attribute.split('=', 2);

      if (key?.trim().toLowerCase() !== 'domain') return true;

      return (value ?? '').trim().replace(/^\./, '').toLowerCase() !== upstreamHost.toLowerCase();
    })
    .join(';');
}

/** astro throws for a request without one (an adapter that sets none, a prerendered route) */
function clientAddressOf(context: APIContext): string | undefined {
  try {
    return context.clientAddress;
  } catch {
    return undefined;
  }
}

function stripHopByHop(headers: Headers, connection: string | null): void {
  for (const name of HOP_BY_HOP_HEADERS) {
    headers.delete(name);
  }

  if (connection) {
    for (const token of connection.split(',')) {
      headers.delete(token.trim());
    }
  }
}

/**
 * The upstream body as a web stream with backpressure: the body is read only while the client
 * takes chunks (paused whenever the queue is full, resumed by `pull`), destroyed when the client
 * aborts or cancels, and errored when the upstream connection breaks mid-body.
 */
function createBodyStream(resBody: Dispatcher.ResponseData['body'], signal: AbortSignal | undefined): ReadableStream {
  let settled = false;

  const settle = (): boolean => {
    if (settled) return false;

    settled = true;
    signal?.removeEventListener('abort', abort);

    return true;
  };

  const abort = () => {
    if (settle()) safeDestroyBody(resBody);
  };

  return new ReadableStream({
    start(controller) {
      signal?.addEventListener('abort', abort);

      resBody.on('data', (chunk) => {
        if (settled) return;

        controller.enqueue(chunk);

        if ((controller.desiredSize ?? 0) <= 0) {
          resBody.pause();
        }
      });

      resBody.on('end', () => {
        if (settle()) controller.close();
      });

      resBody.on('error', (error) => {
        if (!settle()) return;

        // the client is gone: nothing left to report the failure to
        if (error instanceof Error && error.name === 'AbortError') {
          controller.close();
        } else {
          controller.error(error);
        }
      });

      resBody.pause();
    },

    pull() {
      if (!settled) resBody.resume();
    },

    cancel() {
      abort();
    },
  });
}

async function maybeTransformResponse(
  context: APIContext,
  response: Response,
  targetUrl: URL,
  options: ProxyOptions,
  resBody: Dispatcher.ResponseData['body'],
): Promise<Response> {
  if (!options.onResponse) {
    return response;
  }

  let result;

  try {
    result = await options.onResponse(context, response, targetUrl);
  } catch (error) {
    // the hook failed after the upstream answered: release its connection before failing
    safeDestroyBody(resBody);

    throw error;
  }

  return result instanceof Response ? result : response;
}

function safeDestroyBody(body: Dispatcher.ResponseData['body']) {
  try {
    body.on('error', () => {
      // destroy may emit late errors after teardown
    });

    body.destroy();
  } catch {
    // body may already be destroyed
  }
}
