import EventEmitter from 'node:events';
import type { Plugin } from 'vite';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { BootModule } from './lifecycle';

vi.mock('./vite-env.js', () => ({
  ssrImport: vi.fn(),
  getAstroHotEnv: vi.fn(() => undefined),
}));

vi.mock('./lifecycle.js', () => ({
  runStartup: vi.fn(),
  runShutdown: vi.fn(),
}));

vi.mock('./watch.js', () => ({
  setupBootWatch: vi.fn(),
  installBootGate: vi.fn(),
}));

const boot = (await import('./index')).default;
const { ssrImport } = await import('./vite-env.js');
const { runStartup, runShutdown } = await import('./lifecycle.js');

const mockedSsrImport = vi.mocked(ssrImport);
const mockedRunStartup = vi.mocked(runStartup);
const mockedRunShutdown = vi.mocked(runShutdown);

/** captures the post-enforce plugin from the boot integration (the one with configureServer). */
function getConfigureServerPlugin(integration: ReturnType<typeof boot>): {
  plugin: Plugin;
  logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
} {
  const plugins: Plugin[] = [];

  const updateConfig = (config: { vite?: { plugins?: Plugin[] } }): unknown => {
    for (const p of config.vite?.plugins ?? []) plugins.push(p);

    return undefined;
  };

  const setup = integration.hooks['astro:config:setup'];

  if (!setup) throw new Error('integration missing astro:config:setup hook');

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  setup({
    command: 'dev',
    updateConfig: updateConfig as never,
    logger: logger as never,
    config: {} as never,
    addMiddleware: vi.fn() as never,
  } as never);

  const post = plugins.find((p) => p.name === '@astroscope/boot/startup');

  if (!post) throw new Error('post plugin not registered');

  return { plugin: post, logger };
}

function createMockServer() {
  const watcher = new EventEmitter();
  const httpServer = new EventEmitter() as EventEmitter & { address(): unknown };

  httpServer.address = () => ({ address: '127.0.0.1', port: 4321 });

  return {
    config: { root: '/project' },
    watcher,
    httpServer,
    moduleGraph: { getModulesByFile: vi.fn(), invalidateAll: vi.fn() },
    environments: {},
    middlewares: { use: vi.fn() },
    restart: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('integration configureServer', () => {
  test('runs startup with the freshly imported boot module', async () => {
    const oldModule: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };

    mockedSsrImport.mockResolvedValueOnce(oldModule);

    const integration = boot({ watch: true });
    const { plugin } = getConfigureServerPlugin(integration);
    const server = createMockServer();

    await (plugin.configureServer as never as (s: typeof server) => Promise<void>)(server);

    expect(mockedSsrImport).toHaveBeenCalledWith(server, '/src/boot.ts');
    expect(mockedRunStartup).toHaveBeenCalledWith(oldModule, expect.objectContaining({ dev: true }));
    expect(mockedRunShutdown).not.toHaveBeenCalled();
  });

  test('shuts down the previous module BEFORE starting the new one on a restart', async () => {
    const oldModule: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };
    const newModule: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };

    const order: string[] = [];

    mockedRunStartup.mockImplementation(async (mod) => {
      order.push(mod === oldModule ? 'startup-old' : 'startup-new');
    });

    mockedRunShutdown.mockImplementation(async (mod) => {
      order.push(mod === oldModule ? 'shutdown-old' : 'shutdown-new');
    });

    mockedSsrImport.mockResolvedValueOnce(oldModule).mockResolvedValueOnce(newModule);

    const integration = boot({ watch: true });
    const { plugin } = getConfigureServerPlugin(integration);

    // initial configureServer — starts old module
    const firstServer = createMockServer();

    await (plugin.configureServer as never as (s: typeof firstServer) => Promise<void>)(firstServer);

    // restart-induced configureServer — must shut down old first, then start new
    const secondServer = createMockServer();

    await (plugin.configureServer as never as (s: typeof secondServer) => Promise<void>)(secondServer);

    expect(order).toEqual(['startup-old', 'shutdown-old', 'startup-new']);
  });

  test('httpServer close runs shutdown for the most recently started module', async () => {
    const mod: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };

    mockedSsrImport.mockResolvedValueOnce(mod);

    const integration = boot({ watch: true });
    const { plugin } = getConfigureServerPlugin(integration);
    const server = createMockServer();

    await (plugin.configureServer as never as (s: typeof server) => Promise<void>)(server);

    server.httpServer.emit('close');

    // give the async close handler a tick to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(mockedRunShutdown).toHaveBeenCalledTimes(1);
    expect(mockedRunShutdown).toHaveBeenCalledWith(mod, expect.objectContaining({ dev: true }));
  });

  test('shutdown is idempotent — pre-restart + close handler do not double-run', async () => {
    const oldModule: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };
    const newModule: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };

    mockedSsrImport.mockResolvedValueOnce(oldModule).mockResolvedValueOnce(newModule);

    const integration = boot({ watch: true });
    const { plugin } = getConfigureServerPlugin(integration);

    const firstServer = createMockServer();

    await (plugin.configureServer as never as (s: typeof firstServer) => Promise<void>)(firstServer);

    // restart: pre-restart shutdown of OLD runs in the second configureServer
    const secondServer = createMockServer();

    await (plugin.configureServer as never as (s: typeof secondServer) => Promise<void>)(secondServer);

    expect(mockedRunShutdown).toHaveBeenCalledTimes(1);
    expect(mockedRunShutdown).toHaveBeenCalledWith(oldModule, expect.anything());

    // now vite would close the OLD httpServer as part of its restart sequence —
    // the close listener registered by the FIRST configureServer must NOT re-run shutdown.
    firstServer.httpServer.emit('close');

    await new Promise((r) => setTimeout(r, 10));

    expect(mockedRunShutdown).toHaveBeenCalledTimes(1);

    // final dev-session teardown: close the latest httpServer → shuts down NEW module
    secondServer.httpServer.emit('close');

    await new Promise((r) => setTimeout(r, 10));

    expect(mockedRunShutdown).toHaveBeenCalledTimes(2);
    expect(mockedRunShutdown).toHaveBeenLastCalledWith(newModule, expect.anything());
  });

  test('on restart-startup failure, runs best-effort shutdown of the failed module and re-throws', async () => {
    const oldModule: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };
    const newModule: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };

    mockedSsrImport.mockResolvedValueOnce(oldModule).mockResolvedValueOnce(newModule);
    mockedRunStartup.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('boom'));

    const integration = boot({ watch: true });
    const { plugin } = getConfigureServerPlugin(integration);

    await (plugin.configureServer as never as (s: ReturnType<typeof createMockServer>) => Promise<void>)(
      createMockServer(),
    );

    // restart with broken new module — pre-restart shutdown succeeds, new startup throws,
    // best-effort shutdown of new module runs, and the error is re-thrown so vite keeps
    // the old http server alive.
    await expect(
      (plugin.configureServer as never as (s: ReturnType<typeof createMockServer>) => Promise<void>)(
        createMockServer(),
      ),
    ).rejects.toThrow('boom');

    // shutdown call sequence: old (pre-restart) + new (best-effort cleanup of failed startup)
    expect(mockedRunShutdown).toHaveBeenCalledTimes(2);
    expect(mockedRunShutdown).toHaveBeenNthCalledWith(1, oldModule, expect.anything());
    expect(mockedRunShutdown).toHaveBeenNthCalledWith(2, newModule, expect.anything());
  });

  test('does not register a watcher when watch option is false', async () => {
    const mod: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };

    mockedSsrImport.mockResolvedValueOnce(mod);

    const { setupBootWatch } = await import('./watch.js');
    const mockedSetup = vi.mocked(setupBootWatch);

    mockedSetup.mockClear();

    const integration = boot({ watch: false });
    const { plugin } = getConfigureServerPlugin(integration);
    const server = createMockServer();

    await (plugin.configureServer as never as (s: typeof server) => Promise<void>)(server);

    expect(mockedSetup).not.toHaveBeenCalled();
  });

  test('logs but does not throw when shutdown rejects (sigint path)', async () => {
    const mod: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };

    mockedSsrImport.mockResolvedValueOnce(mod);
    mockedRunShutdown.mockRejectedValueOnce(new Error('shutdown blew up'));

    const integration = boot({ watch: true });
    const { plugin, logger } = getConfigureServerPlugin(integration);
    const server = createMockServer();

    await (plugin.configureServer as never as (s: typeof server) => Promise<void>)(server);

    server.httpServer.emit('close');

    // give the async close handler a tick to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('shutdown'));
  });

  test('logs but does not throw when pre-restart shutdown rejects', async () => {
    const oldModule: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };
    const newModule: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };

    mockedSsrImport.mockResolvedValueOnce(oldModule).mockResolvedValueOnce(newModule);
    // pre-restart shutdown of the OLD module rejects — must not abort the restart
    mockedRunShutdown.mockRejectedValueOnce(new Error('old shutdown blew up'));

    const integration = boot({ watch: true });
    const { plugin, logger } = getConfigureServerPlugin(integration);

    await (plugin.configureServer as never as (s: ReturnType<typeof createMockServer>) => Promise<void>)(
      createMockServer(),
    );

    // restart-induced configureServer — pre-restart shutdown rejects, but new startup must still run
    await (plugin.configureServer as never as (s: ReturnType<typeof createMockServer>) => Promise<void>)(
      createMockServer(),
    );

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('shutdown'));
    // new module's startup ran despite the old shutdown failing
    expect(mockedRunStartup).toHaveBeenLastCalledWith(newModule, expect.anything());
  });

  test('registers a watcher when watch option is true', async () => {
    const mod: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };

    mockedSsrImport.mockResolvedValueOnce(mod);

    const { setupBootWatch } = await import('./watch.js');
    const mockedSetup = vi.mocked(setupBootWatch);

    mockedSetup.mockClear();

    const integration = boot({ watch: true });
    const { plugin } = getConfigureServerPlugin(integration);
    const server = createMockServer();

    await (plugin.configureServer as never as (s: typeof server) => Promise<void>)(server);

    expect(mockedSetup).toHaveBeenCalledTimes(1);
    expect(mockedSetup).toHaveBeenCalledWith(
      server,
      'src/boot.ts',
      expect.objectContaining({ schedule: expect.any(Function) }),
    );
  });

  test('skips configureServer entirely outside dev (e.g. build, sync)', async () => {
    const integration = boot({ watch: true });
    const plugins: Plugin[] = [];
    const setup = integration.hooks['astro:config:setup'];

    if (!setup) throw new Error('missing setup hook');

    setup({
      command: 'build',
      updateConfig: ((c: { vite?: { plugins?: Plugin[] } }) => {
        for (const p of c.vite?.plugins ?? []) plugins.push(p);
      }) as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      config: {} as never,
    } as never);

    const post = plugins.find((p) => p.name === '@astroscope/boot/startup');

    if (!post) throw new Error('post plugin not registered');

    const server = createMockServer();

    await (post.configureServer as never as (s: typeof server) => Promise<void>)(server);

    expect(mockedSsrImport).not.toHaveBeenCalled();
    expect(mockedRunStartup).not.toHaveBeenCalled();
  });
});
