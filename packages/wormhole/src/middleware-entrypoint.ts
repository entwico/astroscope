import { exclude } from 'virtual:@astroscope/wormhole/config';
import { createWormholeMiddleware } from './middleware.js';

export const onRequest = createWormholeMiddleware({ exclude: exclude ?? undefined });
