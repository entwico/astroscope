// @ts-expect-error virtual module provided by the integration
import { excludePatterns } from 'virtual:@astroscope/node/csrf';
import type { ExcludePattern } from '../excludes/excludes.js';
import { createCsrfMiddleware } from './middleware.js';

export const onRequest = createCsrfMiddleware(excludePatterns as ExcludePattern[]);
