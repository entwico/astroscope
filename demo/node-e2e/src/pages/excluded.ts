import type { APIRoute } from 'astro';

export const POST: APIRoute = () => {
  return Response.json({ excluded: true });
};
