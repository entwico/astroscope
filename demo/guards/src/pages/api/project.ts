import { defineRoute } from '@astroscope/node/guards';
import { projectOwner } from '../../guards';

// the guard reads `projectId` from the json or form body, the handler gets the loaded project
export const POST = defineRoute({
  guards: [projectOwner],
  handler: (ctx) => Response.json(ctx.locals.project),
});
