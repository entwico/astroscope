import { createI18nMiddleware, detectLocale, i18n } from '@astroscope/i18n';

export const onRequest = createI18nMiddleware({
  locale: ({ request, url, cookies }) =>
    url.searchParams.get('locale') ??
    cookies.get('locale')?.value ??
    detectLocale(request) ??
    i18n.getConfig().defaultLocale,
});
