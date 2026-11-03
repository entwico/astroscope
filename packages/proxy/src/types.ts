import type { APIContext } from 'astro';

/**
 * HTTP client configuration options
 */
export interface ClientOptions {
  /**
   * Max concurrent requests per origin
   * @default 10
   */
  pipelining?: number | undefined;

  /**
   * Enable HTTP/2 support
   * @default true
   */
  allowH2?: boolean | undefined;

  /**
   * Max concurrent streams for HTTP/2
   * @default 128
   */
  maxConcurrentStreams?: number | undefined;

  /**
   * Keep-alive timeout in milliseconds
   * @default 60000
   */
  keepAliveTimeout?: number | undefined;

  /**
   * Time to establish the upstream connection, in milliseconds
   * @default 10000
   */
  connectTimeout?: number | undefined;

  /**
   * Time the upstream has to send its response headers, in milliseconds; 0 disables it
   * @default 60000
   */
  headersTimeout?: number | undefined;

  /**
   * Time between two body chunks from the upstream, in milliseconds; 0 disables it
   * @default 60000
   */
  bodyTimeout?: number | undefined;
}

/**
 * Options for configuring the proxy handler
 */
export interface ProxyOptions {
  /**
   * Upstream URL to proxy requests to (e.g., "https://legacy.example.com")
   */
  upstream: string;

  /**
   * HTTP client configuration
   */
  client?: ClientOptions | undefined;

  /**
   * Called before proxying the request.
   * Can modify the request, return a Response to short-circuit, or return void to continue.
   * The target is `targetUrl` (mutable); the url of a returned Request is ignored.
   */
  onRequest?:
    | ((context: APIContext, targetUrl: URL) => Request | Response | void | Promise<Request | Response | void>)
    | undefined;

  /**
   * Called after receiving a successful response from upstream.
   * Can modify the response or return void to use the original.
   */
  onResponse?:
    | ((context: APIContext, response: Response, targetUrl: URL) => Response | void | Promise<Response | void>)
    | undefined;

  /**
   * Called when an error occurs during proxying — the upstream request failed (default
   * answer 502) or a hook threw (default answer 500).
   * Can return a custom error response or void for the default.
   */
  onError?:
    ((context: APIContext, error: Error, targetUrl: URL) => Response | void | Promise<Response | void>) | undefined;
}
