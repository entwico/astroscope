export { default } from './integration/integration.js';
export type { I18nOptions } from './integration/types.js';

export { i18n } from './server/i18n.js';
export type { I18nConfig, LocaleResolver } from './server/i18n.js';

export { detectLocale } from './server/locale.js';

export type { FallbackBehavior } from './server/types.js';
export type { TranslationMeta, RawTranslations } from './shared/types.js';
export type { ExtractedKey, ExtractionManifest } from './extraction/types.js';
