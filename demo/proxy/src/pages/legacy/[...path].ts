import { createProxyHandler } from '@astroscope/proxy';

// the strangler fig's other side: a legacy backend that may be gone, answered with a 502
export const ALL = createProxyHandler({
  upstream: process.env['PROXY_LEGACY_UPSTREAM'] ?? 'http://127.0.0.1:9',
  onRequest: (_context, targetUrl) => {
    targetUrl.pathname = targetUrl.pathname.replace(/^\/legacy/, '');
  },
});
