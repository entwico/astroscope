import type { MiddlewareHandler } from 'astro';

// a cms-style router ahead of the i18n middleware: `/rewritten` is served by the
// deferred page through `next(url)`. astro copies the request on such a rewrite,
// once per nesting level of `sequence`, so this is the path where per-request
// state keyed on the request object would go missing
export const onRequest: MiddlewareHandler = (ctx, next) =>
  ctx.url.pathname === '/rewritten' ? next('/deferred') : next();
