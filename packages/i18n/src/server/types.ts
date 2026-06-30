import type { CompiledTranslations, RawTranslations, TranslationMeta } from '../shared/types.js';

/**
 * Fallback behavior when translation is missing
 */
export type FallbackBehavior =
  'key' | 'fallback' | 'throw' | ((key: string, meta?: TranslationMeta | undefined) => string);

/**
 * Request-scoped i18n context
 */
export type I18nContext = {
  locale: string;
  // compiled translations for t()
  translations: CompiledTranslations;
  // raw translations for rich()
  rawTranslations: RawTranslations;
  fallback: FallbackBehavior;
};
