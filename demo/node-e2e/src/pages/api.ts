import { log } from '@astroscope/node/log';
import type { APIRoute } from 'astro';
import { getSingleton } from '../server/singleton';

export const GET: APIRoute = () => {
  log.info('api handled');

  return Response.json({ state: getSingleton() });
};

export const POST: APIRoute = () => {
  return Response.json({ state: getSingleton(), method: 'POST' });
};
