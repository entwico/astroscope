import type { APIRoute } from 'astro';

/**
 * Replaces the `/_image` endpoint when image processing is disabled. As far as
 * clients are concerned the endpoint does not exist, so requests answer 404 —
 * a 400 would advertise a live processing surface behind the route.
 */
export const GET: APIRoute = () => new Response(null, { status: 404 });
