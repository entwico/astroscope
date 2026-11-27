import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import pino, { type DestinationStream } from 'pino';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { getLogStore } from '../observability/log/store';
import { clearNativeMounts, dispatchNativeMount, mountNativeHandler } from './native-mount';

const boot = vi.hoisted(() => ({
  onStartup: undefined as (() => void) | undefined,
  onShutdown: undefined as (() => void) | undefined,
}));

vi.mock('virtual:@astroscope/node/config', () => ({
  options: {
    host: '127.0.0.1',
    port: 0,
    client: 'file:///app/dist/client/',
    server: 'file:///app/dist/server/',
    bodySizeLimit: 0,
    shutdownTimeout: 1000,
    keepAliveTimeout: 1000,
    redactedQueryParams: [],
    health: false,
    logging: false,
    telemetry: false,
  },
}));

vi.mock('virtual:@astroscope/node/boot', () => ({
  onStartup: () => boot.onStartup?.(),
  onShutdown: () => boot.onShutdown?.(),
}));

vi.mock('astro/app/entrypoint', () => ({
  createApp: () => ({
    manifest: { trailingSlash: 'ignore', buildFormat: 'directory', assetsDir: '_astro' },
    removeBase: (pathname: string) => pathname,
    getAllowedDomains: () => [],
    match() {},
    render: (request: Request) => Promise.resolve(new Response(`rendered ${new URL(request.url).pathname}`)),
  }),
}));

// env files, the telemetry sdk and the root logger are the platform's own, tested there
vi.mock('../platform/prepare.js', () => ({ preparePlatform: () => Promise.resolve() }));

type StartServer = (overrides?: { host?: string; port?: number }) => Promise<{ stop(): Promise<void> }>;

class ProcessExit extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

const logLines: Record<string, unknown>[] = [];

const sink: DestinationStream = {
  write: (msg: string) => {
    logLines.push(JSON.parse(msg) as Record<string, unknown>);
  },
};

let startServer: StartServer;

beforeAll(async () => {
  vi.stubEnv('ASTROSCOPE_NODE_AUTOSTART', 'disabled');

  ({ startServer } = await import('./index'));
});

const PROCESS_EVENTS = ['SIGTERM', 'SIGINT', 'unhandledRejection'] as const;

type ProcessListener = (...args: unknown[]) => void;

const handles: { stop(): Promise<void> }[] = [];
const blockers: Server[] = [];
const foreignListeners = new Map<string, Set<unknown>>();

beforeEach(() => {
  for (const event of PROCESS_EVENTS) {
    foreignListeners.set(event, new Set(process.listeners(event as 'SIGTERM')));
  }
});

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.stop()));
  await Promise.all(blockers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));

  // every start leaves its signal and rejection listeners on the process
  for (const event of PROCESS_EVENTS) {
    for (const listener of process.listeners(event as 'SIGTERM')) {
      if (!foreignListeners.get(event)!.has(listener)) {
        process.off(event, listener as ProcessListener);
      }
    }
  }

  clearNativeMounts();
  vi.restoreAllMocks();

  boot.onStartup = undefined;
  boot.onShutdown = undefined;
  logLines.length = 0;
  getLogStore().root = undefined;
});

/** starts the server on an ephemeral port and resolves the address it actually bound */
async function start(): Promise<{ url: string; stop(): Promise<void> }> {
  getLogStore().root = pino({ base: null, timestamp: false }, sink);

  const createServer = vi.spyOn(http, 'createServer');
  const handle = await startServer();
  const server = createServer.mock.results.at(-1)!.value as Server;

  handles.push(handle);

  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, stop: handle.stop };
}

function exitInsteadOfDying(): void {
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new ProcessExit(code as number | undefined);
  });
}

// sends the request target exactly as given
function rawGet(url: string, path: string): Promise<{ status: number | undefined; body: string }> {
  const { hostname, port } = new URL(url);

  return new Promise((resolve, reject) => {
    const req = http.get({ hostname, port, path }, (res) => {
      let body = '';

      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });

    req.on('error', reject);
  });
}

describe('request listener', () => {
  test('renders through the app once listening', async () => {
    const { url } = await start();

    expect(await rawGet(url, '/page')).toEqual({ status: 200, body: 'rendered /page' });
  });

  test('a malformed percent-encoding is answered 400 before a mount or astro sees it', async () => {
    const mounted = vi.fn();

    boot.onStartup = () => {
      mountNativeHandler({ match: () => true }, (_req, res) => {
        mounted();
        res.end('mounted');
      });
    };

    const { url } = await start();

    expect(await rawGet(url, '/%E0%A4%A')).toEqual({ status: 400, body: 'Bad request.' });
    expect(mounted).not.toHaveBeenCalled();
    expect(await rawGet(url, '/ok')).toEqual({ status: 200, body: 'mounted' });
  });
});

describe('shutdown', () => {
  test('a failing onShutdown is logged and the stop still completes, mounts removed', async () => {
    boot.onStartup = () => {
      mountNativeHandler({ prefix: '/oidc' }, (_req, res) => void res.end('mounted'));
    };
    boot.onShutdown = () => {
      throw new Error('database close failed');
    };

    const { stop } = await start();

    await expect(stop()).resolves.toBeUndefined();

    expect(logLines.find((line) => line['msg'] === 'shutdown failed')).toMatchObject({
      level: 50,
      err: { message: 'database close failed' },
    });
    expect(logLines.at(-1)).toMatchObject({ msg: 'shutdown complete' });
    expect(dispatchNativeMount({ url: '/oidc' } as IncomingMessage, {} as ServerResponse)).toBe(false);
  });

  test('stopping twice runs the shutdown once', async () => {
    const onShutdown = vi.fn();

    boot.onShutdown = onShutdown;

    const { stop } = await start();

    await Promise.all([stop(), stop()]);

    expect(onShutdown).toHaveBeenCalledTimes(1);
  });
});

describe('startup failures', () => {
  test('a throwing onStartup is logged, shut down and exits 1 without listening', async () => {
    getLogStore().root = pino({ base: null, timestamp: false }, sink);
    exitInsteadOfDying();

    const createServer = vi.spyOn(http, 'createServer');
    const onShutdown = vi.fn();

    boot.onStartup = () => {
      throw new Error('no database');
    };
    boot.onShutdown = onShutdown;

    await expect(startServer()).rejects.toThrow('process.exit(1)');

    expect(logLines.find((line) => line['msg'] === 'startup failed')).toMatchObject({
      level: 50,
      err: { message: 'no database' },
    });
    expect(onShutdown).toHaveBeenCalledTimes(1);
    expect(createServer).not.toHaveBeenCalled();
  });

  test('a port that cannot be bound is logged with its address and exits 1', async () => {
    getLogStore().root = pino({ base: null, timestamp: false }, sink);
    exitInsteadOfDying();

    const blocker = http.createServer();

    blockers.push(blocker);

    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));

    const { port } = blocker.address() as AddressInfo;
    const onShutdown = vi.fn();

    boot.onShutdown = onShutdown;

    await expect(startServer({ host: '127.0.0.1', port })).rejects.toThrow('process.exit(1)');

    expect(logLines.find((line) => line['msg'] === `failed to listen on 127.0.0.1:${port}`)).toMatchObject({
      level: 50,
      err: { code: 'EADDRINUSE' },
    });
    expect(onShutdown).toHaveBeenCalledTimes(1);
  });
});
