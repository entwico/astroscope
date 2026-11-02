import registry from '@astroscope/relay/registry';
import type { RelayServerConfig } from '../runtime.js';

/** the server registry: `src/relay/server.ts` of the site, or the empty one without the file */
export function getServerConfig(): RelayServerConfig {
  return registry;
}
