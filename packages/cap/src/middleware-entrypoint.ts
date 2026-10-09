import { path } from 'virtual:@astroscope/cap/config';
import { createCapMiddleware } from './middleware.js';

export const onRequest = createCapMiddleware({ path });
