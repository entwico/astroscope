import { compileMessage, formatMessageToParts } from '../shared/compiler.js';
import { normalizeMeta } from '../shared/meta.js';
import { type RichComponents, partsToNodes } from '../shared/rich.js';
import type { CompiledTranslation, TranslateFunction, TranslationMeta } from '../shared/types.js';
import { getContext } from './context.js';
import { i18n } from './i18n.js';
import type { FallbackBehavior } from './types.js';

// cache for fallbacks compiled outside request context (e.g. during build)
const fallbackCache = new Map<string, CompiledTranslation>();

/**
 * Apply fallback behavior when translation is missing
 */
function applyFallback(key: string, meta: TranslationMeta, fallback: FallbackBehavior): string {
  if (typeof fallback === 'function') {
    return fallback(key, meta);
  }

  switch (fallback) {
    case 'key':
      return key;
    case 'fallback':
      return meta.fallback || key;
    case 'throw':
      throw new Error(`Missing translation for key: ${key}`);
    default:
      return meta.fallback || key;
  }
}

/**
 * Get the current locale from request context.
 * Returns defaultLocale if called outside a request (e.g. during build).
 */
export function getLocale(): string {
  const ctx = getContext();
  return ctx?.locale ?? i18n.getConfig().defaultLocale;
}

/**
 * Server-side translate function
 *
 * Call patterns:
 * - Development: t('key', 'fallback') or t('key', 'fallback', values)
 * - Production: t('key') or t('key', undefined, values)
 */
export const t: TranslateFunction = ((
  key: string,
  meta?: TranslationMeta | string,
  values?: Record<string, unknown>,
): string => {
  const normalizedMeta: TranslationMeta = meta ? normalizeMeta(meta) : { fallback: '' };

  const ctx = getContext();

  if (!ctx) {
    // no context = probably during build or outside request
    // use cached compiled fallback to avoid recompiling on every call
    const defaultLocale = i18n.getConfig().defaultLocale;
    const fallbackStr = normalizedMeta.fallback || key;
    const cacheKey = `${defaultLocale}:${fallbackStr}`;
    let compiled = fallbackCache.get(cacheKey);

    if (!compiled) {
      compiled = compileMessage(defaultLocale, fallbackStr);
      fallbackCache.set(cacheKey, compiled);
    }

    return compiled(values);
  }

  const compiled = ctx.translations[key];

  if (!compiled) {
    // translation missing, apply fallback
    const fallbackValue = applyFallback(key, normalizedMeta, ctx.fallback);

    // compile and cache the fallback for consistency
    const compiledFallback = compileMessage(ctx.locale, fallbackValue);

    ctx.translations[key] = compiledFallback;

    return compiledFallback(values);
  }

  return compiled(values);
}) as TranslateFunction;

/**
 * Server-side rich text translation function
 *
 * Parses MF2 markup syntax and applies component callbacks to wrap content.
 * Works with any JSX runtime (Astro, React during SSR, etc.).
 *
 * @param key - Translation key
 * @param meta - Fallback string or meta object with fallback (used as message template)
 * @param components - Map of tag names to component callbacks
 * @param values - Runtime interpolation values (ICU MessageFormat)
 *
 * @example
 * ```tsx
 * rich('tos', 'Read our {#link}Terms{/link}', {
 *   link: (children) => <a href="/tos">{children}</a>
 * })
 * // Returns: ['Read our ', <a href="/tos">Terms</a>]
 * ```
 */
export function rich<T = unknown>(
  key: string,
  meta?: TranslationMeta | string | undefined,
  components?: RichComponents<T> | undefined,
  values?: Record<string, unknown> | undefined,
): (string | T)[] {
  const normalizedMeta: TranslationMeta = meta ? normalizeMeta(meta) : { fallback: '' };

  const ctx = getContext();
  const locale = ctx?.locale ?? i18n.getConfig().defaultLocale;

  // get raw translation string - prefer from context, then fallback, then key
  const raw = ctx?.rawTranslations[key] || normalizedMeta.fallback || key;

  const parts = formatMessageToParts(locale, raw, values);

  return partsToNodes(parts, components ?? {});
}
