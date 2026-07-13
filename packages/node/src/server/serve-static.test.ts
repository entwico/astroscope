import fs from 'node:fs';
import http, { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { BaseApp } from 'astro/app';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { createStaticHandler } from './serve-static';

let root: string;
let client: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'astroscope-static-'));
  client = path.join(root, 'client');

  fs.mkdirSync(path.join(client, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(client, '_astro'), { recursive: true });
  fs.mkdirSync(path.join(client, '.well-known'), { recursive: true });

  fs.writeFileSync(path.join(client, 'index.html'), 'root index');
  fs.writeFileSync(path.join(client, 'docs', 'index.html'), 'docs index');
  fs.writeFileSync(path.join(client, 'hello.txt'), 'identity content');
  fs.writeFileSync(path.join(client, 'hello.txt.br'), 'br-variant');
  fs.writeFileSync(path.join(client, 'hello.txt.gz'), 'gz-variant');
  fs.writeFileSync(path.join(client, 'gzip-only.txt'), 'gzip-only identity');
  fs.writeFileSync(path.join(client, 'gzip-only.txt.gz'), 'gzip-only-variant');
  fs.writeFileSync(path.join(client, 'image.png'), 'png bytes');
  fs.writeFileSync(path.join(client, 'image.png.br'), 'png-br-variant');
  fs.writeFileSync(path.join(client, '_astro', 'app.css'), 'body {}');
  fs.writeFileSync(path.join(client, '.well-known', 'security.txt'), 'security contact');
  fs.writeFileSync(path.join(client, '.secret'), 'hidden dotfile');
  fs.writeFileSync(path.join(client, 'page.html'), 'file format page');
  fs.writeFileSync(path.join(root, 'outside.txt'), 'outside secret');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

interface AppOptions {
  trailingSlash?: 'never' | 'always' | 'ignore' | undefined;
  buildFormat?: 'directory' | 'file' | 'preserve' | undefined;
  removeBase?: ((pathname: string) => string) | undefined;
}

function createApp(options: AppOptions = {}): BaseApp {
  return {
    removeBase: options.removeBase ?? ((pathname: string) => pathname),
    manifest: {
      trailingSlash: options.trailingSlash ?? 'ignore',
      buildFormat: options.buildFormat ?? 'directory',
      assetsDir: '_astro',
    },
  } as unknown as BaseApp;
}

async function startServer(app: BaseApp): Promise<string> {
  const handler = createStaticHandler(app, client);
  const server = createServer((req, res) => {
    handler(req, res, () => {
      res.statusCode = 555;
      res.end('ssr-fallback');
    });
  });

  servers.push(server);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function rawGet(url: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }),
      );
    });

    req.on('error', reject);
  });
}

describe('basic serving', () => {
  test('serves an existing file with its mime type', async () => {
    const url = await startServer(createApp());
    const res = await rawGet(`${url}/hello.txt`);

    expect(res.status).toBe(200);
    expect(res.body).toBe('identity content');
    expect(res.headers['content-type']).toContain('text/plain');
  });

  test('falls through to ssr when no file matches', async () => {
    const url = await startServer(createApp());
    const res = await rawGet(`${url}/missing`);

    expect(res.status).toBe(555);
    expect(res.body).toBe('ssr-fallback');
  });

  test('calls ssr immediately when req.url is missing', () => {
    const handler = createStaticHandler(createApp(), client);
    const ssr = vi.fn();

    handler({} as IncomingMessage, {} as ServerResponse, ssr);

    expect(ssr).toHaveBeenCalledTimes(1);
  });

  test('ignores query strings when resolving files', async () => {
    const url = await startServer(createApp());
    const res = await rawGet(`${url}/hello.txt?version=2`);

    expect(res.status).toBe(200);
    expect(res.body).toBe('identity content');
  });

  test('strips the base via app.removeBase', async () => {
    const url = await startServer(
      createApp({ removeBase: (pathname) => (pathname.startsWith('/base') ? pathname.slice(5) : pathname) }),
    );
    const res = await rawGet(`${url}/base/hello.txt`);

    expect(res.status).toBe(200);
    expect(res.body).toBe('identity content');
  });
});

describe('encoding negotiation', () => {
  test('serves the .br variant to br-capable clients', async () => {
    const url = await startServer(createApp());
    const res = await rawGet(`${url}/hello.txt`, { 'accept-encoding': 'br' });

    expect(res.status).toBe(200);
    expect(res.body).toBe('br-variant');
    expect(res.headers['content-encoding']).toBe('br');
    expect(res.headers['vary']).toBe('Accept-Encoding');
    expect(res.headers['content-type']).toContain('text/plain');
  });

  test('serves the .gz variant to gzip-only clients', async () => {
    const url = await startServer(createApp());
    const res = await rawGet(`${url}/hello.txt`, { 'accept-encoding': 'gzip' });

    expect(res.body).toBe('gz-variant');
    expect(res.headers['content-encoding']).toBe('gzip');
  });

  test('prefers brotli when the client accepts both', async () => {
    const url = await startServer(createApp());
    const res = await rawGet(`${url}/hello.txt`, { 'accept-encoding': 'gzip, br' });

    expect(res.body).toBe('br-variant');
    expect(res.headers['content-encoding']).toBe('br');
  });

  test('falls back to gzip when no .br variant exists', async () => {
    const url = await startServer(createApp());
    const res = await rawGet(`${url}/gzip-only.txt`, { 'accept-encoding': 'br, gzip' });

    expect(res.body).toBe('gzip-only-variant');
    expect(res.headers['content-encoding']).toBe('gzip');
  });

  test('serves identity with vary when the client accepts no encoding', async () => {
    const url = await startServer(createApp());
    const res = await rawGet(`${url}/hello.txt`);

    expect(res.body).toBe('identity content');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['vary']).toBe('Accept-Encoding');
  });

  test('never negotiates non-compressible extensions even when a variant file exists', async () => {
    const url = await startServer(createApp());
    const res = await rawGet(`${url}/image.png`, { 'accept-encoding': 'br' });

    expect(res.body).toBe('png bytes');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['vary']).toBeUndefined();
  });

  test('answers conditional requests with 304 keeping variant headers', async () => {
    const url = await startServer(createApp());
    const first = await rawGet(`${url}/hello.txt`, { 'accept-encoding': 'br' });
    const etag = first.headers['etag'];

    expect(etag).toBeTruthy();

    const second = await rawGet(`${url}/hello.txt`, { 'accept-encoding': 'br', 'if-none-match': etag! });

    expect(second.status).toBe(304);
    expect(second.headers['vary']).toBe('Accept-Encoding');
  });
});

describe('trailing slash handling', () => {
  test('never: redirects directory requests with a trailing slash', async () => {
    const url = await startServer(createApp({ trailingSlash: 'never' }));
    const res = await rawGet(`${url}/docs/?a=1`);

    expect(res.status).toBe(301);
    expect(res.headers['location']).toBe('/docs?a=1');
  });

  test('never: serves the directory index without a trailing slash', async () => {
    const url = await startServer(createApp({ trailingSlash: 'never' }));
    const res = await rawGet(`${url}/docs`);

    expect(res.status).toBe(200);
    expect(res.body).toBe('docs index');
  });

  test('never: does not redirect the root path', async () => {
    const url = await startServer(createApp({ trailingSlash: 'never' }));
    const res = await rawGet(`${url}/`);

    expect(res.status).toBe(200);
    expect(res.body).toBe('root index');
  });

  test('always: redirects extension-less paths to the slashed form', async () => {
    const url = await startServer(createApp({ trailingSlash: 'always' }));
    const res = await rawGet(`${url}/docs?a=1`);

    expect(res.status).toBe(301);
    expect(res.headers['location']).toBe('/docs/?a=1');
  });

  test('always: does not redirect paths with a file extension', async () => {
    const url = await startServer(createApp({ trailingSlash: 'always' }));
    const res = await rawGet(`${url}/hello.txt`);

    expect(res.status).toBe(200);
    expect(res.body).toBe('identity content');
  });

  test('always: does not redirect underscore-prefixed paths', async () => {
    const url = await startServer(createApp({ trailingSlash: 'always' }));
    const res = await rawGet(`${url}/_internal`);

    expect(res.status).toBe(555);
    expect(res.body).toBe('ssr-fallback');
  });

  test('ignore: serves the directory index with and without a trailing slash', async () => {
    const url = await startServer(createApp({ trailingSlash: 'ignore' }));

    expect((await rawGet(`${url}/docs`)).body).toBe('docs index');
    expect((await rawGet(`${url}/docs/`)).body).toBe('docs index');
  });
});

describe('build format', () => {
  test('file: resolves extension-less pages to their .html file', async () => {
    const url = await startServer(createApp({ buildFormat: 'file' }));
    const res = await rawGet(`${url}/page`);

    expect(res.status).toBe(200);
    expect(res.body).toBe('file format page');
  });

  test('directory: does not append .html to extension-less paths', async () => {
    const url = await startServer(createApp({ buildFormat: 'directory' }));
    const res = await rawGet(`${url}/page`);

    expect(res.status).toBe(555);
    expect(res.body).toBe('ssr-fallback');
  });
});

describe('protection', () => {
  test('never serves files outside the client dir', async () => {
    const url = await startServer(createApp());

    for (const target of ['/..%2foutside.txt', '/%2e%2e/outside.txt', '/docs/..%2f..%2foutside.txt']) {
      const res = await rawGet(`${url}${target}`);

      expect(res.body, target).not.toContain('outside secret');
      expect(res.status, target).not.toBe(200);
    }
  });

  test('denies dotfiles outside /.well-known/', async () => {
    const url = await startServer(createApp());
    const res = await rawGet(`${url}/.secret`);

    expect(res.body).not.toContain('hidden dotfile');
    expect(res.status).not.toBe(200);
  });

  test('allows dotfiles under /.well-known/', async () => {
    const url = await startServer(createApp());
    const res = await rawGet(`${url}/.well-known/security.txt`);

    expect(res.status).toBe(200);
    expect(res.body).toBe('security contact');
  });
});

describe('caching', () => {
  test('marks assets under the assets dir as immutable', async () => {
    const url = await startServer(createApp());
    const res = await rawGet(`${url}/_astro/app.css`);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  test('does not mark other files as immutable', async () => {
    const url = await startServer(createApp());
    const res = await rawGet(`${url}/hello.txt`);

    expect(res.headers['cache-control']).not.toContain('immutable');
  });
});
