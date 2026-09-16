import type { APIContext, RouteData } from 'astro';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { setRequestRouteData } from '../server/route-store';
import { registerDocumentEmitter } from './emitters';
import { createIslandsMiddleware } from './middleware';
import type { IslandsManifest } from './types';

const REGISTRY = Symbol.for('@astroscope/node.islandEmitters');
const DOCUMENT_REGISTRY = Symbol.for('@astroscope/node.documentEmitters');

const manifest: IslandsManifest = {
  runtimeSource: '/* gate runtime */',
  chunks: {
    '_astro/Cart.aaa.js': { i: ['_astro/shared.bbb.js'] },
    '_astro/shared.bbb.js': {},
  },
};

const HTML =
  '<html><body><astro-island component-url="/_astro/Cart.aaa.js" client="load" opts="{}"></astro-island></body></html>';

function htmlResponse(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
}

function createContext(routeType?: RouteData['type']): APIContext {
  const request = new Request('http://localhost/page');
  const locals = {};

  if (routeType) {
    setRequestRouteData(request, locals, { type: routeType } as RouteData);
  }

  return { request, locals } as APIContext;
}

async function run(
  middleware: ReturnType<typeof createIslandsMiddleware>,
  response: Response,
  context: APIContext = createContext(),
): Promise<Response> {
  return (await middleware(context, () => Promise.resolve(response))) as Response;
}

beforeEach(() => {
  (globalThis as Record<symbol, unknown>)[REGISTRY] = [];
  (globalThis as Record<symbol, unknown>)[DOCUMENT_REGISTRY] = [];
});

describe('createIslandsMiddleware', () => {
  test('rewrites streamed html responses', async () => {
    const middleware = createIslandsMiddleware(manifest);
    const result = await run(middleware, htmlResponse(HTML));

    expect(await result.text()).toContain('<link rel="modulepreload"');
  });

  test('drops a stale content-length', async () => {
    const middleware = createIslandsMiddleware(manifest);
    const result = await run(middleware, htmlResponse(HTML, { 'content-length': String(HTML.length) }));

    expect(result.headers.get('content-length')).toBeNull();
    expect(result.headers.get('content-type')).toContain('text/html');
  });

  test('passes non-html responses through untouched', async () => {
    const middleware = createIslandsMiddleware(manifest);
    const response = new Response('{"a":1}', { headers: { 'content-type': 'application/json' } });

    expect(await run(middleware, response)).toBe(response);
  });

  test('passes already-encoded responses through untouched', async () => {
    const middleware = createIslandsMiddleware(manifest);
    const response = htmlResponse(HTML, { 'content-encoding': 'br' });

    expect(await run(middleware, response)).toBe(response);
  });

  test('passes html from non-page routes through untouched', async () => {
    const middleware = createIslandsMiddleware(manifest);
    const response = htmlResponse(HTML);

    expect(await run(middleware, response, createContext('endpoint'))).toBe(response);
  });

  test('rewrites html from page routes', async () => {
    const middleware = createIslandsMiddleware(manifest);
    const result = await run(middleware, htmlResponse(HTML), createContext('page'));

    expect(await result.text()).toContain('modulepreload');
  });

  test('keeps the route type when a rewrite replaced the request', async () => {
    const middleware = createIslandsMiddleware(manifest);
    const context = createContext('endpoint');
    const response = htmlResponse(HTML);

    // astro copies the request on every `next(url)` rewrite — locals stay the same object
    context.request = new Request('http://localhost/rewritten');

    expect(await run(middleware, response, context)).toBe(response);
  });

  test('is inert without a manifest and without document emitters', async () => {
    const middleware = createIslandsMiddleware(null);
    const response = htmlResponse(HTML);

    expect(await run(middleware, response)).toBe(response);
  });

  test('preserves status and statusText', async () => {
    const middleware = createIslandsMiddleware(manifest);
    const response = new Response(HTML, {
      status: 404,
      statusText: 'Not Found',
      headers: { 'content-type': 'text/html' },
    });

    const result = await run(middleware, response);

    expect(result.status).toBe(404);
    expect(result.statusText).toBe('Not Found');
    expect(await result.text()).toContain('modulepreload');
  });
});

describe('document emitters', () => {
  const HEAD_HTML = `<html><head><title>x</title></head><body>${HTML}</body></html>`;

  test('head content is inserted right after <head>, without a manifest', async () => {
    registerDocumentEmitter(() => ({ head: '<script>head()</script>' }));

    const middleware = createIslandsMiddleware(null);
    const result = await run(middleware, htmlResponse(HEAD_HTML));
    const out = await result.text();

    expect(out.indexOf('head()')).toBeGreaterThan(out.indexOf('<head>'));
    expect(out.indexOf('head()')).toBeLessThan(out.indexOf('<title>'));
  });

  test('head content is prepended when the document has no head', async () => {
    registerDocumentEmitter(() => ({ head: '<script>head()</script>' }));

    const middleware = createIslandsMiddleware(null);
    const result = await run(middleware, htmlResponse('<div>fragment</div>'));

    expect(await result.text()).toBe('<script>head()</script><div>fragment</div>');
  });

  test('end content is appended after the rewritten document', async () => {
    registerDocumentEmitter(() => ({ end: () => '<script>end()</script>' }));

    const middleware = createIslandsMiddleware(manifest);
    const result = await run(middleware, htmlResponse(HTML));
    const out = await result.text();

    expect(out.endsWith('<script>end()</script>')).toBe(true);
    expect(out.indexOf('modulepreload')).toBeLessThan(out.indexOf('end()'));
  });

  test('an end factory returning null appends nothing', async () => {
    registerDocumentEmitter(() => ({ end: () => null }));

    const middleware = createIslandsMiddleware(null);
    const result = await run(middleware, htmlResponse('<html></html>'));

    expect(await result.text()).toBe('<html></html>');
  });

  test('emitters contributing nothing leave the response untouched', async () => {
    registerDocumentEmitter(() => null);

    const middleware = createIslandsMiddleware(null);
    const response = htmlResponse(HTML);

    expect(await run(middleware, response)).toBe(response);
  });

  test('a throwing emitter is dropped without breaking the page', async () => {
    registerDocumentEmitter(() => {
      throw new Error('boom');
    });
    registerDocumentEmitter(() => ({ end: () => '<script>end()</script>' }));

    const middleware = createIslandsMiddleware(null);
    const result = await run(middleware, htmlResponse('<html></html>'));

    expect(await result.text()).toBe('<html></html><script>end()</script>');
  });

  test('a throwing end factory is dropped without breaking the page', async () => {
    registerDocumentEmitter(() => ({
      end: () => {
        throw new Error('boom');
      },
    }));
    registerDocumentEmitter(() => ({ end: () => '<script>end()</script>' }));

    const middleware = createIslandsMiddleware(null);
    const result = await run(middleware, htmlResponse('<html></html>'));

    expect(await result.text()).toBe('<html></html><script>end()</script>');
  });

  test('document emitters are skipped for non-page routes', async () => {
    const emitter = vi.fn(() => ({ head: '<script>head()</script>' }));

    registerDocumentEmitter(emitter);

    const middleware = createIslandsMiddleware(null);
    const response = htmlResponse(HTML);

    expect(await run(middleware, response, createContext('endpoint'))).toBe(response);
    expect(emitter).not.toHaveBeenCalled();
  });

  test('head and end compose with the rewriter', async () => {
    registerDocumentEmitter(() => ({ head: '<script>head()</script>', end: () => '<script>end()</script>' }));

    const middleware = createIslandsMiddleware(manifest);
    const result = await run(middleware, htmlResponse(HEAD_HTML));
    const out = await result.text();

    expect(out.indexOf('head()')).toBeLessThan(out.indexOf('<title>'));
    expect(out).toContain('modulepreload');
    expect(out.endsWith('<script>end()</script>')).toBe(true);
  });
});
