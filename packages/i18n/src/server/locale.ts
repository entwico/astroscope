import { i18n } from './i18n.js';

type Preference = { tag: string; q: number };

const primaryOf = (tag: string): string => tag.split('-', 1)[0] ?? tag;

/**
 * Parse an Accept-Language header into tags by descending quality, lowercased. Entries
 * marked not acceptable (`q=0`) or with an unparsable quality are dropped (rfc 9110 §12.4.2).
 */
function parseAcceptLanguage(header: string): Preference[] {
  const preferences: Preference[] = [];

  for (const part of header.split(',')) {
    // optional whitespace around `;` is legal per rfc 9110
    const [tag = '', q = 'q=1'] = part.split(';').map((s) => s.trim());
    // eslint-disable-next-line unicorn/prefer-number-coercion -- Number() differs on malformed q values ('' → 0, '0.8x' → NaN)
    const quality = Number.parseFloat(q.replace('q=', ''));

    if (!tag || !(quality > 0)) continue;

    preferences.push({ tag: tag.toLowerCase(), q: quality });
  }

  return preferences.toSorted((a, b) => b.q - a.q);
}

/**
 * Detect locale from Accept-Language header.
 * Returns best match from configured locales, or undefined if none match.
 *
 * Per header entry, in quality order, a configured locale equal to the full tag wins
 * (`fr-CH` → `fr-CH`), then one sharing its primary language (`en-US` → `en`, `fr` → `fr-CH`).
 */
export function detectLocale(request: Request): string | undefined {
  if (!i18n.isConfigured()) return undefined;

  const { locales } = i18n.getConfig();
  const acceptLanguage = request.headers.get('accept-language');

  if (!acceptLanguage) return undefined;

  for (const { tag } of parseAcceptLanguage(acceptLanguage)) {
    const exact = locales.find((locale) => locale.toLowerCase() === tag);

    if (exact) return exact;

    const primary = primaryOf(tag);
    const byLanguage = locales.find((locale) => primaryOf(locale.toLowerCase()) === primary);

    if (byLanguage) return byLanguage;
  }

  return undefined;
}
