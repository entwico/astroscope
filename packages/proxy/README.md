# @astroscope/proxy

HTTP proxy for Astro — strangler fig migrations and API gateway. Gradually migrate from any backend or proxy to upstream APIs.

## Examples

- [demo/proxy](../../demo/proxy) - API proxy to JSONPlaceholder
- [demo/proxy-migration](../../demo/proxy-migration) - Strangler fig migration pattern

## Why?

Astro has no built-in proxy support ([roadmap discussion #665](https://github.com/withastro/roadmap/discussions/665)). This package adds it, for two patterns:

- **Strangler fig migration** - Gradually migrate any website to Astro - WordPress, Rails, Django, .NET, PHP, or anything else. New Astro pages take precedence while unhandled requests fall through to your existing site.
- **Standalone gateway** - Run Astro in standalone mode while proxying to your backend APIs. No need to embed Astro as middleware in Express/Fastify just because you need features like startup hooks or API proxying - use [`@astroscope/node`](../node) for lifecycle and this package for proxying.

## Installation

```bash
npm install @astroscope/proxy
```

## Usage

### Migration (Strangler Fig)

When migrating from a legacy backend, create a catch-all route that forwards unhandled requests to the old system. As you build new pages in Astro, they take precedence over the catch-all, gradually "strangling" the legacy backend.

```ts
// src/pages/[...legacy].ts
import { createProxyHandler } from "@astroscope/proxy";

export const ALL = createProxyHandler({
  upstream: process.env.LEGACY_BACKEND!,
});
```

The `ALL` export handles all HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD).

With this setup:
- `src/pages/index.astro` → handled by Astro
- `src/pages/about.astro` → handled by Astro
- `/old-page` (no Astro file) → proxied to legacy backend

### API Proxy

For proxying specific paths to an upstream API:

```ts
// src/pages/api/[...path].ts
import { createProxyHandler } from "@astroscope/proxy";

export const ALL = createProxyHandler({
  upstream: process.env.API_UPSTREAM!,
});
```

## Options

### `upstream` (required)

The base URL of the upstream server: an origin with an optional base path, which is put in front of every proxied path (`https://api.example.com/v1` sends `/users` to `/v1/users`). Credentials, a query or a fragment in the url are rejected.

```ts
createProxyHandler({
  upstream: "https://legacy.example.com",
});
```

### `onRequest` (optional)

Called before proxying. Can modify the request or short-circuit with a Response.

Useful for adding headers, authentication, logging, rewriting URLs or blocking requests.

```ts
createProxyHandler({
  upstream: "https://api.example.com",
  onRequest: (context, targetUrl) => {
    const headers = new Headers(context.request.headers);

    headers.set("Authorization", `Bearer ${getToken()}`);

    return new Request(context.request, { headers });
  },
});
```

To short-circuit (skip proxying):

```ts
onRequest: (context, targetUrl) => {
  if (targetUrl.pathname === "/blocked") {
    return new Response("Not allowed", { status: 403 });
  }
};
```

To override the pathname (e.g., use original path before any rewrites):

```ts
onRequest: (context, targetUrl) => {
  targetUrl.pathname = context.originPathname;
};
```

`targetUrl` is the only way to re-target: the url of a returned `Request` is ignored, only its method, headers and body are used.

### `onResponse` (optional)

Called after receiving a response from upstream. Can modify the response.

```ts
createProxyHandler({
  upstream: "https://api.example.com",
  onResponse: (context, response, targetUrl) => {
    const headers = new Headers(response.headers);

    headers.set("X-Proxied-By", "astro");

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  },
});
```

### `onError` (optional)

Called when an error occurs during proxying. Can return a custom error response.

```ts
createProxyHandler({
  upstream: "https://api.example.com",
  onError: (context, error, targetUrl) => {
    console.error(`Proxy failed: ${targetUrl}`, error);

    return new Response("Service temporarily unavailable", {
      status: 503,
      headers: { "Retry-After": "30" },
    });
  },
});
```

If not provided, a failed upstream request (unreachable, timed out, reset) answers 502 and a hook that threw answers 500. A client that went away answers 499 without calling the hook.

### `client` (optional)

HTTP client configuration for connection pooling and HTTP/2.

```ts
createProxyHandler({
  upstream: "https://api.example.com",
  client: {
    pipelining: 10,            // max concurrent requests per origin (default: 10)
    allowH2: true,             // enable HTTP/2 (default: true)
    maxConcurrentStreams: 128, // HTTP/2 max streams (default: 128)
    keepAliveTimeout: 60000,   // keep-alive timeout in ms (default: 60000)
    connectTimeout: 10000,     // ms to establish the connection (default: 10000)
    headersTimeout: 60000,     // ms the upstream has to answer with headers (default: 60000, 0 = none)
    bodyTimeout: 60000,        // ms between two body chunks (default: 60000, 0 = none)
  },
});
```

A timed-out upstream answers 502 (or whatever `onError` returns); mid-body, the response stream errors.

## Forwarded headers

The upstream receives `x-forwarded-for` (`context.clientAddress` appended to an existing chain), `x-forwarded-host` and `x-forwarded-proto` (kept when a proxy in front set them); `host` is the upstream's. Anything else, a preserved `host` for instance, is an `onRequest` header change.

## Upstream references in answers

A `location` or `content-location` under the upstream url is rewritten to the site's origin, and a `set-cookie` with a `Domain` naming the upstream host loses that attribute. A different mapping is an `onResponse` header change.

## Features

- HTTP/2 support with connection pooling (via undici)
- `x-forwarded-for` / `-host` / `-proto` towards the upstream
- Upstream redirects and cookie domains mapped to the site
- Proper stream handling for large responses
- Request cancellation support
- Handles 204/304 responses correctly

## Requirements

- Node.js runtime (required by undici)
- Astro 7.x with SSR output mode

## License

MIT
