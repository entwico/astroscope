import { createI18nMiddleware, detectLocale, i18n } from '@astroscope/i18n';
import type { MiddlewareHandler } from 'astro';
import { sequence } from 'astro:middleware';

// a cms-style router ahead of the i18n middleware: `/rewritten` is served by the
// deferred page through `next(url)`. astro copies the request on such a rewrite,
// once per nesting level of `sequence`, so this is the path where per-request
// state keyed on the request object would go missing
const rewrite: MiddlewareHandler = (ctx, next) => (ctx.url.pathname === '/rewritten' ? next('/deferred') : next());

export const onRequest = sequence(
  rewrite,
  createI18nMiddleware({
    locale: ({ request, url, cookies }) =>
      url.searchParams.get('locale') ??
      cookies.get('locale')?.value ??
      detectLocale(request) ??
      i18n.getConfig().defaultLocale,
  }),
);
