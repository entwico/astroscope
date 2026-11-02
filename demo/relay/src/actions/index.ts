import { defineAction } from '@astroscope/node/guards';
import { relayConsent } from '@astroscope/relay/server';
import { track } from '@astroscope/relay/track';
import { z } from 'astro/zod';
import { newsletterEvent } from '../relay/events';

export const server = {
  subscribe: defineAction({
    input: z.object({ email: z.email().max(200) }),
    handler: ({ email }) => {
      // reports to the consented server destinations in the background; the id is what the browser fires under
      const eventId = track(newsletterEvent({ email }));

      return { subscribed: email, eventId, consent: relayConsent() };
    },
  }),
};
