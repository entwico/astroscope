import type { APIRoute } from 'astro';

if (process.env['WARMUP_THROW']) {
  throw new Error('warmup canary: forced module-evaluation failure');
}

export const GET: APIRoute = () => Response.json({ ok: true });
