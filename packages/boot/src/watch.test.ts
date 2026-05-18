import EventEmitter from 'node:events';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { GEN_HEADER, incrementGeneration } from './generation';
import { RestartScheduler } from './scheduler';
import { installBootGate, installGenStamp, setupBootWatch } from './watch';

const STATE_KEY = Symbol.for('@astroscope/boot/state');

function createMockScheduler() {
  return {
    schedule: vi.fn(),
    scheduleFullReload: vi.fn(),
    isRestartPending: vi.fn(() => false),
    waitForRestart: vi.fn(async () => {}),
    getLastFailure: vi.fn(() => undefined as { message: string } | undefined),
  };
}

function createMockServer(opts?: { bootDeps?: string[] | undefined }) {
  const watcher = new EventEmitter();
  const ssrOutsideEmitter = new EventEmitter();
  const httpServer = new EventEmitter();
  const bootFile = '/project/src/boot.ts';

  const bootMod = {
    file: bootFile,
    importedModules: new Set(
      (opts?.bootDeps ?? []).map((dep) => ({
        file: dep,
        importedModules: new Set(),
      })),
    ),
  };

  return {
    config: { root: '/project' },
    watcher,
    httpServer,
    environments: {
      ssr: {
        runner: { import: vi.fn() },
        moduleGraph: {
          getModulesByFile: vi.fn((file: string) => (file === bootFile ? new Set([bootMod]) : undefined)),
        },
        hot: { api: { outsideEmitter: ssrOutsideEmitter } },
      },
    },
    middlewares: { use: vi.fn() },
    _ssrOutsideEmitter: ssrOutsideEmitter,
  };
}

function markListening(server: ReturnType<typeof createMockServer>): void {
  server.httpServer.emit('listening');
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('setupBootWatch', () => {
  describe('boot dependency changes', () => {
    test('schedules a restart when the boot file itself changes', () => {
      const server = createMockServer();
      const scheduler = createMockScheduler();

      setupBootWatch(server as never, 'src/boot.ts', scheduler as never);

      server.watcher.emit('change', '/project/src/boot.ts');

      expect(scheduler.schedule).toHaveBeenCalledTimes(1);
      expect(scheduler.schedule).toHaveBeenCalledWith(server, '/project/src/boot.ts');
    });

    test('schedules a restart when a transitive boot dependency changes', () => {
      const server = createMockServer({ bootDeps: ['/project/src/services.ts'] });
      const scheduler = createMockScheduler();

      setupBootWatch(server as never, 'src/boot.ts', scheduler as never);

      server.watcher.emit('change', '/project/src/services.ts');

      expect(scheduler.schedule).toHaveBeenCalledTimes(1);
      expect(scheduler.schedule).toHaveBeenCalledWith(server, '/project/src/services.ts');
    });

    test('does not schedule for non-boot file changes', () => {
      const server = createMockServer();
      const scheduler = createMockScheduler();

      setupBootWatch(server as never, 'src/boot.ts', scheduler as never);

      server.watcher.emit('change', '/project/src/components/App.tsx');

      expect(scheduler.schedule).not.toHaveBeenCalled();
    });

    test('schedules on unlink+add of a boot dep (rm+rewrite)', () => {
      const server = createMockServer({ bootDeps: ['/project/src/generated.ts'] });
      const scheduler = createMockScheduler();

      setupBootWatch(server as never, 'src/boot.ts', scheduler as never);

      server.watcher.emit('unlink', '/project/src/generated.ts');
      server.watcher.emit('add', '/project/src/generated.ts');

      expect(scheduler.schedule).toHaveBeenCalledTimes(2);
    });

    test('passes the absolute changed path through', () => {
      const server = createMockServer({ bootDeps: ['/project/src/services.ts'] });
      const scheduler = createMockScheduler();

      setupBootWatch(server as never, 'src/boot.ts', scheduler as never);

      server.watcher.emit('change', '/project/src/services.ts');

      const arg = scheduler.schedule.mock.calls[0]![1] as string;

      expect(arg).toBe('/project/src/services.ts');
    });
  });

  describe('ignored files', () => {
    test('ignores css file changes', () => {
      const server = createMockServer();
      const scheduler = createMockScheduler();

      setupBootWatch(server as never, 'src/boot.ts', scheduler as never);

      server.watcher.emit('change', '/project/src/styles/main.css');

      expect(scheduler.schedule).not.toHaveBeenCalled();
    });

    test('ignores image file changes', () => {
      const server = createMockServer();
      const scheduler = createMockScheduler();

      setupBootWatch(server as never, 'src/boot.ts', scheduler as never);

      server.watcher.emit('change', '/project/public/logo.png');

      expect(scheduler.schedule).not.toHaveBeenCalled();
    });

    test('ignores json file changes', () => {
      const server = createMockServer();
      const scheduler = createMockScheduler();

      setupBootWatch(server as never, 'src/boot.ts', scheduler as never);

      server.watcher.emit('change', '/project/package.json');

      expect(scheduler.schedule).not.toHaveBeenCalled();
    });
  });

  describe('graph robustness', () => {
    test('does not crash and does not schedule when the boot module is missing from the graph', () => {
      const server = createMockServer();

      server.environments.ssr.moduleGraph.getModulesByFile = vi.fn(() => undefined);

      const scheduler = createMockScheduler();

      setupBootWatch(server as never, 'src/boot.ts', scheduler as never);

      server.watcher.emit('change', '/project/src/anything.ts');

      expect(scheduler.schedule).not.toHaveBeenCalled();
    });

    test('reads the boot dep graph from the runnable env (Astro 6 shape: astro env runnable, ssr non-runnable)', () => {
      const watcher = new EventEmitter();
      const httpServer = new EventEmitter();
      const astroOutsideEmitter = new EventEmitter();
      const bootMod = {
        file: '/project/src/boot.ts',
        importedModules: new Set([{ file: '/project/src/server/tour-types.ts', importedModules: new Set() }]),
      };
      const server = {
        config: { root: '/project' },
        watcher,
        httpServer,
        environments: {
          ssr: { hot: { api: { outsideEmitter: new EventEmitter() } } },
          astro: {
            runner: { import: vi.fn() },
            moduleGraph: {
              getModulesByFile: vi.fn((file: string) =>
                file === '/project/src/boot.ts' ? new Set([bootMod]) : undefined,
              ),
            },
            hot: { api: { outsideEmitter: astroOutsideEmitter } },
          },
        },
        middlewares: { use: vi.fn() },
      };
      const scheduler = createMockScheduler();

      setupBootWatch(server as never, 'src/boot.ts', scheduler as never);

      watcher.emit('change', '/project/src/server/tour-types.ts');

      expect(scheduler.schedule).toHaveBeenCalledTimes(1);
      expect(scheduler.schedule).toHaveBeenCalledWith(server, '/project/src/server/tour-types.ts');
    });
  });

  // exercises the full watcher → scheduler → server.restart() chain with a real RestartScheduler.
  describe('end-to-end burst (real scheduler)', () => {
    function createMockServerWithRestart(deps: string[]) {
      const watcher = new EventEmitter();
      const bootFile = '/project/src/boot.ts';
      const bootMod = {
        file: bootFile,
        importedModules: new Set(deps.map((dep) => ({ file: dep, importedModules: new Set() }))),
      };

      return {
        config: { root: '/project' },
        watcher,
        environments: {
          ssr: {
            runner: { import: vi.fn() },
            moduleGraph: {
              getModulesByFile: vi.fn((file: string) => (file === bootFile ? new Set([bootMod]) : undefined)),
            },
            hot: { api: { outsideEmitter: new EventEmitter() } },
          },
        },
        middlewares: { use: vi.fn() },
        restart: vi.fn(async () => {}),
      };
    }

    test('three watcher events on three boot deps within the debounce window collapse into one restart with all paths logged', async () => {
      vi.useFakeTimers();

      const server = createMockServerWithRestart([
        '/project/src/server/config.ts',
        '/project/src/server/some-module.ts',
      ]);
      const localLogger = { info: vi.fn(), error: vi.fn() };
      const scheduler = new RestartScheduler(100, localLogger);

      setupBootWatch(server as never, 'src/boot.ts', scheduler);

      // three boot-dep events in the same tick
      server.watcher.emit('change', '/project/src/boot.ts');
      server.watcher.emit('change', '/project/src/server/config.ts');
      server.watcher.emit('change', '/project/src/server/some-module.ts');

      expect(server.restart).not.toHaveBeenCalled();
      expect(localLogger.info).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(110);

      expect(server.restart).toHaveBeenCalledTimes(1);
      expect(localLogger.info).toHaveBeenCalledTimes(1);

      const msg = localLogger.info.mock.calls[0]![0] as string;

      expect(msg).toContain('boot deps changed (3)');
      expect(msg).toContain('src/boot.ts');
      expect(msg).toContain('src/server/config.ts');
      expect(msg).toContain('src/server/some-module.ts');
    });

    test('non-boot-dep events in the burst are ignored — only matching paths reach the scheduler', async () => {
      vi.useFakeTimers();

      const server = createMockServerWithRestart(['/project/src/server/config.ts']);
      const localLogger = { info: vi.fn(), error: vi.fn() };
      const scheduler = new RestartScheduler(100, localLogger);

      setupBootWatch(server as never, 'src/boot.ts', scheduler);

      server.watcher.emit('change', '/project/src/server/config.ts');
      server.watcher.emit('change', '/project/src/components/App.tsx'); // not a boot dep
      server.watcher.emit('change', '/project/src/styles/main.css'); // ignored suffix

      await vi.advanceTimersByTimeAsync(110);

      expect(server.restart).toHaveBeenCalledTimes(1);

      const msg = localLogger.info.mock.calls[0]![0] as string;

      expect(msg).toMatch(/^boot dep changed: src\/server\/config\.ts/);
      expect(msg).not.toContain('App.tsx');
      expect(msg).not.toContain('main.css');
    });

    test('a second burst arriving during an in-flight restart triggers a follow-up restart with only the second burst paths', async () => {
      vi.useRealTimers();

      const server = createMockServerWithRestart([
        '/project/src/server/config.ts',
        '/project/src/server/some-module.ts',
      ]);
      const localLogger = { info: vi.fn(), error: vi.fn() };
      const scheduler = new RestartScheduler(0, localLogger);

      // gate the first restart so we can fire more events while it's pending
      let releaseFirst!: () => void;
      const firstDone = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      server.restart.mockImplementationOnce(async () => {
        await firstDone;
      });

      setupBootWatch(server as never, 'src/boot.ts', scheduler);

      // first burst
      server.watcher.emit('change', '/project/src/boot.ts');
      server.watcher.emit('change', '/project/src/server/config.ts');

      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(1));

      const firstLog = localLogger.info.mock.calls[0]![0] as string;

      expect(firstLog).toContain('boot.ts');
      expect(firstLog).toContain('config.ts');
      expect(firstLog).not.toContain('some-module.ts');

      // second burst arrives while the first restart is still pending
      server.watcher.emit('change', '/project/src/server/some-module.ts');

      // give the debouncer a tick — it should fire and queue (not start) another restart
      await new Promise((r) => setTimeout(r, 20));

      expect(server.restart).toHaveBeenCalledTimes(1);
      // no second log yet — log fires when the actual restart starts
      expect(localLogger.info).toHaveBeenCalledTimes(1);

      releaseFirst();

      await vi.waitFor(() => expect(server.restart).toHaveBeenCalledTimes(2));

      // follow-up log names ONLY the second burst's paths
      expect(localLogger.info).toHaveBeenCalledTimes(2);
      const secondLog = localLogger.info.mock.calls[1]![0] as string;
      expect(secondLog).toContain('some-module.ts');
      expect(secondLog).not.toContain('boot.ts');
      expect(secondLog).not.toContain('config.ts');
    });
  });

  describe('SSR full-reload', () => {
    test('triggers a restart on a Vite SSR full-reload', () => {
      const server = createMockServer();
      const scheduler = createMockScheduler();

      setupBootWatch(server as never, 'src/boot.ts', scheduler as never);
      markListening(server);

      server._ssrOutsideEmitter.emit('send', { type: 'full-reload', path: '*' });

      expect(scheduler.scheduleFullReload).toHaveBeenCalledTimes(1);
      expect(scheduler.scheduleFullReload).toHaveBeenCalledWith(server, undefined);
    });

    test('forwards the triggeredBy file when present', () => {
      const server = createMockServer();
      const scheduler = createMockScheduler();

      setupBootWatch(server as never, 'src/boot.ts', scheduler as never);
      markListening(server);

      server._ssrOutsideEmitter.emit('send', {
        type: 'full-reload',
        path: '*',
        triggeredBy: '/project/src/components/HeaderClient.tsx',
      });

      expect(scheduler.scheduleFullReload).toHaveBeenCalledWith(server, '/project/src/components/HeaderClient.tsx');
    });

    test('listens on the astro env when ssr env is non-runnable (Astro 6)', () => {
      // Astro 6 exposes a separate 'astro' environment for its module runner;
      // the 'ssr' env exists but is non-runnable. Boot lives in the 'astro'
      // env's module cache, and full-reloads come through that env's hot channel.
      const watcher = new EventEmitter();
      const httpServer = new EventEmitter();
      const astroOutsideEmitter = new EventEmitter();
      const ssrOutsideEmitter = new EventEmitter();
      const bootMod = { file: '/project/src/boot.ts', importedModules: new Set() };
      const server = {
        config: { root: '/project' },
        watcher,
        httpServer,
        environments: {
          // ssr exists but has no runner — Astro 6 shape
          ssr: { hot: { api: { outsideEmitter: ssrOutsideEmitter } } },
          astro: {
            runner: { import: vi.fn() },
            moduleGraph: {
              getModulesByFile: vi.fn((file: string) =>
                file === '/project/src/boot.ts' ? new Set([bootMod]) : undefined,
              ),
            },
            hot: { api: { outsideEmitter: astroOutsideEmitter } },
          },
        },
        middlewares: { use: vi.fn() },
      };
      const scheduler = createMockScheduler();

      setupBootWatch(server as never, 'src/boot.ts', scheduler as never);
      httpServer.emit('listening');

      // full-reload arrives via the astro env (which is the runnable one)
      astroOutsideEmitter.emit('send', {
        type: 'full-reload',
        path: '*',
        triggeredBy: '/project/src/components/HeaderHotlineInfo.tsx',
      });

      expect(scheduler.scheduleFullReload).toHaveBeenCalledTimes(1);
      expect(scheduler.scheduleFullReload).toHaveBeenCalledWith(
        server,
        '/project/src/components/HeaderHotlineInfo.tsx',
      );
    });

    test('forwards a full-reload even when triggeredBy is a boot dep — vite still wipes the SSR module cache', () => {
      // a full-reload always clears the SSR module runner's cache, so we MUST schedule
      // a restart regardless of whether the watcher will independently fire for the
      // same file. the debouncer collapses both into a single restart.
      const server = createMockServer({ bootDeps: ['/project/src/services.ts'] });
      const scheduler = createMockScheduler();

      setupBootWatch(server as never, 'src/boot.ts', scheduler as never);
      markListening(server);

      server._ssrOutsideEmitter.emit('send', {
        type: 'full-reload',
        path: '*',
        triggeredBy: '/project/src/services.ts',
      });

      expect(scheduler.scheduleFullReload).toHaveBeenCalledTimes(1);
      expect(scheduler.scheduleFullReload).toHaveBeenCalledWith(server, '/project/src/services.ts');
    });

    test('a watcher event AND a full-reload for the same boot-dep file produce one restart (debouncer dedup)', async () => {
      vi.useRealTimers();

      const watcher = new EventEmitter();
      const ssrOutsideEmitter = new EventEmitter();
      const httpServer = new EventEmitter();
      const bootMod = {
        file: '/project/src/boot.ts',
        importedModules: new Set([{ file: '/project/src/services.ts', importedModules: new Set() }]),
      };
      const server = {
        config: { root: '/project' },
        watcher,
        httpServer,
        environments: {
          ssr: {
            runner: { import: vi.fn() },
            moduleGraph: {
              getModulesByFile: vi.fn((file: string) =>
                file === '/project/src/boot.ts' ? new Set([bootMod]) : undefined,
              ),
            },
            hot: { api: { outsideEmitter: ssrOutsideEmitter } },
          },
        },
        middlewares: { use: vi.fn() },
        restart: vi.fn(async () => {}),
      };
      const localLogger = { info: vi.fn(), error: vi.fn() };
      const scheduler = new RestartScheduler(50, localLogger);

      setupBootWatch(server as never, 'src/boot.ts', scheduler);
      httpServer.emit('listening');

      // both events fire for the same file in the same JS tick (vite typically does this)
      watcher.emit('change', '/project/src/services.ts');
      ssrOutsideEmitter.emit('send', {
        type: 'full-reload',
        path: '*',
        triggeredBy: '/project/src/services.ts',
      });

      await new Promise((r) => setTimeout(r, 80));

      expect(server.restart).toHaveBeenCalledTimes(1);
      // log mentions both — the boot dep change AND the SSR full-reload
      const msg = localLogger.info.mock.calls[0]![0] as string;
      expect(msg).toContain('boot dep changed: src/services.ts');
      expect(msg).toContain('vite SSR full-reload');
    });

    test('ignores non-full-reload payloads (e.g. updates)', () => {
      const server = createMockServer();
      const scheduler = createMockScheduler();

      setupBootWatch(server as never, 'src/boot.ts', scheduler as never);
      markListening(server);

      server._ssrOutsideEmitter.emit('send', { type: 'update', updates: [] });

      expect(scheduler.scheduleFullReload).not.toHaveBeenCalled();
    });

    test('ignores full-reloads emitted before the server is listening (startup-time noise)', () => {
      const server = createMockServer();
      const scheduler = createMockScheduler();

      setupBootWatch(server as never, 'src/boot.ts', scheduler as never);

      // no markListening — the server isn't ready yet
      server._ssrOutsideEmitter.emit('send', { type: 'full-reload', path: '*' });

      expect(scheduler.scheduleFullReload).not.toHaveBeenCalled();
    });

    // end-to-end: real scheduler, full-reload event → server.restart() actually fires
    test('SSR full-reload reaches server.restart() through a real scheduler', async () => {
      vi.useFakeTimers();

      const watcher = new EventEmitter();
      const ssrOutsideEmitter = new EventEmitter();
      const httpServer = new EventEmitter();
      const bootMod = { file: '/project/src/boot.ts', importedModules: new Set() };
      const server = {
        config: { root: '/project' },
        watcher,
        httpServer,
        environments: {
          ssr: {
            runner: { import: vi.fn() },
            moduleGraph: {
              getModulesByFile: vi.fn((file: string) =>
                file === '/project/src/boot.ts' ? new Set([bootMod]) : undefined,
              ),
            },
            hot: { api: { outsideEmitter: ssrOutsideEmitter } },
          },
        },
        middlewares: { use: vi.fn() },
        restart: vi.fn(async () => {}),
      };
      const localLogger = { info: vi.fn(), error: vi.fn() };
      const scheduler = new RestartScheduler(100, localLogger);

      setupBootWatch(server as never, 'src/boot.ts', scheduler);
      httpServer.emit('listening');

      ssrOutsideEmitter.emit('send', {
        type: 'full-reload',
        path: '*',
        triggeredBy: '/project/src/components/HeaderClient.tsx',
      });

      await vi.advanceTimersByTimeAsync(110);

      expect(server.restart).toHaveBeenCalledTimes(1);
      expect(localLogger.info).toHaveBeenCalledTimes(1);
      expect(localLogger.info.mock.calls[0]![0]).toMatch(/vite SSR full-reload/);
    });
  });

  test('does not register a request middleware (gating is installed by installBootGate)', () => {
    const middlewares: unknown[] = [];
    const watcher = new EventEmitter();
    const ssrOutsideEmitter = new EventEmitter();
    const httpServer = new EventEmitter();
    const bootMod = { file: '/project/src/boot.ts', importedModules: new Set() };
    const server = {
      config: { root: '/project' },
      watcher,
      httpServer,
      environments: {
        ssr: {
          runner: { import: vi.fn() },
          moduleGraph: {
            getModulesByFile: vi.fn((file: string) =>
              file === '/project/src/boot.ts' ? new Set([bootMod]) : undefined,
            ),
          },
          hot: { api: { outsideEmitter: ssrOutsideEmitter } },
        },
      },
      middlewares: { use: (fn: unknown) => middlewares.push(fn) },
    };
    const scheduler = createMockScheduler() as unknown as RestartScheduler;

    setupBootWatch(server as never, 'src/boot.ts', scheduler);

    expect(middlewares.length).toBe(0);
  });
});

describe('installBootGate', () => {
  type Layer = { route: string; handle: (req: unknown, res: unknown, next: (err?: unknown) => void) => unknown };

  function createServerWithStack() {
    const stack: Layer[] = [];
    const middlewares = ((req: unknown, res: unknown) => {
      let i = 0;
      const next = (): void => {
        const layer = stack[i++];

        if (!layer) return;

        layer.handle(req, res, next);
      };

      next();
    }) as unknown as { stack: Layer[] };

    middlewares.stack = stack;

    return {
      middlewares,
      _stack: stack,
    };
  }

  function createMockResponse() {
    let writtenStatus: number | undefined;
    let writtenHeaders: Record<string, string> | undefined;
    let writtenBody = '';

    return {
      headersSent: false,
      writeHead: vi.fn((status: number, headers: Record<string, string>) => {
        writtenStatus = status;
        writtenHeaders = headers;
      }),
      end: vi.fn((body?: string) => {
        if (body) writtenBody = body;
      }),
      _getStatus: () => writtenStatus,
      _getHeaders: () => writtenHeaders,
      _getBody: () => writtenBody,
    };
  }

  test('unshifts a single layer at the front of the connect stack', () => {
    const server = createServerWithStack();

    server._stack.push({ route: '', handle: vi.fn() }); // pre-existing layer

    const scheduler = createMockScheduler() as unknown as RestartScheduler;

    installBootGate(server as never, scheduler);

    expect(server._stack.length).toBe(2);
    expect(server._stack[0]!.route).toBe('');
    expect(typeof server._stack[0]!.handle).toBe('function');
  });

  test('passes through to next() when no restart is in flight', async () => {
    const server = createServerWithStack();
    const scheduler = createMockScheduler();

    scheduler.isRestartPending.mockReturnValue(false);

    installBootGate(server as never, scheduler as never);

    const handle = server._stack[0]!.handle;
    const res = createMockResponse();
    const next = vi.fn();

    await handle({ url: '/' }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.writeHead).not.toHaveBeenCalled();
  });

  test('serves the holding page immediately when a restart is pending', async () => {
    const server = createServerWithStack();
    const scheduler = createMockScheduler();

    scheduler.isRestartPending.mockReturnValue(true);

    installBootGate(server as never, scheduler as never);

    const handle = server._stack[0]!.handle;
    const res = createMockResponse();
    const next = vi.fn();

    await handle({ url: '/' }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._getStatus()).toBe(503);
    expect(res._getHeaders()?.['content-type']).toContain('text/html');
    expect(res._getBody()).toContain('Reloading');
  });

  test('readiness probe returns 503 + JSON error when last restart failed', async () => {
    const server = createServerWithStack();
    const scheduler = createMockScheduler();

    scheduler.getLastFailure.mockReturnValue({ message: 'i18n.configure() threw' });

    installBootGate(server as never, scheduler as never);

    const handle = server._stack[0]!.handle;
    const res = createMockResponse();
    const next = vi.fn();

    await handle({ url: '/__astroscope_boot_ready' }, res, next);

    expect(res._getStatus()).toBe(503);
    expect(res._getHeaders()?.['content-type']).toContain('application/json');
    expect(JSON.parse(res._getBody()).error).toContain('i18n.configure');
  });

  test('readiness probe waits for restart and then 204s', async () => {
    vi.useRealTimers();

    const server = createServerWithStack();
    const scheduler = createMockScheduler();
    const gate = createDeferred();

    scheduler.waitForRestart.mockImplementation(() => gate.promise);

    installBootGate(server as never, scheduler as never);

    const handle = server._stack[0]!.handle;
    const res = createMockResponse();
    const next = vi.fn();
    const pending = handle({ url: '/__astroscope_boot_ready' }, res, next) as Promise<void>;

    await new Promise((r) => setTimeout(r, 10));

    expect(res.writeHead).not.toHaveBeenCalled();

    gate.resolve();
    await pending;

    expect(res._getStatus()).toBe(204);
    expect(next).not.toHaveBeenCalled();
  });

  test('dev-internal paths bypass the gate even during a restart', async () => {
    const server = createServerWithStack();
    const scheduler = createMockScheduler();

    scheduler.isRestartPending.mockReturnValue(true);

    installBootGate(server as never, scheduler as never);

    const handle = server._stack[0]!.handle;

    for (const url of ['/@vite/client', '/@id/x', '/__vite_ping', '/node_modules/foo/bar.js']) {
      const res = createMockResponse();
      const next = vi.fn();

      await handle({ url }, res, next);

      expect(next, `expected ${url} to bypass`).toHaveBeenCalledTimes(1);
      expect(res.writeHead).not.toHaveBeenCalled();
    }
  });
});

function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe('installGenStamp', () => {
  beforeEach(() => {
    (globalThis as Record<symbol, unknown>)[STATE_KEY] = undefined;
  });

  type Layer = { route: string; handle: (req: unknown, res: unknown, next: () => void) => void };

  function createServerWithStack() {
    const stack: Layer[] = [];

    return { middlewares: { stack } as unknown as { stack: Layer[] }, _stack: stack };
  }

  test('unshifts a layer at the front of the connect stack', () => {
    const server = createServerWithStack();

    server._stack.push({ route: '', handle: vi.fn() });
    installGenStamp(server as never);

    expect(server._stack.length).toBe(2);
    expect(typeof server._stack[0]!.handle).toBe('function');
  });

  test('stamps the current generation onto every incoming request', () => {
    incrementGeneration();
    incrementGeneration(); // current = 2

    const server = createServerWithStack();

    installGenStamp(server as never);

    const req = { headers: {} as Record<string, string> };
    const next = vi.fn();

    server._stack[0]!.handle(req as never, {} as never, next);

    expect(req.headers[GEN_HEADER]).toBe('2');
    expect(next).toHaveBeenCalledOnce();
  });

  test('reads the current generation lazily on each request, not at install time', () => {
    const server = createServerWithStack();

    installGenStamp(server as never);

    incrementGeneration(); // happens AFTER install

    const req = { headers: {} as Record<string, string> };

    server._stack[0]!.handle(req as never, {} as never, vi.fn());

    expect(req.headers[GEN_HEADER]).toBe('1');
  });
});
