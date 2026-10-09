import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { evaluatePathRedirect, redirectPath } from './path-redirects';

describe('evaluatePathRedirect', () => {
  describe('duplicate slashes', () => {
    test('leaves clean paths alone', () => {
      expect(evaluatePathRedirect('/', 'GET', 'ignore')).toBeUndefined();
      expect(evaluatePathRedirect('/products/red', 'GET', 'ignore')).toBeUndefined();
      expect(evaluatePathRedirect('/products/', 'GET', 'ignore')).toBeUndefined();
      expect(evaluatePathRedirect('/_astro/x.js', 'GET', 'ignore')).toBeUndefined();
    });

    test('collapses duplicate slashes anywhere in the path', () => {
      expect(evaluatePathRedirect('//products', 'GET', 'ignore')).toEqual({
        status: 301,
        location: '/products',
        route: 'duplicate-slashes',
      });
      expect(evaluatePathRedirect('/docs///guides//x', 'GET', 'ignore')?.location).toBe('/docs/guides/x');
      expect(evaluatePathRedirect('/products//', 'GET', 'ignore')?.location).toBe('/products/');
      expect(evaluatePathRedirect('///', 'GET', 'ignore')?.location).toBe('/');
    });

    test('keeps the query string as sent, duplicate slashes included', () => {
      expect(evaluatePathRedirect('//products?next=//x&a=1', 'GET', 'ignore')?.location).toBe('/products?next=//x&a=1');
      expect(evaluatePathRedirect('/products?next=//x', 'GET', 'ignore')).toBeUndefined();
    });

    test('ignores encoded slashes', () => {
      expect(evaluatePathRedirect('/products%2F%2Fred', 'GET', 'ignore')).toBeUndefined();
      expect(evaluatePathRedirect('/%2F/products', 'GET', 'ignore')).toBeUndefined();
    });

    test('ignores absolute-form and asterisk-form request targets', () => {
      expect(evaluatePathRedirect('http://example.com//products', 'GET', 'never')).toBeUndefined();
      expect(evaluatePathRedirect('*', 'OPTIONS', 'never')).toBeUndefined();
      expect(evaluatePathRedirect('', 'GET', 'never')).toBeUndefined();
    });

    test('never produces a scheme-relative location', () => {
      expect(evaluatePathRedirect('//evil.com/x', 'GET', 'never')?.location).toBe('/evil.com/x');
      expect(evaluatePathRedirect('//\\evil.com/x', 'GET', 'never')).toBeUndefined();
      expect(evaluatePathRedirect('///\\evil.com', 'GET', 'never')).toBeUndefined();
      expect(evaluatePathRedirect('/\\evil.com', 'GET', 'always')).toBeUndefined();
    });
  });

  describe('trailing slash', () => {
    test('never: strips it from pages, endpoints and files, keeping the query', () => {
      expect(evaluatePathRedirect('/products/', 'GET', 'never')).toEqual({
        status: 301,
        location: '/products',
        route: 'trailing-slash',
      });
      expect(evaluatePathRedirect('/api/', 'GET', 'never')?.location).toBe('/api');
      expect(evaluatePathRedirect('/hello.txt/', 'GET', 'never')?.location).toBe('/hello.txt');
      expect(evaluatePathRedirect('/products/?x=1', 'GET', 'never')?.location).toBe('/products?x=1');
      expect(evaluatePathRedirect('/products', 'GET', 'never')).toBeUndefined();
    });

    test('always: appends it except to files', () => {
      expect(evaluatePathRedirect('/products', 'GET', 'always')).toEqual({
        status: 301,
        location: '/products/',
        route: 'trailing-slash',
      });
      expect(evaluatePathRedirect('/products?x=1', 'GET', 'always')?.location).toBe('/products/?x=1');
      expect(evaluatePathRedirect('/products/', 'GET', 'always')).toBeUndefined();
      expect(evaluatePathRedirect('/hello.txt', 'GET', 'always')).toBeUndefined();
    });

    test('ignore: leaves both spellings alone', () => {
      expect(evaluatePathRedirect('/products/', 'GET', 'ignore')).toBeUndefined();
      expect(evaluatePathRedirect('/products', 'GET', 'ignore')).toBeUndefined();
    });

    test('leaves the root and astro internals alone', () => {
      expect(evaluatePathRedirect('/', 'GET', 'always')).toBeUndefined();
      expect(evaluatePathRedirect('/', 'GET', 'never')).toBeUndefined();
      expect(evaluatePathRedirect('/_astro/chunk', 'GET', 'always')).toBeUndefined();
      expect(evaluatePathRedirect('/_image/', 'GET', 'never')).toBeUndefined();
      expect(evaluatePathRedirect('/@vite/client/', 'GET', 'never')).toBeUndefined();
      expect(evaluatePathRedirect('/.well-known/x/', 'GET', 'never')).toBeUndefined();
    });

    test('duplicate and trailing slashes resolve in one hop, labelled as duplicates', () => {
      expect(evaluatePathRedirect('/products//', 'GET', 'never')).toEqual({
        status: 301,
        location: '/products',
        route: 'duplicate-slashes',
      });
      expect(evaluatePathRedirect('//products', 'GET', 'always')?.location).toBe('/products/');
    });
  });

  test('uses 301 for GET and HEAD, 308 for every other method', () => {
    expect(evaluatePathRedirect('/products/', 'HEAD', 'never')?.status).toBe(301);
    expect(evaluatePathRedirect('/products/', 'POST', 'never')?.status).toBe(308);
    expect(evaluatePathRedirect('//products', 'PUT', 'never')?.status).toBe(308);
    expect(evaluatePathRedirect('//products', undefined, 'never')?.status).toBe(308);
  });
});

describe('redirectPath', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  async function startServer(): Promise<string> {
    const server = createServer((req, res) => {
      if (redirectPath(req, res, 'never')) return;

      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`served ${req.url}`);
    });

    servers.push(server);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  test('answers with an empty redirect and lets canonical requests through', async () => {
    const baseUrl = await startServer();

    const redirected = await fetch(`${baseUrl}//products//red/?x=1`, { redirect: 'manual' });

    expect(redirected.status).toBe(301);
    expect(redirected.headers.get('location')).toBe('/products/red?x=1');
    expect(await redirected.text()).toBe('');

    const posted = await fetch(`${baseUrl}/api/`, { method: 'POST', redirect: 'manual' });

    expect(posted.status).toBe(308);
    expect(posted.headers.get('location')).toBe('/api');

    const clean = await fetch(`${baseUrl}/products/red`);

    expect(clean.status).toBe(200);
    expect(await clean.text()).toBe('served /products/red');
  });
});
