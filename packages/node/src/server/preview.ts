import type { CreatePreviewServer } from 'astro';
import type { ServerHandle } from './server.js';

/**
 * `astro preview` support: imports the built server entry with autostart
 * disabled and starts it on the preview host/port. The full production path
 * runs — boot lifecycle, warmup, health probes, static serving.
 */
const createPreviewServer: CreatePreviewServer = async ({ serverEntrypoint, host, port }) => {
  process.env['ASTROSCOPE_NODE_AUTOSTART'] = 'disabled';

  const entry = (await import(serverEntrypoint.href)) as {
    startServer: (overrides?: { host?: string | undefined; port?: number | undefined }) => Promise<ServerHandle>;
  };

  const handle = await entry.startServer({ host, port });

  return {
    host: handle.host,
    port: handle.port,
    stop: () => handle.stop(),
    closed: () => handle.closed(),
  };
};

export default createPreviewServer;
