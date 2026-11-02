import type { RelayServerConfig } from '../runtime.js';

/**
 * The empty server registry. In a site, the integration resolves `@astroscope/relay/registry` to
 * `src/relay/server.ts` when the file exists; everywhere else — a site without the file, unit tests
 * outside vite — this one answers and the server-side `track()` reports nothing.
 */
const registry: RelayServerConfig = { destinations: {} };

export default registry;
