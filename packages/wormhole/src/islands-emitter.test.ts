import type { IslandEmitter, IslandInfo } from '@astroscope/node/islands';
import type { APIContext } from 'astro';
import { describe, expect, test, vi } from 'vitest';
import type { WormholeManifest } from './extraction/types';

const REGISTRY = Symbol.for('@astroscope/node.islandEmitters');
const DOCUMENT_REGISTRY = Symbol.for('@astroscope/node.documentEmitters');

const mocks = vi.hoisted(() => ({
  manifest: null as WormholeManifest | null,
}));

vi.mock('virtual:@astroscope/wormhole/manifest', () => ({
  get manifest() {
    return mocks.manifest;
  },
}));

function createIsland(overrides: Partial<IslandInfo> = {}): IslandInfo {
  return {
    componentUrl: '/_astro/Counter.Cabc.js',
    rendererUrl: '/_astro/client.Cxyz.js',
    client: 'load',
    staticClosure: ['/_astro/Counter.Cabc.js', '/_astro/client.Cxyz.js'],
    fullClosure: ['/_astro/Counter.Cabc.js', '/_astro/client.Cxyz.js', '/_astro/Lazy.Cddd.js'],
    ...overrides,
  };
}

function createContext(): APIContext {
  return { request: new Request('http://localhost/') } as APIContext;
}

async function setup(manifest: WormholeManifest | null, values: Record<string, unknown>) {
  (globalThis as Record<symbol, unknown>)[REGISTRY] = [];
  (globalThis as Record<symbol, unknown>)[DOCUMENT_REGISTRY] = [];

  mocks.manifest = manifest;

  vi.resetModules();

  const { registerWormholeEmitters, createWormholeDocumentEmitter } = await import('./islands-emitter');
  const { setRequestWormholes } = await import('./request-store');

  registerWormholeEmitters();

  const emitter = ((globalThis as Record<symbol, unknown>)[REGISTRY] as IslandEmitter[])[0]!;
  const context = createContext();

  setRequestWormholes(context.request, { values: new Map(Object.entries(values)), emitted: new Set() });

  return { emitter, context, createWormholeDocumentEmitter };
}

describe('registerWormholeEmitters', () => {
  test('registers exactly once', async () => {
    const { emitter } = await setup({ chunks: {}, scripts: [] }, {});
    const { registerWormholeEmitters } = await import('./islands-emitter');

    registerWormholeEmitters();

    expect(((globalThis as Record<symbol, unknown>)[REGISTRY] as IslandEmitter[]).length).toBe(1);
    expect(((globalThis as Record<symbol, unknown>)[DOCUMENT_REGISTRY] as unknown[]).length).toBe(1);
    expect(emitter).toBeTypeOf('function');
  });

  test('contributes nothing without a request context (prerendered pass)', async () => {
    const { emitter } = await setup({ chunks: { 'Counter.Cabc': ['counter'] }, scripts: [] }, { counter: 1 });

    expect(emitter(createIsland(), undefined)).toBeNull();
  });

  test('contributes nothing without a manifest or without request values', async () => {
    const noManifest = await setup(null, { counter: 1 });

    expect(noManifest.emitter(createIsland(), noManifest.context)).toBeNull();

    const noValues = await setup({ chunks: { 'Counter.Cabc': ['counter'] }, scripts: [] }, {});

    expect(noValues.emitter(createIsland(), noValues.context)).toBeNull();

    const unknownRequest = await setup({ chunks: { 'Counter.Cabc': ['counter'] }, scripts: [] }, { counter: 1 });

    expect(unknownRequest.emitter(createIsland(), createContext())).toBeNull();
  });

  test('emits a merge script for reachable open wormholes only', async () => {
    const { emitter, context } = await setup(
      { chunks: { 'Counter.Cabc': ['counter'], 'Lazy.Cddd': ['lazy'], 'Other.Ceee': ['other'] }, scripts: [] },
      { counter: { count: 5 }, lazy: 'l', audit: 'server-only' },
    );

    const emission = emitter(createIsland(), context);

    expect(emission?.html).toContain('"counter":{"count":5}');
    // the dynamic-import chunk is in the full closure
    expect(emission?.html).toContain('"lazy":"l"');
    // not reachable from this island / not open
    expect(emission?.html).not.toContain('other');
    expect(emission?.html).not.toContain('audit');
  });

  test('skips names already emitted for this request', async () => {
    const { emitter, context } = await setup({ chunks: { 'Counter.Cabc': ['counter'] }, scripts: [] }, { counter: 1 });

    expect(emitter(createIsland(), context)?.html).toContain('"counter":1');
    expect(emitter(createIsland(), context)).toBeNull();
  });

  test('a * chunk emits all open wormholes', async () => {
    const { emitter, context } = await setup(
      { chunks: { 'Counter.Cabc': ['*'] }, scripts: [] },
      { counter: 1, audit: 2 },
    );

    const emission = emitter(createIsland(), context);

    expect(emission?.html).toContain('"counter":1');
    expect(emission?.html).toContain('"audit":2');
  });

  test('islands with no reachable wormholes contribute nothing', async () => {
    const { emitter, context } = await setup(
      { chunks: { 'Unrelated.Cfff': ['counter'] }, scripts: [] },
      { counter: 1 },
    );

    expect(emitter(createIsland(), context)).toBeNull();
  });
});

describe('createWormholeDocumentEmitter', () => {
  test('contributes nothing when nothing is open or the request is unknown', async () => {
    const empty = await setup({ chunks: {}, scripts: [] }, {});

    expect(empty.createWormholeDocumentEmitter(false)(empty.context)).toBeNull();

    const unknownRequest = await setup({ chunks: {}, scripts: [] }, { counter: 1 });

    expect(unknownRequest.createWormholeDocumentEmitter(false)(createContext())).toBeNull();
  });

  test('dev delivers everything open as head content', async () => {
    const { createWormholeDocumentEmitter, context } = await setup(null, { cart: 1, audit: 2 });

    const emission = createWormholeDocumentEmitter(true)(context);

    expect(emission?.head).toContain('"cart":1');
    expect(emission?.head).toContain('"audit":2');
    expect(emission?.end).toBeUndefined();
  });

  test('prod without a manifest falls back to full delivery as head content', async () => {
    const { createWormholeDocumentEmitter, context } = await setup(null, { cart: 1 });

    const emission = createWormholeDocumentEmitter(false)(context);

    expect(emission?.head).toContain('"cart":1');
  });

  test('prod delivers only script-reachable open wormholes at stream end', async () => {
    const { createWormholeDocumentEmitter, context } = await setup(
      { chunks: {}, scripts: ['stats', 'closed'] },
      { cart: 1, stats: 2, audit: 3 },
    );

    const emission = createWormholeDocumentEmitter(false)(context);
    const script = emission?.end?.();

    expect(emission?.head).toBeUndefined();
    expect(script).toContain('"stats":2');
    expect(script).not.toContain('"cart"');
    expect(script).not.toContain('"audit"');
    expect(script).not.toContain('"closed"');
  });

  test('prod with no script consumers contributes nothing', async () => {
    const { createWormholeDocumentEmitter, context } = await setup({ chunks: {}, scripts: [] }, { cart: 1 });

    expect(createWormholeDocumentEmitter(false)(context)).toBeNull();
  });

  test('a * script entry delivers all open wormholes', async () => {
    const { createWormholeDocumentEmitter, context } = await setup(
      { chunks: {}, scripts: ['*'] },
      { cart: 1, audit: 2 },
    );

    const script = createWormholeDocumentEmitter(false)(context)?.end?.();

    expect(script).toContain('"cart":1');
    expect(script).toContain('"audit":2');
  });

  test('the end factory skips names the islands emitter already wrote', async () => {
    const { emitter, createWormholeDocumentEmitter, context } = await setup(
      { chunks: { 'Counter.Cabc': ['counter'] }, scripts: ['counter', 'stats'] },
      { counter: 1, stats: 2 },
    );

    const emission = createWormholeDocumentEmitter(false)(context);

    // the island passes the rewriter before the end factory runs
    expect(emitter(createIsland(), context)?.html).toContain('"counter":1');

    const script = emission?.end?.();

    expect(script).toContain('"stats":2');
    expect(script).not.toContain('"counter"');
  });

  test('the end factory contributes nothing when every name was already written', async () => {
    const { emitter, createWormholeDocumentEmitter, context } = await setup(
      { chunks: { 'Counter.Cabc': ['counter'] }, scripts: ['counter'] },
      { counter: 1 },
    );

    const emission = createWormholeDocumentEmitter(false)(context);

    emitter(createIsland(), context);

    expect(emission?.end?.()).toBeNull();
  });
});
