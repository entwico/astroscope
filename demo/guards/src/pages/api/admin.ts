import { defineRoute } from '@astroscope/node/guards';
import { admin } from '../../guards';

export const GET = defineRoute({
  guards: [admin],
  handler: (ctx) => Response.json({ admin: ctx.locals.user.name }),
});
