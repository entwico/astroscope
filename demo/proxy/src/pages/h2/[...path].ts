import { createProxyHandler } from '@astroscope/proxy';

// an upstream that speaks http/2 only: the client negotiates it by alpn (`allowH2`, on by default)
export const ALL = createProxyHandler({
  upstream: process.env['PROXY_H2_UPSTREAM'] ?? 'https://jsonplaceholder.typicode.com',
  onRequest: (_context, targetUrl) => {
    targetUrl.pathname = targetUrl.pathname.replace(/^\/h2/, '');
  },
});
