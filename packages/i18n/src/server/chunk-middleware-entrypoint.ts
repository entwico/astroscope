import { chunkPrefix } from 'virtual:@astroscope/i18n/config';
import { createI18nChunkMiddleware } from './middleware.js';

export const onRequest = createI18nChunkMiddleware({ prefix: chunkPrefix });
