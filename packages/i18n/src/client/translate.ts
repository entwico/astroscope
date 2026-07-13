import { compileMessage, formatMessageToParts } from '../shared/compiler.js';
import { normalizeMeta } from '../shared/meta.js';
import { type RichComponents, partsToNodes } from '../shared/rich.js';
import type { CompiledTranslation, TranslateFunction, TranslationMeta } from '../shared/types.js';
import { getI18nState } from './state.js';

const cache = new Map<string, CompiledTranslation>();

export function getLocale(): string {
  return getI18nState()?.locale ?? '';
}

/**
 * Client-side translate function
 *
 * Reads from window.__i18n__.translations (injected per-chunk).
 * In production, translations are always loaded before component code runs
 * via the chunk loader injected by the Vite plugin.
 *
 * Call patterns:
 * - Development: t('key', 'fallback') or t('key', 'fallback', values)
 * - Production: t('key') or t('key', undefined, values)
 *
 * Falls back to meta.fallback (dev) or key (prod) when translation is missing.
 */
export const t: TranslateFunction = ((
  key: string,
  meta?: TranslationMeta | string,
  values?: Record<string, unknown>,
): string => {
  const normalizedMeta: TranslationMeta = meta ? normalizeMeta(meta) : { fallback: '' };

  const state = getI18nState();
  const locale = state?.locale ?? '';

  // look up raw translation
  const raw = state?.translations[key];

  if (!raw) {
    // translation missing: use fallback (dev) or key (prod)
    if (normalizedMeta.fallback) {
      let compiled = cache.get(`__fallback__${key}`);

      if (!compiled) {
        compiled = compileMessage(locale, normalizedMeta.fallback);
        cache.set(`__fallback__${key}`, compiled);
      }

      return compiled(values);
    }

    // production: return key as-is
    return key;
  }

  // check cache
  let compiled = cache.get(key);

  if (!compiled) {
    compiled = compileMessage(locale, raw);
    cache.set(key, compiled);
  }

  return compiled(values);
}) as TranslateFunction;

/**
 * Client-side rich text translation function
 *
 * Parses MF2 markup syntax and applies component callbacks to wrap content.
 * Works with any JSX runtime (React, Preact, etc.).
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

  const state = getI18nState();

  // look up raw translation, fall back to meta.fallback or key
  const raw = state?.translations[key] || normalizedMeta.fallback || key;

  const parts = formatMessageToParts(state?.locale ?? '', raw, values);

  return partsToNodes(parts, components ?? {});
}
