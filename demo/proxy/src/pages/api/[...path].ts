import { createProxyHandler } from '@astroscope/proxy';

// the tests point this at an in-process upstream; the demo itself talks to a public api
export const ALL = createProxyHandler({
  upstream: process.env['PROXY_UPSTREAM'] ?? 'https://jsonplaceholder.typicode.com',
  onRequest: (context, targetUrl) => {
    targetUrl.pathname = targetUrl.pathname.replace(/^\/api/, '');
    console.log(`Proxying: ${context.request.method} ${targetUrl}`);
  },
  onResponse: (_context, response, targetUrl) => {
    console.log(`Response: ${response.status} from ${targetUrl}`);
  },
});
