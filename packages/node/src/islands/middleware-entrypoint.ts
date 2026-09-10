import { manifest } from 'virtual:@astroscope/node/islands-manifest';
import { createIslandsMiddleware } from './middleware.js';
import { installRouteIslands } from './routes.js';

installRouteIslands(manifest);

export const onRequest = createIslandsMiddleware(manifest);
