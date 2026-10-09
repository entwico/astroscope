import { defineAction } from '@astroscope/node/guards';
import { z } from 'astro/zod';
import { admin, authenticated, projectOwner } from '../guards';
import { renameProject } from '../server/projects';

export const server = {
  whoami: defineAction({
    guards: [authenticated],
    handler: (_input, ctx) => ({ name: ctx.locals.user.name }),
  }),

  promote: defineAction({
    input: z.object({ name: z.string().max(100) }),
    guards: [admin],
    handler: ({ name }, ctx) => ({ promoted: name, by: ctx.locals.user.name }),
  }),

  // `projectId` is both the guard's input and the action's own: the guard reads it, the handler keeps it
  rename: defineAction({
    input: z.object({ projectId: z.string().max(100), name: z.string().min(1).max(100) }),
    guards: [projectOwner],
    handler: ({ projectId, name }, ctx) => ({ ...renameProject(projectId, name), wasNamed: ctx.locals.project.name }),
  }),

  renameForm: defineAction({
    accept: 'form',
    input: z.object({ projectId: z.string().max(100), name: z.string().min(1).max(100) }),
    guards: [projectOwner],
    handler: ({ projectId, name }) => renameProject(projectId, name),
  }),
};
