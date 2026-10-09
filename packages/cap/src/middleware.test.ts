import type { APIContext, MiddlewareNext } from 'astro';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createCapMiddleware } from './middleware';
import { cap } from './runtime';

vi.mock('@astroscope/node/log', () => ({
  log: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function createContext(url: string, init: RequestInit = {}) {
  return {
    url: new URL(url),
    request: new Request(url, init),
    clientAddress: '203.0.113.7',
  } as unknown as APIContext;
}

const passed = new Response('passed');
const next: MiddlewareNext = vi.fn(async () => passed);

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn(async () => responses.shift() ?? new Response(null, { status: 500 }));

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

const middleware = createCapMiddleware({ path: '/_cap/' });

beforeEach(() => {
  cap.configure({ baseUrl: 'http://cap.test:3000/', siteKey: 'site', secretKey: 'secret' });
  vi.mocked(next).mockClear();
});

afterEach(() => {
  cap.reset();
  vi.unstubAllGlobals();
});

describe('proxy', () => {
  test('forwards challenge to the site key path with filtered headers', async () => {
    const fetchMock = mockFetch(Response.json({ challenge: { c: 1 }, token: 't' }));
    const ctx = createContext('https://example.com/_cap/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'session=1', authorization: 'x' },
      body: '{}',
    });

    const response = (await middleware(ctx, next)) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: { c: 1 }, token: 't' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Headers;

    expect(url).toBe('http://cap.test:3000/site/challenge');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-forwarded-for')).toBe('203.0.113.7');
    expect(headers.has('cookie')).toBe(false);
    expect(headers.has('authorization')).toBe(false);
  });

  test('passes the redeem answer through untouched', async () => {
    mockFetch(Response.json({ success: true, token: 'tok', expires: 1 }, { status: 200 }));

    const ctx = createContext('https://example.com/_cap/redeem', { method: 'POST', body: '{}' });
    const response = (await middleware(ctx, next)) as Response;

    expect(await response.json()).toEqual({ success: true, token: 'tok', expires: 1 });
  });

  test('answers 404 for other endpoints and methods', async () => {
    const fetchMock = mockFetch();

    for (const [url, method] of [
      ['https://example.com/_cap/siteverify', 'POST'],
      ['https://example.com/_cap/challenge', 'GET'],
    ] as const) {
      expect(((await middleware(createContext(url, { method }), next)) as Response).status).toBe(404);
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('answers 503 while not configured', async () => {
    cap.reset();

    const fetchMock = mockFetch();
    const ctx = createContext('https://example.com/_cap/challenge', { method: 'POST', body: '{}' });

    expect(((await middleware(ctx, next)) as Response).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('answers 502 when the service cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    const ctx = createContext('https://example.com/_cap/challenge', { method: 'POST', body: '{}' });

    expect(((await middleware(ctx, next)) as Response).status).toBe(502);
  });

  test('leaves other requests to the next handler', async () => {
    expect(await middleware(createContext('https://example.com/page'), next)).toBe(passed);
  });
});
