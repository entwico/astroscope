import { manifest } from 'virtual:@astroscope/node/islands-manifest';
import { createIslandsMiddleware } from './middleware.js';

export const onRequest = createIslandsMiddleware(manifest);
