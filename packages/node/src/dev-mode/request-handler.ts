import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';

export type DevRequestHandler = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;

/**
 * Installs the adapter's dev request handler (request instrumentation, path redirects, native
 * mounts) ahead of astro's own connect middlewares. Astro unshifts those to the front of the
 * stack from the function its `configureServer` returns, so a plain `middlewares.use()` lands
 * behind them — behind the dev trailing-slash middleware in particular, which answers a
 * mismatching trailing slash with a 404 page before anything registered later sees it. The same
 * `enforce: 'post'` + returned-function trick as the dev gate puts this handler in front; the
 * gate's own entries, installed after this plugin's, end up ahead of it, so requests still wait
 * for a restart to finish before they are served.
 */
export function createDevRequestPlugin(handle: DevRequestHandler): Plugin {
  return {
    name: '@astroscope/node/dev-request',
    enforce: 'post',

    configureServer(server: ViteDevServer) {
      return () => {
        const middlewares = server.middlewares as unknown as {
          stack: { route: string; handle: unknown }[];
        };

        middlewares.stack.unshift({ route: '', handle });
      };
    },
  };
}
