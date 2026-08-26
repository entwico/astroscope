import type { APIRoute } from 'astro';

// mimics a proxied legacy page: an endpoint returning html, island-looking markup
// included — the islands transform must not touch non-page routes
const LEGACY_HTML =
  '<html><body><p>legacy</p>' +
  '<astro-island component-url="/_astro/Island.fake.js" client="load" opts="{}"></astro-island>' +
  '</body></html>';

export const GET: APIRoute = () =>
  new Response(LEGACY_HTML, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(LEGACY_HTML.length),
    },
  });
