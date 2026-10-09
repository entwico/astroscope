import { captcha } from '@astroscope/cap/server';
import { defineRoute } from '@astroscope/node/guards';

// the guard reads `_cap` from the json or form body
export const POST = defineRoute({
  guards: [captcha()],
  handler: () => Response.json({ received: true }),
});
