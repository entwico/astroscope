/**
 * Variable definition for documentation
 */
export type VariableDef = {
  fallback?: string | undefined;
  description?: string | undefined;
};

/**
 * Metadata for a translation key - extracted at build time
 */
export type TranslationMeta = {
  fallback: string;
  variables?: Record<string, VariableDef> | undefined;
  description?: string | undefined;
};

/**
 * Compiled translation ready for runtime use
 */
export type CompiledTranslation = (values?: Record<string, unknown> | undefined) => string;

/**
 * Map of translation keys to compiled functions
 */
export type CompiledTranslations = Record<string, CompiledTranslation>;

/**
 * Raw translation strings (before compilation)
 */
export type RawTranslations = Record<string, string>;

/**
 * Client-side i18n state on window.__i18n__ — bootstrapped by the middleware
 * (script-chunk hashes in production, full translations in dev) and extended
 * per island by the islands emitter with that island's chunk hashes.
 */
export type I18nClientState = {
  locale: string;
  hashes: Record<string, string>;
  translations: Record<string, string>;
};

/**
 * Translate function
 *
 * @param key - translation key
 * @param meta - fallback string or meta object with fallback
 * @param values - runtime interpolation values (ICU MessageFormat)
 *
 * @example
 * t('checkout.title', 'Order Summary')
 * t('cart.items', '{count, plural, one {# item} other {# items}}', { count: itemCount })
 * t('cart.total', { fallback: 'Total: {amount}' }, { amount: '$49.99' })
 */
export type TranslateFunction = (
  key: string,
  meta: TranslationMeta | string,
  values?: Record<string, unknown> | undefined,
) => string;
