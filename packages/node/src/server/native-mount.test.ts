import { type IncomingMessage, type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import pino, { type DestinationStream } from 'pino';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { getLogStore } from '../observability/log/store';
import { clearNativeMounts, dispatchNativeMount, mountNativeHandler } from './native-mount';

const servers: Server[] = [];
const logLines: Record<string, unknown>[] = [];

const sink: DestinationStream = {
  write: (msg: string) => {
    logLines.push(JSON.parse(msg) as Record<string, unknown>);
  },
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));

  clearNativeMounts();

  logLines.length = 0;
  getLogStore().root = undefined;
});

function enableLogCapture(): void {
  getLogStore().root = pino({ base: null, timestamp: false }, sink);
}

async function startServer(): Promise<string> {
  const server = createServer((req, res) => {
    if (!dispatchNativeMount(req, res)) {
      res.statusCode = 404;
      res.end('fallthrough');
    }
  });

  servers.push(server);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('mountNativeHandler', () => {
  test('requires a prefix or a match predicate', () => {
    expect(() => mountNativeHandler({}, () => {})).toThrow(/requires a prefix or a match predicate/);
  });

  test('the unregister function removes the mount and is idempotent', async () => {
    const unregister = mountNativeHandler({ prefix: '/api' }, (_req, res) => void res.end('mounted'));
    const url = await startServer();

    expect(await (await fetch(`${url}/api`)).text()).toBe('mounted');

    unregister();
    unregister();

    expect(await (await fetch(`${url}/api`)).text()).toBe('fallthrough');
  });

  test('clearNativeMounts removes every mount', async () => {
    mountNativeHandler({ prefix: '/a' }, (_req, res) => void res.end('a'));
    mountNativeHandler({ match: () => true }, (_req, res) => void res.end('b'));

    clearNativeMounts();

    const url = await startServer();

    expect(await (await fetch(`${url}/a`)).text()).toBe('fallthrough');
  });
});

describe('dispatchNativeMount routing', () => {
  test('returns false when no mount matches', async () => {
    const url = await startServer();
    const res = await fetch(`${url}/anything`);

    expect(res.status).toBe(404);
    expect(await res.text()).toBe('fallthrough');
  });

  test('prefix matches on segment boundaries only', async () => {
    mountNativeHandler({ prefix: '/oidc' }, (req, res) => void res.end(`oidc:${req.url ?? ''}`));

    const url = await startServer();

    expect(await (await fetch(`${url}/oidc`)).text()).toBe('oidc:/oidc');
    expect(await (await fetch(`${url}/oidc/auth`)).text()).toBe('oidc:/oidc/auth');
    expect(await (await fetch(`${url}/oidc?client_id=1`)).text()).toBe('oidc:/oidc?client_id=1');
    expect(await (await fetch(`${url}/oidcx`)).text()).toBe('fallthrough');
  });

  test('the longest matching prefix wins regardless of registration order', async () => {
    mountNativeHandler({ prefix: '/api' }, (_req, res) => void res.end('short'));
    mountNativeHandler({ prefix: '/api/v2' }, (_req, res) => void res.end('long'));

    const url = await startServer();

    expect(await (await fetch(`${url}/api/v2/users`)).text()).toBe('long');
    expect(await (await fetch(`${url}/api/v1/users`)).text()).toBe('short');
  });

  test('predicate mounts are consulted only when no prefix mount matches', async () => {
    mountNativeHandler({ match: () => true }, (_req, res) => void res.end('predicate'));
    mountNativeHandler({ prefix: '/p' }, (_req, res) => void res.end('prefix'));

    const url = await startServer();

    expect(await (await fetch(`${url}/p/x`)).text()).toBe('prefix');
    expect(await (await fetch(`${url}/q`)).text()).toBe('predicate');
  });

  test('predicate mounts run in registration order', async () => {
    const matchesA = (req: IncomingMessage) => (req.url ?? '').includes('a');

    mountNativeHandler({ match: matchesA }, (_req, res) => void res.end('first'));
    mountNativeHandler({ match: () => true }, (_req, res) => void res.end('second'));

    const url = await startServer();

    expect(await (await fetch(`${url}/path-a`)).text()).toBe('first');
    expect(await (await fetch(`${url}/other`)).text()).toBe('second');
  });
});

describe('dispatchNativeMount error handling', () => {
  test('a throwing handler yields a logged 500', async () => {
    enableLogCapture();
    mountNativeHandler({ prefix: '/fail' }, () => {
      throw new Error('sync boom');
    });

    const url = await startServer();
    const res = await fetch(`${url}/fail`);

    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Internal Server Error');

    await vi.waitFor(() => expect(logLines.some((l) => l['msg'] === 'native mount handler failed')).toBe(true));
  });

  test('a rejecting async handler yields a logged 500', async () => {
    enableLogCapture();
    mountNativeHandler({ prefix: '/fail' }, async () => {
      throw new Error('async boom');
    });

    const url = await startServer();
    const res = await fetch(`${url}/fail`);

    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Internal Server Error');

    await vi.waitFor(() => expect(logLines.some((l) => l['msg'] === 'native mount handler failed')).toBe(true));
  });

  test('a failure after headers are sent keeps the status and still ends the response', async () => {
    enableLogCapture();
    mountNativeHandler({ prefix: '/partial' }, (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('partial');

      throw new Error('late boom');
    });

    const url = await startServer();
    const res = await fetch(`${url}/partial`);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('partialInternal Server Error');
  });

  test('a failure after the response ended leaves the response untouched', async () => {
    enableLogCapture();
    mountNativeHandler({ prefix: '/done' }, (_req, res) => {
      res.end('done');

      throw new Error('after end');
    });

    const url = await startServer();
    const res = await fetch(`${url}/done`);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('done');
  });
});
