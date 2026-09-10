import type { APIRoute } from 'astro';
import { getLoads } from '../../server/store';

export const GET: APIRoute = () => Response.json(getLoads());
