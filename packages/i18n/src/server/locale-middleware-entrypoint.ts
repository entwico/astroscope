import { exclude } from 'virtual:@astroscope/i18n/config';
import { createI18nLocaleMiddleware } from './middleware.js';

export const onRequest = createI18nLocaleMiddleware({ exclude: exclude ?? undefined });
