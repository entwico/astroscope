import { wormholes } from '@astroscope/wormhole';
import { z } from 'astro/zod';
import { defineAction } from 'astro:actions';
import { setCount } from '../server/store';

export const server = {
  updateCounter: defineAction({
    input: z.object({
      count: z.number(),
    }),
    handler: ({ count }) => {
      // a server read inside an action — the actions route loads exactly this wormhole
      const previous = wormholes.counter.get().count;

      return { count: setCount(count), previous };
    },
  }),
};
