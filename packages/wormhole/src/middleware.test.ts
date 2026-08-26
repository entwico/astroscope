import type { APIContext, MiddlewareNext } from 'astro';
import { describe, expect, test, vi } from 'vitest';
import type { WormholeManifest } from './extraction/types';
import type { Wormhole } from './types';

const REGISTRY = Symbol.for('@astroscope/node.islandEmitters');
const DOCUMENT_REGISTRY = Symbol.for('@astroscope/node.documentEmitters');

const mocks = vi.hoisted(() => ({
  manifest: null as WormholeManifest | null,
  registry: {} as Record<string, Wormhole<unknown>>,
}));

vi.mock('virtual:@astroscope/wormhole/manifest', () => ({
  get manifest() {
    return mocks.manifest;
  },
}));

vi.mock('virtual:@astroscope/wormhole/registry', () => ({
  get wormholes() {
    return mocks.registry;
  },
}));

async function load(registry: Record<string, object>, manifest: WormholeManifest | null = null) {
  (globalThis as Record<symbol, unknown>)[REGISTRY] = [];
  (globalThis as Record<symbol, unknown>)[DOCUMENT_REGISTRY] = [];

  mocks.manifest = manifest;
  mocks.registry = registry as Record<string, Wormhole<unknown>>;

  vi.resetModules();

  const { createWormholeMiddleware } = await import('./middleware');
  const { getRequestWormholes } = await import('./request-store');

  return { createWormholeMiddleware, getRequestWormholes };
}

const createCtx = (path: string): APIContext =>
  ({ url: new URL(`http://localhost${path}`), request: new Request(`http://localhost${path}`) }) as APIContext;

const htmlNext = (body: () => string, onCall?: () => void) => {
  return vi.fn(async () => {
    onCall?.();

    return new Response(body(), { headers: { 'content-type': 'text/html' } });
  }) as unknown as MiddlewareNext & ReturnType<typeof vi.fn>;
};

describe('createWormholeMiddleware', () => {
  test('assigns registry names at creation time', async () => {
    const { defineWormhole } = await import('./define');
    const cart = defineWormhole<number>();
    const { createWormholeMiddleware } = await load({ cart });

    createWormholeMiddleware({ values: () => ({}) });

    expect(cart.name).toBe('cart');
  });

  test('registers the islands and document emitters', async () => {
    const { createWormholeMiddleware } = await load({});

    createWormholeMiddleware({ values: () => ({}) });

    expect(((globalThis as Record<symbol, unknown>)[REGISTRY] as unknown[]).length).toBe(1);
    expect(((globalThis as Record<symbol, unknown>)[DOCUMENT_REGISTRY] as unknown[]).length).toBe(1);
  });

  test('values are readable via get() inside the request scope', async () => {
    const { defineWormhole } = await import('./define');
    const cart = defineWormhole<{ items: string[] }>();
    const { createWormholeMiddleware } = await load({ cart });

    const handler = createWormholeMiddleware({ values: () => ({ cart: { items: ['a'] } }) as never });
    const ctx = createCtx('/page');

    let seen: unknown;

    await handler(
      ctx,
      htmlNext(
        () => '<html></html>',
        () => {
          seen = cart.get();
        },
      ),
    );

    expect(seen).toEqual({ items: ['a'] });
  });

  test('stashes resolved values for the streaming emitter, skipping undefined', async () => {
    const { defineWormhole } = await import('./define');
    const { createWormholeMiddleware, getRequestWormholes } = await load({
      cart: defineWormhole<number>(),
      closed: defineWormhole<number>(),
    });

    const handler = createWormholeMiddleware({ values: () => ({ cart: 1, closed: undefined }) as never });
    const ctx = createCtx('/page');

    await handler(
      ctx,
      htmlNext(() => '<html></html>'),
    );

    const request = getRequestWormholes(ctx.request);

    expect([...request!.values.entries()]).toEqual([['cart', 1]]);
  });

  test('rejects values for wormholes outside the registry', async () => {
    const { createWormholeMiddleware } = await load({});

    const handler = createWormholeMiddleware({ values: () => ({ rogue: 1 }) as never });

    await expect(
      handler(
        createCtx('/page'),
        htmlNext(() => ''),
      ),
    ).rejects.toThrow('wormhole "rogue" is not in the src/wormholes.ts registry');
  });

  test('excluded paths pass through without opening anything', async () => {
    const { createWormholeMiddleware, getRequestWormholes } = await load({});
    const values = vi.fn(() => ({}));

    const handler = createWormholeMiddleware({ values });
    const ctx = createCtx('/_astro/x.js');

    await handler(
      ctx,
      htmlNext(() => ''),
    );

    expect(values).not.toHaveBeenCalled();
    expect(getRequestWormholes(ctx.request)).toBeUndefined();
  });

  test('returns the response untouched — delivery rides the islands middleware', async () => {
    const { defineWormhole } = await import('./define');
    const { createWormholeMiddleware } = await load({ cart: defineWormhole<number>() });

    const handler = createWormholeMiddleware({ values: () => ({ cart: 7 }) as never });
    const response = new Response('<html><head></head></html>', { headers: { 'content-type': 'text/html' } });
    const next = vi.fn(async () => response);

    expect(await handler(createCtx('/page'), next as unknown as MiddlewareNext)).toBe(response);
  });
});
