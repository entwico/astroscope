import type * as islands from '@astroscope/node/islands';
import type { RouteIsland } from '@astroscope/node/islands';
import type { APIContext, MiddlewareNext } from 'astro';
import { describe, expect, test, vi } from 'vitest';
import type { WormholeManifest } from './extraction/types';
import type { Wormhole } from './types';

const REGISTRY = Symbol.for('@astroscope/node.islandEmitters');
const DOCUMENT_REGISTRY = Symbol.for('@astroscope/node.documentEmitters');

const mocks = vi.hoisted(() => ({
  manifest: null as WormholeManifest | null,
  registry: {} as Record<string, Wormhole<unknown>>,
  routeIslands: {} as Record<string, RouteIsland[]>,
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

vi.mock('@astroscope/node/islands', async (importOriginal) => ({
  ...(await importOriginal<typeof islands>()),
  getRouteIslands: (pattern: string) => mocks.routeIslands[pattern] ?? null,
}));

const island = (fileName: string, ...deps: string[]): RouteIsland => ({
  fileName,
  staticClosure: [fileName, ...deps],
  fullClosure: [fileName, ...deps],
});

async function load(
  registry: Record<string, object>,
  manifest: WormholeManifest | null = null,
  routeIslands: Record<string, RouteIsland[]> = {},
) {
  (globalThis as Record<symbol, unknown>)[REGISTRY] = [];
  (globalThis as Record<symbol, unknown>)[DOCUMENT_REGISTRY] = [];

  mocks.manifest = manifest;
  mocks.registry = registry as Record<string, Wormhole<unknown>>;
  mocks.routeIslands = routeIslands;

  vi.resetModules();

  const { createWormholeMiddleware } = await import('./middleware');
  const { getRequestWormholes } = await import('./request-store');
  const { defineWormhole } = await import('./define');

  return { createWormholeMiddleware, getRequestWormholes, defineWormhole };
}

const createCtx = (path: string, routePattern = path): APIContext =>
  ({
    url: new URL(`http://localhost${path}`),
    request: new Request(`http://localhost${path}`),
    routePattern,
  }) as APIContext;

const htmlNext = (body: () => string, onCall?: () => void) => {
  return vi.fn(async () => {
    onCall?.();

    return new Response(body(), { headers: { 'content-type': 'text/html' } });
  }) as unknown as MiddlewareNext & ReturnType<typeof vi.fn>;
};

/** a registry of counting handlers — each returns its name, `calls` records who ran */
function countingRegistry(
  defineWormhole: (definition: { handler: () => unknown }) => Wormhole<unknown>,
  names: string[],
) {
  const calls: string[] = [];
  const registry: Record<string, object> = {};

  for (const name of names) {
    registry[name] = defineWormhole({
      handler: () => {
        calls.push(name);

        return name;
      },
    });
  }

  return { registry, calls };
}

describe('createWormholeMiddleware', () => {
  test('assigns registry names at creation time', async () => {
    const { defineWormhole } = await import('./define');
    const cart = defineWormhole<number>({ handler: () => 1 });
    const { createWormholeMiddleware } = await load({ cart });

    createWormholeMiddleware();

    expect(cart.name).toBe('cart');
  });

  test('registers the islands and document emitters', async () => {
    const { createWormholeMiddleware } = await load({});

    createWormholeMiddleware();

    expect(((globalThis as Record<symbol, unknown>)[REGISTRY] as unknown[]).length).toBe(1);
    expect(((globalThis as Record<symbol, unknown>)[DOCUMENT_REGISTRY] as unknown[]).length).toBe(1);
  });

  test('rejects registry entries without a handler', async () => {
    const { createWormhole } = await import('./define');
    const { createWormholeMiddleware } = await load({ cart: createWormhole() });

    expect(() => createWormholeMiddleware()).toThrow('wormhole "cart" has no handler');
  });

  test('loaded values are readable via get() inside the request scope', async () => {
    const { defineWormhole } = await import('./define');
    const cart = defineWormhole({ handler: (ctx: APIContext) => ({ items: [ctx.url.pathname] }) });
    const { createWormholeMiddleware } = await load({ cart });

    const handler = createWormholeMiddleware();
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

    expect(seen).toEqual({ items: ['/page'] });
  });

  test('stashes resolved values for the streaming emitter, skipping undefined', async () => {
    const { defineWormhole } = await import('./define');
    const { createWormholeMiddleware, getRequestWormholes } = await load({
      cart: defineWormhole({ handler: () => 1 }),
      closed: defineWormhole({ handler: () => undefined }),
    });

    const handler = createWormholeMiddleware();
    const ctx = createCtx('/page');

    await handler(
      ctx,
      htmlNext(() => '<html></html>'),
    );

    const request = getRequestWormholes(ctx.request);

    expect([...request!.values.entries()]).toEqual([['cart', 1]]);
  });

  test('handlers run in parallel', async () => {
    const { defineWormhole } = await import('./define');
    const order: string[] = [];
    const slow = (name: string) => async () => {
      order.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`${name}:end`);

      return name;
    };
    const { createWormholeMiddleware } = await load({
      a: defineWormhole({ handler: slow('a') }),
      b: defineWormhole({ handler: slow('b') }),
    });

    await createWormholeMiddleware()(
      createCtx('/page'),
      htmlNext(() => ''),
    );

    expect(order).toEqual(['a:start', 'b:start', 'a:end', 'b:end']);
  });

  test('synchronous handlers open the scope without a microtask hop', async () => {
    const { defineWormhole } = await import('./define');
    const cart = defineWormhole({ handler: () => 1 });
    const { createWormholeMiddleware } = await load({ cart });

    let seen: unknown;
    const result = createWormholeMiddleware()(
      createCtx('/page'),
      htmlNext(
        () => '',
        () => {
          seen = cart.get();
        },
      ),
    );

    // next() ran before this line — no await in between
    expect(seen).toBe(1);

    await result;
  });

  test('excluded paths pass through without loading anything', async () => {
    const { defineWormhole } = await import('./define');
    const loader = vi.fn(() => 1);
    const { createWormholeMiddleware, getRequestWormholes } = await load({ cart: defineWormhole({ handler: loader }) });

    const handler = createWormholeMiddleware();
    const ctx = createCtx('/_astro/x.js');

    await handler(
      ctx,
      htmlNext(() => ''),
    );

    expect(loader).not.toHaveBeenCalled();
    expect(getRequestWormholes(ctx.request)).toBeUndefined();
  });

  test('custom exclude patterns replace the default', async () => {
    const { defineWormhole } = await import('./define');
    const loader = vi.fn(() => 1);
    const { createWormholeMiddleware } = await load({ cart: defineWormhole({ handler: loader }) });

    const handler = createWormholeMiddleware({ exclude: [{ prefix: '/api/' }] });

    await handler(
      createCtx('/api/x'),
      htmlNext(() => ''),
    );
    expect(loader).not.toHaveBeenCalled();

    await handler(
      createCtx('/_astro/x.js'),
      htmlNext(() => ''),
    );
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('returns the response untouched — delivery rides the islands middleware', async () => {
    const { defineWormhole } = await import('./define');
    const { createWormholeMiddleware } = await load({ cart: defineWormhole({ handler: () => 7 }) });

    const handler = createWormholeMiddleware();
    const response = new Response('<html><head></head></html>', { headers: { 'content-type': 'text/html' } });
    const next = vi.fn(async () => response);

    expect(await handler(createCtx('/page'), next as unknown as MiddlewareNext)).toBe(response);
  });
});

describe('route-scoped loading', () => {
  const names = ['cart', 'session', 'stats', 'audit', 'config'];

  test('without a manifest every handler runs', async () => {
    const { defineWormhole, createWormholeMiddleware } = await load({});
    const { registry, calls } = countingRegistry(defineWormhole, names);
    const { createWormholeMiddleware: create } = await load(registry);

    void createWormholeMiddleware;

    await create()(
      createCtx('/page'),
      htmlNext(() => ''),
    );

    expect([...calls].sort()).toEqual([...names].sort());
  });

  test('a known route loads its manifest reads, its islands` reads and eager wormholes', async () => {
    const { defineWormhole } = await load({});
    const { registry, calls } = countingRegistry(defineWormhole, names);

    registry['config'] = defineWormhole({
      handler: () => {
        calls.push('config');

        return 'config';
      },
      eager: true,
    });

    const { createWormholeMiddleware } = await load(
      registry,
      {
        chunks: { 'Cart.Cabc': ['cart'], 'Lazy.Cddd': ['session'] },
        scripts: ['stats'],
        routes: { '/page': ['audit', 'stats'], '/plain': [] },
      },
      { '/page': [island('_astro/Cart.Cabc.js', '_astro/Lazy.Cddd.js')], '/plain': [] },
    );
    const handler = createWormholeMiddleware();

    await handler(
      createCtx('/page'),
      htmlNext(() => ''),
    );
    expect([...calls].sort()).toEqual(['audit', 'cart', 'config', 'session', 'stats']);

    calls.length = 0;

    await handler(
      createCtx('/plain'),
      htmlNext(() => ''),
    );
    expect([...calls].sort()).toEqual(['config']);
  });

  test('an unknown route loads everything', async () => {
    const { defineWormhole } = await load({});
    const { registry, calls } = countingRegistry(defineWormhole, names);
    const { createWormholeMiddleware } = await load(
      registry,
      { chunks: {}, scripts: [], routes: { '/page': [] } },
      { '/page': [] },
    );

    await createWormholeMiddleware()(
      createCtx('/_server-islands/x', '/_server-islands/[name]'),
      htmlNext(() => ''),
    );

    expect([...calls].sort()).toEqual([...names].sort());
  });

  test('a route the node manifest does not know loads everything', async () => {
    const { defineWormhole } = await load({});
    const { registry, calls } = countingRegistry(defineWormhole, names);
    const { createWormholeMiddleware } = await load(registry, { chunks: {}, scripts: [], routes: { '/page': [] } }, {});

    await createWormholeMiddleware()(
      createCtx('/page'),
      htmlNext(() => ''),
    );

    expect([...calls].sort()).toEqual([...names].sort());
  });

  test('dynamic access anywhere on the route degrades to everything', async () => {
    const { defineWormhole } = await load({});
    const { registry, calls } = countingRegistry(defineWormhole, names);
    const { createWormholeMiddleware } = await load(
      registry,
      { chunks: { 'Cart.Cabc': ['*'] }, scripts: [], routes: { '/page': [], '/server': ['*'] } },
      { '/page': [island('_astro/Cart.Cabc.js')], '/server': [] },
    );
    const handler = createWormholeMiddleware();

    await handler(
      createCtx('/page'),
      htmlNext(() => ''),
    );
    expect([...calls].sort()).toEqual([...names].sort());

    calls.length = 0;

    await handler(
      createCtx('/server'),
      htmlNext(() => ''),
    );
    expect([...calls].sort()).toEqual([...names].sort());
  });

  test('names outside the registry are ignored', async () => {
    const { defineWormhole } = await load({});
    const { registry, calls } = countingRegistry(defineWormhole, ['cart']);
    const { createWormholeMiddleware } = await load(
      registry,
      { chunks: {}, scripts: [], routes: { '/page': ['cart', 'stale'] } },
      { '/page': [] },
    );

    await createWormholeMiddleware()(
      createCtx('/page'),
      htmlNext(() => ''),
    );

    expect(calls).toEqual(['cart']);
  });
});
