import { createGuardMiddleware } from '@astroscope/node/guards';
import { defineMiddleware, sequence } from 'astro:middleware';
import { admin } from './guards';
import { findUser } from './server/users';

export const SESSION_COOKIE = 'demo-user';

// the demo's "session": a cookie for the browser, a header for the tests
const session = defineMiddleware((ctx, next) => {
  const name = ctx.request.headers.get('x-demo-user') ?? ctx.cookies.get(SESSION_COOKIE)?.value;

  ctx.locals.user = name ? findUser(name) : undefined;

  return next();
});

// the admin area is denied here already, for pages and api paths alike (the denial follows the
// request); admin.astro still calls guard() for the typed user, which finds the guard already passed
export const onRequest = sequence(
  session,
  createGuardMiddleware([{ match: [{ prefix: '/admin' }, { exact: '/api/admin' }], guards: [admin] }]),
);
