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
  const upstreamUrl = new URL(options.upstream);
  const httpAgent = createHttpAgent(options.client);

  return async (context: APIContext): Promise<Response> => {
    const { request } = context;

    const targetUrl = new URL(request.url);
    targetUrl.protocol = upstreamUrl.protocol;
    targetUrl.hostname = upstreamUrl.hostname;
    targetUrl.port = upstreamUrl.port;

    try {
      if (options.onRequest) {
        const result = await options.onRequest(context, targetUrl);
        if (result instanceof Response) {
          return result;
        }
        if (result instanceof Request) {
          return await proxyRequest(context, result, targetUrl, httpAgent, options);
        }
      }

      return await proxyRequest(context, request, targetUrl, httpAgent, options);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      if (options.onError) {
        const result = await options.onError(context, err, targetUrl);
        if (result instanceof Response) {
          return result;
        }
      }

      return new Response('Upstream is down', {
        status: 502,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  };
}

async function proxyRequest(
  context: APIContext,
  request: Request,
  targetUrl: URL,
  httpAgent: Agent,
  options: ProxyOptions,
): Promise<Response> {
  const { method, body, headers: reqHeaders } = request;

  const headers = new Headers(reqHeaders);
  headers.set('host', targetUrl.host);

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
    // handle client abort gracefully - return empty response since client is gone
    if (error instanceof Error && error.name === 'AbortError') {
      return new Response(null, { status: 499 }); // 499 = Client Closed Request (nginx convention)
    }
    throw error;
  }

  const { statusCode, headers: resHeaders, body: resBody } = upstreamResponse;

  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(resHeaders)) {
    if (Array.isArray(value)) {
      value.forEach((v) => responseHeaders.append(key, v));
    } else if (value != null) {
      responseHeaders.set(key, value);
    }
  }

  if (statusCode === 204 || statusCode === 304) {
    safeDestroyBody(resBody);

    const response = new Response(null, {
      status: statusCode,
      headers: responseHeaders,
    });

    return maybeTransformResponse(context, response, targetUrl, options);
  }

  let streamClosed = false;

  const cleanup = () => {
    if (!streamClosed) {
      streamClosed = true;
      request.signal?.removeEventListener('abort', cleanup);
      safeDestroyBody(resBody);
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      request.signal?.addEventListener('abort', cleanup);

      resBody.on('data', (chunk) => {
        if (!streamClosed && !request.signal?.aborted) {
          try {
            controller.enqueue(chunk);
          } catch {
            cleanup();
          }
        }
      });

      resBody.on('end', () => {
        if (!streamClosed && !request.signal?.aborted) {
          streamClosed = true;
          try {
            controller.close();
          } catch {
            // controller might already be closed due to cancellation
          }
        }
      });

      resBody.on('error', (err) => {
        cleanup();

        // don't propagate abort errors - client is gone
        if (err instanceof Error && err.name === 'AbortError') {
          try {
            controller.close();
          } catch {
            // controller might already be closed
          }

          return;
        }
        if (!streamClosed) {
          try {
            controller.error(err);
          } catch {
            // controller might already be closed
          }
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  const response = new Response(stream, { status: statusCode, headers: responseHeaders });

  return maybeTransformResponse(context, response, targetUrl, options);
}

async function maybeTransformResponse(
  context: APIContext,
  response: Response,
  targetUrl: URL,
  options: ProxyOptions,
): Promise<Response> {
  if (options.onResponse) {
    const result = await options.onResponse(context, response, targetUrl);
    if (result instanceof Response) {
      return result;
    }
  }

  return response;
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
