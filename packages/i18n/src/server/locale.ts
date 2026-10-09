import { i18n } from './i18n.js';

/**
 * Detect locale from Accept-Language header.
 * Returns best match from configured locales, or undefined if none match.
 */
export function detectLocale(request: Request): string | undefined {
  if (!i18n.isConfigured()) return undefined;

  const { locales } = i18n.getConfig();
  const acceptLanguage = request.headers.get('accept-language');

  if (!acceptLanguage) return undefined;

  const preferred = acceptLanguage
    .split(',')
    .map((part) => {
      // optional whitespace around `;` is legal per rfc 9110
      const [lang, q = 'q=1'] = part.split(';').map((s) => s.trim());
      const baseLang = lang?.split('-', 1)[0]?.toLowerCase();

      return {
        lang: baseLang,
        // eslint-disable-next-line unicorn/prefer-number-coercion -- Number() differs on malformed q values ('' → 0, '0.8x' → NaN)
        q: Number.parseFloat(q.replace('q=', '')),
      };
    })
    .filter((p): p is { lang: string; q: number } => !!p.lang);

  preferred.sort((a, b) => b.q - a.q);

  for (const { lang } of preferred) {
    if (locales.includes(lang)) {
      return lang;
    }
  }

  return undefined;
}
