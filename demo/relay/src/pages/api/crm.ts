import type { APIRoute } from 'astro';
import { crmRecords } from '../../relay/server';

export const GET: APIRoute = () => Response.json(crmRecords);
