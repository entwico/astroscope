import type { APIContext } from 'astro';
import { describe, expect, test, vi } from 'vitest';
import { createCsrfMiddleware } from './middleware';

function makeContext(url: string, init?: RequestInit): APIContext {
  return { url: new URL(url), request: new Request(url, init) } as APIContext;
}

function makeNext() {
  const response = new Response('from next');

  return { next: vi.fn(() => Promise.resolve(response)), response };
}

describe('createCsrfMiddleware', () => {
  test('lets safe methods through without an origin header', async () => {
    const middleware = createCsrfMiddleware([]);

    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const { next, response } = makeNext();

      await expect(middleware(makeContext('https://example.com/page', { method }), next)).resolves.toBe(response);
      expect(next).toHaveBeenCalledOnce();
    }
  });

  test('blocks state-changing methods without an origin header', async () => {
    const middleware = createCsrfMiddleware([]);

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const { next } = makeNext();
      const result = await middleware(makeContext('https://example.com/form', { method }), next);

      expect(result?.status).toBe(403);
      await expect(result?.text()).resolves.toBe(`Cross-site ${method} request forbidden`);
      expect(next).not.toHaveBeenCalled();
    }
  });

  test('blocks requests whose origin does not match the request url origin', async () => {
    const middleware = createCsrfMiddleware([]);
    const { next } = makeNext();
    const ctx = makeContext('https://example.com/form', { method: 'POST', headers: { origin: 'https://evil.com' } });

    const result = await middleware(ctx, next);

    expect(result?.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('treats a differing port as a foreign origin', async () => {
    const middleware = createCsrfMiddleware([]);
    const { next } = makeNext();
    const ctx = makeContext('http://localhost:4321/form', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
    });

    const result = await middleware(ctx, next);

    expect(result?.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('lets same-origin state-changing requests through', async () => {
    const middleware = createCsrfMiddleware([]);
    const { next, response } = makeNext();
    const ctx = makeContext('https://example.com/form', {
      method: 'POST',
      headers: { origin: 'https://example.com' },
    });

    await expect(middleware(ctx, next)).resolves.toBe(response);
    expect(next).toHaveBeenCalledOnce();
  });

  test('skips the check for excluded paths', async () => {
    const middleware = createCsrfMiddleware([{ prefix: '/api/webhooks/' }]);
    const { next, response } = makeNext();
    const ctx = makeContext('https://example.com/api/webhooks/stripe', { method: 'POST' });

    await expect(middleware(ctx, next)).resolves.toBe(response);
    expect(next).toHaveBeenCalledOnce();
  });

  test('still enforces the check outside excluded paths', async () => {
    const middleware = createCsrfMiddleware([{ prefix: '/api/webhooks/' }]);
    const { next } = makeNext();
    const ctx = makeContext('https://example.com/api/other', { method: 'POST' });

    const result = await middleware(ctx, next);

    expect(result?.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});
