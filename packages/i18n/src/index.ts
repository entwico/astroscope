export { default } from './integration/integration.js';

export { i18n } from './server/i18n.js';
export type { I18nConfig } from './server/i18n.js';

export { createI18nMiddleware } from './server/middleware.js';
export type { I18nMiddlewareOptions } from './server/middleware.js';

export { detectLocale } from './server/locale.js';

export type { FallbackBehavior } from './server/types.js';
export type { TranslationMeta, RawTranslations } from './shared/types.js';
export type { ExtractedKey, ExtractionManifest } from './extraction/types.js';
