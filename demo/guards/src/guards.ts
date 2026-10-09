import { defineGuard, deny } from '@astroscope/node/guards';
import { z } from 'astro/zod';
import { findProject } from './server/projects';

/** proves `locals.user`; a page without one is sent to sign in */
export const authenticated = defineGuard({
  name: 'authenticated',
  check: (ctx) => ({ user: ctx.locals.user ?? deny('UNAUTHORIZED', 'sign in first') }),
  page: (ctx) => ctx.redirect(`/?next=${encodeURIComponent(ctx.url.pathname)}`),
});

/** runs after `authenticated`, so `ctx.locals.user` is already required here; a page is hidden as a 404 */
export const admin = authenticated.extend({
  name: 'admin',
  check: (ctx) => {
    if (!ctx.locals.user.roles.admin) deny('FORBIDDEN', 'admins only');
  },
  page: (ctx) => ctx.rewrite('/404'),
});

/** needs `projectId` from the request, loads the project once and proves it for the handler */
export const projectOwner = authenticated.extend({
  name: 'projectOwner',
  input: { projectId: z.string() },
  check: (ctx, { projectId }) => {
    const project = findProject(projectId) ?? deny('NOT_FOUND', 'no such project');

    if (project.owner !== ctx.locals.user.name) deny('FORBIDDEN', 'not your project');

    return { project };
  },
});
