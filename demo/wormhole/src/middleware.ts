import { createWormholeMiddleware } from '@astroscope/wormhole/server';
import { getCount } from './server/store';

export const onRequest = createWormholeMiddleware({
  values: () => ({
    config: { siteName: 'Astroscope Demo', features: ['wormhole', 'react', 'ssr'] },
    counter: { count: getCount() },
    stats: { visitors: 1234 },
    audit: { requestId: 'server-only-audit-marker' },
  }),
});
