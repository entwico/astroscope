import { defineWormhole } from '@astroscope/wormhole';
import { getCount, recordLoad } from './server/store';

export type Config = {
  siteName: string;
  features: string[];
};

export type Counter = {
  count: number;
};

export type Stats = {
  visitors: number;
};

export type Audit = {
  requestId: string;
};

// every handler records its run so the tests can tell which routes load what
export const wormholes = {
  config: defineWormhole({
    handler: (): Config => {
      recordLoad('config');

      return { siteName: 'Astroscope Demo', features: ['wormhole', 'react', 'ssr'] };
    },
  }),
  counter: defineWormhole({
    handler: (): Counter => {
      recordLoad('counter');

      return { count: getCount() };
    },
  }),
  // read by the page <script> only — delivered at stream end, not per island
  stats: defineWormhole({
    handler: (): Stats => {
      recordLoad('stats');

      return { visitors: 1234 };
    },
  }),
  // never read anywhere — its handler must not run in production
  audit: defineWormhole({
    handler: (): Audit => {
      recordLoad('audit');

      return { requestId: 'server-only-audit-marker' };
    },
  }),
};
