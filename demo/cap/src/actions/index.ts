import { captcha } from '@astroscope/cap/server';
import { defineAction, rateLimit } from '@astroscope/node/guards';
import { z } from 'astro/zod';

const subscribers: string[] = [];

export const server = {
  subscribe: defineAction({
    input: z.object({ email: z.email().max(200) }),
    guards: [captcha()],
    handler: ({ email }) => {
      subscribers.push(email);

      return { subscribed: email, total: subscribers.length };
    },
  }),

  // the limiter first: a flood of invented tokens is refused before any siteverify call
  contact: defineAction({
    input: z.object({ name: z.string().min(1).max(100), message: z.string().min(1).max(2000) }),
    guards: [rateLimit({ max: 3, window: 60_000 }), captcha()],
    handler: ({ name, message }) => ({ received: `${name}: ${message}` }),
  }),
};
