import EventEmitter from 'node:events';
import type { Plugin } from 'vite';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { BootModule } from '../lifecycle/lifecycle';

vi.mock('./vite-env.js', () => ({
  ssrImport: vi.fn(),
  getAstroHotEnv: vi.fn(() => undefined),
}));

vi.mock('../lifecycle/lifecycle.js', () => ({
  runStartup: vi.fn(),
  runShutdown: vi.fn(),
}));

vi.mock('./watch.js', () => ({
  setupBootWatch: vi.fn(),
  installBootGate: vi.fn(),
  installGenStamp: vi.fn(),
}));

const { createDevMachinery } = await import('./machinery');
const { ssrImport } = await import('./vite-env.js');
const { runStartup, runShutdown } = await import('../lifecycle/lifecycle.js');

const mockedSsrImport = vi.mocked(ssrImport);
const mockedRunStartup = vi.mocked(runStartup);
const mockedRunShutdown = vi.mocked(runShutdown);

type MachineryOptions = Partial<Parameters<typeof createDevMachinery>[0]>;

function getStartupPlugin(options: MachineryOptions = {}): {
  plugin: Plugin;
  logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
} {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const plugins = createDevMachinery({
    entry: 'src/boot.ts',
    watch: true,
    watchEntries: [],
    prepare: async () => {},
    logger,
    getConfig: () => null,
    ...options,
  });

  const plugin = plugins.find((p) => p.name === '@astroscope/node/dev-startup');

  if (!plugin) throw new Error('startup plugin not registered');

  return { plugin, logger };
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

type ConfigureServer = (server: ReturnType<typeof createMockServer>) => Promise<void>;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dev machinery configureServer', () => {
  test('runs startup with the freshly imported boot module', async () => {
    const oldModule: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };

    mockedSsrImport.mockResolvedValueOnce(oldModule);

    const { plugin } = getStartupPlugin();
    const server = createMockServer();

    await (plugin.configureServer as never as ConfigureServer)(server);

    expect(mockedSsrImport).toHaveBeenCalledWith(server, '/src/boot.ts');
    expect(mockedRunStartup).toHaveBeenCalledWith(oldModule, expect.objectContaining({ dev: true }));
    expect(mockedRunShutdown).not.toHaveBeenCalled();
  });

  test('runs prepare before importing and starting the boot module', async () => {
    const order: string[] = [];
    const mod: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };

    mockedSsrImport.mockImplementation(async () => {
      order.push('import');

      return mod;
    });
    mockedRunStartup.mockImplementation(async () => {
      order.push('startup');
    });

    const { plugin } = getStartupPlugin({
      prepare: async () => {
        order.push('prepare');
      },
    });

    await (plugin.configureServer as never as ConfigureServer)(createMockServer());

    expect(order).toEqual(['prepare', 'import', 'startup']);
  });

  test('runs startup without a boot module when no entry is configured', async () => {
    const { plugin } = getStartupPlugin({ entry: undefined });

    await (plugin.configureServer as never as ConfigureServer)(createMockServer());

    expect(mockedSsrImport).not.toHaveBeenCalled();
    expect(mockedRunStartup).toHaveBeenCalledWith({}, expect.objectContaining({ dev: true }));
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

    const { plugin } = getStartupPlugin();

    // initial configureServer — starts old module
    await (plugin.configureServer as never as ConfigureServer)(createMockServer());

    // restart-induced configureServer — must shut down old first, then start new
    await (plugin.configureServer as never as ConfigureServer)(createMockServer());

    expect(order).toEqual(['startup-old', 'shutdown-old', 'startup-new']);
  });

  test('httpServer close runs shutdown for the most recently started module', async () => {
    const mod: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };

    mockedSsrImport.mockResolvedValueOnce(mod);

    const { plugin } = getStartupPlugin();
    const server = createMockServer();

    await (plugin.configureServer as never as ConfigureServer)(server);

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

    const { plugin } = getStartupPlugin();

    const firstServer = createMockServer();

    await (plugin.configureServer as never as ConfigureServer)(firstServer);

    // restart: pre-restart shutdown of OLD runs in the second configureServer
    const secondServer = createMockServer();

    await (plugin.configureServer as never as ConfigureServer)(secondServer);

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

    const { plugin } = getStartupPlugin();

    await (plugin.configureServer as never as ConfigureServer)(createMockServer());

    // restart with broken new module — pre-restart shutdown succeeds, new startup throws,
    // best-effort shutdown of new module runs, and the error is re-thrown so vite keeps
    // the old http server alive.
    await expect((plugin.configureServer as never as ConfigureServer)(createMockServer())).rejects.toThrow('boom');

    // shutdown call sequence: old (pre-restart) + new (best-effort cleanup of failed startup)
    expect(mockedRunShutdown).toHaveBeenCalledTimes(2);
    expect(mockedRunShutdown).toHaveBeenNthCalledWith(1, oldModule, expect.anything());
    expect(mockedRunShutdown).toHaveBeenNthCalledWith(2, newModule, expect.anything());
  });

  test('on restart-prepare failure, the error is re-thrown so the gate keeps the holding page', async () => {
    const oldModule: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };

    mockedSsrImport.mockResolvedValueOnce(oldModule);

    let failPrepare = false;

    const { plugin } = getStartupPlugin({
      prepare: async () => {
        if (failPrepare) throw new Error('config invalid');
      },
    });

    await (plugin.configureServer as never as ConfigureServer)(createMockServer());

    failPrepare = true;

    await expect((plugin.configureServer as never as ConfigureServer)(createMockServer())).rejects.toThrow(
      'config invalid',
    );

    // startup never ran for the failed generation
    expect(mockedRunStartup).toHaveBeenCalledTimes(1);
  });

  test('does not register a watcher when watch option is false', async () => {
    const mod: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };

    mockedSsrImport.mockResolvedValueOnce(mod);

    const { setupBootWatch } = await import('./watch.js');
    const mockedSetup = vi.mocked(setupBootWatch);

    mockedSetup.mockClear();

    const { plugin } = getStartupPlugin({ watch: false });

    await (plugin.configureServer as never as ConfigureServer)(createMockServer());

    expect(mockedSetup).not.toHaveBeenCalled();
  });

  test('logs but does not throw when shutdown rejects (sigint path)', async () => {
    const mod: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };

    mockedSsrImport.mockResolvedValueOnce(mod);
    mockedRunShutdown.mockRejectedValueOnce(new Error('shutdown blew up'));

    const { plugin, logger } = getStartupPlugin();
    const server = createMockServer();

    await (plugin.configureServer as never as ConfigureServer)(server);

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

    const { plugin, logger } = getStartupPlugin();

    await (plugin.configureServer as never as ConfigureServer)(createMockServer());

    // restart-induced configureServer — pre-restart shutdown rejects, but new startup must still run
    await (plugin.configureServer as never as ConfigureServer)(createMockServer());

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('shutdown'));
    // new module's startup ran despite the old shutdown failing
    expect(mockedRunStartup).toHaveBeenLastCalledWith(newModule, expect.anything());
  });

  test('registers a watcher with the entry and extra watch entries', async () => {
    const mod: BootModule = { onStartup: vi.fn(), onShutdown: vi.fn() };

    mockedSsrImport.mockResolvedValueOnce(mod);

    const { setupBootWatch } = await import('./watch.js');
    const mockedSetup = vi.mocked(setupBootWatch);

    mockedSetup.mockClear();

    const { plugin } = getStartupPlugin({ watchEntries: ['src/config.ts'] });
    const server = createMockServer();

    await (plugin.configureServer as never as ConfigureServer)(server);

    expect(mockedSetup).toHaveBeenCalledTimes(1);
    expect(mockedSetup).toHaveBeenCalledWith(
      server,
      ['src/boot.ts', 'src/config.ts'],
      expect.objectContaining({ schedule: expect.any(Function) }),
    );
  });
});
