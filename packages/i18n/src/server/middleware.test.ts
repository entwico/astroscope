import type { APIContext, MiddlewareHandler, MiddlewareNext } from 'astro';
import { describe, expect, test, vi } from 'vitest';
import type { ExtractionManifest } from '../extraction/types';
import type { I18nContext } from './types';

const mocks = vi.hoisted(() => ({
  manifest: { keys: [], chunks: {}, imports: {} } as {
    keys: { key: string; meta: { fallback: string }; files: string[] }[];
    chunks: Record<string, string[]>;
    imports: Record<string, string[]>;
  },
  overrideRequestRoute: vi.fn(),
}));

vi.mock('virtual:@astroscope/i18n/manifest', () => ({
  getManifest: () => mocks.manifest,
}));

vi.mock('@astroscope/node/log', () => ({
  overrideRequestRoute: mocks.overrideRequestRoute,
}));

async function load(options?: { configured?: boolean; manifest?: Partial<ExtractionManifest> }) {
  mocks.manifest = { keys: [], chunks: {}, imports: {}, ...options?.manifest };
  mocks.overrideRequestRoute.mockClear();

  vi.resetModules();

  const { i18n } = await import('./i18n');
  const { createI18nChunkMiddleware, createI18nMiddleware } = await import('./middleware');
  const { getContext } = await import('./context');

  if (options?.configured ?? true) {
    await i18n.configure({ locales: ['en', 'de'] });
  }

  return { createI18nChunkMiddleware, createI18nMiddleware, getContext, i18n };
}

const createCtx = (path: string): APIContext => ({ url: new URL(`http://localhost${path}`) }) as APIContext;

async function invoke(handler: MiddlewareHandler, ctx: APIContext, next: MiddlewareNext): Promise<Response> {
  const result = await handler(ctx, next);

  expect(result).toBeInstanceOf(Response);

  return result as Response;
}

const createNext = (onCall?: () => void) => {
  const response = new Response('from next');
  const next = vi.fn(async () => {
    onCall?.();

    return response;
  }) as unknown as MiddlewareNext & ReturnType<typeof vi.fn>;

  return { next, response };
};

describe('createI18nChunkMiddleware', () => {
  const chunkManifest = { chunks: { 'Cart.Cabc': ['cart.title'] } };

  test('passes through non-i18n paths', async () => {
    const { createI18nChunkMiddleware } = await load();
    const { next, response } = createNext();

    const result = await invoke(createI18nChunkMiddleware(), createCtx('/some/page'), next);

    expect(next).toHaveBeenCalledOnce();
    expect(result).toBe(response);
  });

  test('reports the endpoint route for served chunks', async () => {
    const { createI18nChunkMiddleware, i18n } = await load({ manifest: chunkManifest });

    i18n.setTranslations('en', { 'cart.title': 'Cart' });

    const result = await invoke(
      createI18nChunkMiddleware(),
      createCtx('/_i18n/en/Cart.Cabc.hash.js'),
      createNext().next,
    );

    expect(result.status).toBe(200);
    expect(mocks.overrideRequestRoute).toHaveBeenCalledWith('/_i18n/[locale]/[chunk]');
  });

  test('reports the endpoint route for chunk 404s', async () => {
    const { createI18nChunkMiddleware } = await load({ manifest: chunkManifest });

    const result = await invoke(
      createI18nChunkMiddleware(),
      createCtx('/_i18n/en/Nope.Cxyz.hash.js'),
      createNext().next,
    );

    expect(result.status).toBe(404);
    expect(mocks.overrideRequestRoute).toHaveBeenCalledWith('/_i18n/[locale]/[chunk]');
  });

  test('leaves the route alone when passing through to astro', async () => {
    const { createI18nChunkMiddleware } = await load({ manifest: chunkManifest });

    await invoke(createI18nChunkMiddleware(), createCtx('/some/page'), createNext().next);
    await invoke(createI18nChunkMiddleware(), createCtx('/_i18n/en/Cart.Cabc.hash.css'), createNext().next);

    expect(mocks.overrideRequestRoute).not.toHaveBeenCalled();
  });

  test('warns and passes through when not configured', async () => {
    const { createI18nChunkMiddleware } = await load({ configured: false });
    const { next, response } = createNext();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await invoke(createI18nChunkMiddleware(), createCtx('/_i18n/en/Cart.Cabc.hash.js'), next);

    expect(warn).toHaveBeenCalledOnce();
    expect(result).toBe(response);

    warn.mockRestore();
  });

  test('passes through when the path has no chunk segment', async () => {
    const { createI18nChunkMiddleware } = await load({ manifest: chunkManifest });
    const { next, response } = createNext();

    const result = await invoke(createI18nChunkMiddleware(), createCtx('/_i18n/en.js'), next);

    expect(result).toBe(response);
  });

  test('returns 404 for unknown locales', async () => {
    const { createI18nChunkMiddleware } = await load({ manifest: chunkManifest });
    const { next } = createNext();

    const result = await invoke(createI18nChunkMiddleware(), createCtx('/_i18n/fr/Cart.Cabc.hash.js'), next);

    expect(result.status).toBe(404);
    expect(await result.text()).toContain('unknown locale');
    expect(next).not.toHaveBeenCalled();
  });

  test('passes through when the file is not a .js file', async () => {
    const { createI18nChunkMiddleware } = await load({ manifest: chunkManifest });
    const { next, response } = createNext();

    const result = await invoke(createI18nChunkMiddleware(), createCtx('/_i18n/en/Cart.Cabc.hash.css'), next);

    expect(result).toBe(response);
  });

  test('passes through when the file name has no hash segment', async () => {
    const { createI18nChunkMiddleware } = await load({ manifest: chunkManifest });
    const { next, response } = createNext();

    const result = await invoke(createI18nChunkMiddleware(), createCtx('/_i18n/en/chunkhash.js'), next);

    expect(result).toBe(response);
  });

  test('returns 404 for chunks missing from the manifest', async () => {
    const { createI18nChunkMiddleware } = await load({ manifest: chunkManifest });
    const { next } = createNext();

    const result = await invoke(createI18nChunkMiddleware(), createCtx('/_i18n/en/Nope.Cxyz.hash.js'), next);

    expect(result.status).toBe(404);
    expect(await result.text()).toContain('chunk not found');
  });

  test('serves a known chunk with immutable caching headers', async () => {
    const { createI18nChunkMiddleware, i18n } = await load({ manifest: chunkManifest });
    const { next } = createNext();

    i18n.setTranslations('en', { 'cart.title': 'Cart' });

    const result = await invoke(createI18nChunkMiddleware(), createCtx('/_i18n/en/Cart.Cabc.deadbeef.js'), next);
    const body = await result.text();

    expect(result.status).toBe(200);
    expect(result.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8');
    expect(result.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(result.headers.get('Content-Length')).toBe(String(new TextEncoder().encode(body).byteLength));
    expect(body).toContain('"cart.title":"Cart"');
    expect(next).not.toHaveBeenCalled();
  });
});

describe('createI18nMiddleware', () => {
  test('skips excluded paths without setting up a context', async () => {
    const { createI18nMiddleware, getContext } = await load();
    const locale = vi.fn(() => 'en');
    let contextInsideNext: I18nContext | null | undefined;
    const { next, response } = createNext(() => {
      contextInsideNext = getContext();
    });

    const result = await invoke(createI18nMiddleware({ locale }), createCtx('/_astro/chunk.js'), next);

    expect(result).toBe(response);
    expect(locale).not.toHaveBeenCalled();
    expect(contextInsideNext).toBeNull();
  });

  test('supports custom exclude patterns', async () => {
    const { createI18nMiddleware } = await load();
    const locale = vi.fn(() => 'en');
    const { next } = createNext();

    await createI18nMiddleware({ locale, exclude: [{ exact: '/health' }] })(createCtx('/health'), next);

    expect(locale).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  test('supports an exclude function', async () => {
    const { createI18nMiddleware } = await load();
    const locale = vi.fn(() => 'en');
    const { next } = createNext();
    const exclude = vi.fn((ctx: APIContext) => ctx.url.pathname === '/skip');

    await createI18nMiddleware({ locale, exclude })(createCtx('/skip'), next);

    expect(locale).not.toHaveBeenCalled();

    await createI18nMiddleware({ locale, exclude })(createCtx('/page'), next);

    expect(locale).toHaveBeenCalledOnce();
  });

  test('empty exclude list disables the default excludes', async () => {
    const { createI18nMiddleware } = await load();
    const locale = vi.fn(() => 'en');
    const { next } = createNext();

    await createI18nMiddleware({ locale, exclude: [] })(createCtx('/_astro/chunk.js'), next);

    expect(locale).toHaveBeenCalledOnce();
  });

  test('warns and passes through when not configured', async () => {
    const { createI18nMiddleware, getContext } = await load({ configured: false });
    let contextInsideNext: I18nContext | null | undefined;
    const { next, response } = createNext(() => {
      contextInsideNext = getContext();
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await invoke(createI18nMiddleware({ locale: () => 'en' }), createCtx('/page'), next);

    expect(warn).toHaveBeenCalledOnce();
    expect(result).toBe(response);
    expect(contextInsideNext).toBeNull();

    warn.mockRestore();
  });

  test('runs next within a context built from the resolved locale', async () => {
    const { createI18nMiddleware, getContext, i18n } = await load();
    let contextInsideNext: I18nContext | null | undefined;
    const { next, response } = createNext(() => {
      contextInsideNext = getContext();
    });

    i18n.setTranslations('de', { greeting: 'Hallo' });

    const ctx = createCtx('/page');
    const locale = vi.fn((c: APIContext) => (c === ctx ? 'de' : 'en'));

    const result = await invoke(createI18nMiddleware({ locale }), ctx, next);

    expect(result).toBe(response);
    expect(contextInsideNext?.locale).toBe('de');
    expect(contextInsideNext?.fallback).toBe('fallback');
    expect(contextInsideNext?.rawTranslations).toEqual({ greeting: 'Hallo' });
    expect(contextInsideNext?.translations['greeting']?.()).toBe('Hallo');
  });

  test('context does not leak outside the request', async () => {
    const { createI18nMiddleware, getContext } = await load();
    const { next } = createNext();

    await createI18nMiddleware({ locale: () => 'en' })(createCtx('/page'), next);

    expect(getContext()).toBeNull();
  });
});
