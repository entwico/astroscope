import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { evaluateDuplicateSlashes, redirectDuplicateSlashes } from './duplicate-slashes';

describe('evaluateDuplicateSlashes', () => {
  test('leaves clean paths alone', () => {
    expect(evaluateDuplicateSlashes('/', 'GET')).toBeUndefined();
    expect(evaluateDuplicateSlashes('/weine/rotwein', 'GET')).toBeUndefined();
    expect(evaluateDuplicateSlashes('/weine/', 'GET')).toBeUndefined();
    expect(evaluateDuplicateSlashes('/_astro/x.js', 'GET')).toBeUndefined();
  });

  test('collapses duplicate slashes anywhere in the path', () => {
    expect(evaluateDuplicateSlashes('//weine', 'GET')).toEqual({ status: 301, location: '/weine' });
    expect(evaluateDuplicateSlashes('/seminare///z7z7//x', 'GET')).toEqual({
      status: 301,
      location: '/seminare/z7z7/x',
    });
    expect(evaluateDuplicateSlashes('/weine//', 'GET')).toEqual({ status: 301, location: '/weine/' });
    expect(evaluateDuplicateSlashes('///', 'GET')).toEqual({ status: 301, location: '/' });
  });

  test('keeps the query string as sent, duplicate slashes included', () => {
    expect(evaluateDuplicateSlashes('//weine?next=//x&a=1', 'GET')).toEqual({
      status: 301,
      location: '/weine?next=//x&a=1',
    });
    expect(evaluateDuplicateSlashes('/weine?next=//x', 'GET')).toBeUndefined();
  });

  test('uses 301 for GET and HEAD, 308 for every other method', () => {
    expect(evaluateDuplicateSlashes('//weine', 'HEAD')?.status).toBe(301);
    expect(evaluateDuplicateSlashes('//weine', 'POST')?.status).toBe(308);
    expect(evaluateDuplicateSlashes('//weine', 'PUT')?.status).toBe(308);
    expect(evaluateDuplicateSlashes('//weine', undefined)?.status).toBe(308);
  });

  test('ignores encoded slashes', () => {
    expect(evaluateDuplicateSlashes('/weine%2F%2Frotwein', 'GET')).toBeUndefined();
    expect(evaluateDuplicateSlashes('/%2F/weine', 'GET')).toBeUndefined();
  });

  test('ignores absolute-form and asterisk-form request targets', () => {
    expect(evaluateDuplicateSlashes('http://example.com//weine', 'GET')).toBeUndefined();
    expect(evaluateDuplicateSlashes('*', 'OPTIONS')).toBeUndefined();
    expect(evaluateDuplicateSlashes('', 'GET')).toBeUndefined();
  });

  test('never produces a scheme-relative location', () => {
    expect(evaluateDuplicateSlashes('//evil.com/x', 'GET')).toEqual({ status: 301, location: '/evil.com/x' });
    expect(evaluateDuplicateSlashes('//\\evil.com/x', 'GET')).toBeUndefined();
    expect(evaluateDuplicateSlashes('///\\evil.com', 'GET')).toBeUndefined();
  });
});

describe('redirectDuplicateSlashes', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  });

  async function startServer(): Promise<string> {
    const server = createServer((req, res) => {
      if (redirectDuplicateSlashes(req, res)) return;

      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`served ${req.url}`);
    });

    servers.push(server);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  test('answers with an empty redirect and lets clean requests through', async () => {
    const baseUrl = await startServer();

    const redirected = await fetch(`${baseUrl}//weine//rotwein?x=1`, { redirect: 'manual' });

    expect(redirected.status).toBe(301);
    expect(redirected.headers.get('location')).toBe('/weine/rotwein?x=1');
    expect(await redirected.text()).toBe('');

    const posted = await fetch(`${baseUrl}//api`, { method: 'POST', redirect: 'manual' });

    expect(posted.status).toBe(308);
    expect(posted.headers.get('location')).toBe('/api');

    const clean = await fetch(`${baseUrl}/weine/rotwein`);

    expect(clean.status).toBe(200);
    expect(await clean.text()).toBe('served /weine/rotwein');
  });
});
