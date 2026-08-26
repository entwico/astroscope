import { defineWormhole } from '@astroscope/wormhole';

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

export const wormholes = {
  config: defineWormhole<Config>(),
  counter: defineWormhole<Counter>(),
  // read by the page <script> only — delivered at stream end, not per island
  stats: defineWormhole<Stats>(),
  // never read on the client — must not appear in production html
  audit: defineWormhole<Audit>(),
};
