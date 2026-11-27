import type { ViteDevServer } from 'vite';
import { describe, expect, test, vi } from 'vitest';
import { createDevRequestPlugin } from './request-handler';

describe('createDevRequestPlugin', () => {
  test('puts the handler in front of the middlewares already on the stack, from the post hook', () => {
    const handle = vi.fn();
    const plugin = createDevRequestPlugin(handle);
    const astro = { route: '', handle: vi.fn() };
    const server = { middlewares: { stack: [astro] } } as unknown as ViteDevServer;
    const configureServer = plugin.configureServer as unknown as (server: ViteDevServer) => () => void;

    const install = configureServer(server);

    // astro unshifts its own middlewares from its returned function: installing any earlier would land behind them
    expect(plugin.enforce).toBe('post');
    expect(server.middlewares.stack).toEqual([astro]);

    install();

    expect(server.middlewares.stack).toEqual([{ route: '', handle }, astro]);
  });
});
