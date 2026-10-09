import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '../../middleware';

// the sign-in form: sets the demo session cookie, or clears it with an empty name
export const POST: APIRoute = async (ctx) => {
  const form = await ctx.request.formData();
  const name = String(form.get('as') ?? '');
  const next = String(form.get('next') ?? '/');

  if (name) {
    ctx.cookies.set(SESSION_COOKIE, name, { path: '/', httpOnly: true, sameSite: 'lax' });
  } else {
    ctx.cookies.delete(SESSION_COOKIE, { path: '/' });
  }

  return ctx.redirect(next.startsWith('/') ? next : '/');
};
