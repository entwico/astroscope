import type { IslandEmitter, IslandInfo } from '@astroscope/node/islands';
import type { APIContext } from 'astro';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ExtractionManifest } from '../extraction/types';

const REGISTRY = Symbol.for('@astroscope/node.islandEmitters');
const DOCUMENT_REGISTRY = Symbol.for('@astroscope/node.documentEmitters');

const mocks = vi.hoisted(() => ({
  manifest: { keys: [], chunks: {}, scripts: [] } as ExtractionManifest,
}));

vi.mock('virtual:@astroscope/i18n/manifest', () => ({
  getManifest: () => mocks.manifest,
}));

function createIsland(overrides: Partial<IslandInfo> = {}): IslandInfo {
  return {
    componentUrl: '/_astro/Cart.Cabc.js',
    rendererUrl: '/_astro/client.Cxyz.js',
    client: 'load',
    staticClosure: ['/_astro/Cart.Cabc.js', '/_astro/client.Cxyz.js'],
    fullClosure: ['/_astro/Cart.Cabc.js', '/_astro/client.Cxyz.js', '/_astro/Lazy.Cddd.js'],
    ...overrides,
  };
}

function createContext(): APIContext {
  return { request: new Request('http://localhost/'), locals: {} } as APIContext;
}

async function setup(manifest?: Partial<ExtractionManifest>) {
  (globalThis as Record<symbol, unknown>)[REGISTRY] = [];
  (globalThis as Record<symbol, unknown>)[DOCUMENT_REGISTRY] = [];

  mocks.manifest = {
    keys: [],
    chunks: { 'Cart.Cabc': ['cart.title'], 'Lazy.Cddd': ['lazy.text'] },
    scripts: [],
    ...manifest,
  };

  vi.resetModules();

  const { i18n } = await import('./i18n');
  const { registerI18nEmitters, createI18nDocumentEmitter, setRequestLocale } = await import('./islands-emitter');

  await i18n.configure({ locales: ['en', 'de'] });
  i18n.setTranslations('en', { 'cart.title': 'Cart', 'lazy.text': 'Lazy' });

  registerI18nEmitters();

  const emitter = ((globalThis as Record<symbol, unknown>)[REGISTRY] as IslandEmitter[])[0]!;

  return { i18n, emitter, createI18nDocumentEmitter, setRequestLocale };
}

beforeEach(() => {
  (globalThis as Record<symbol, unknown>)[REGISTRY] = [];
  (globalThis as Record<symbol, unknown>)[DOCUMENT_REGISTRY] = [];
});

describe('i18n islands emitter', () => {
  test('emits hashes for the full closure and preload links for the static closure', async () => {
    const { emitter, setRequestLocale } = await setup();
    const context = createContext();

    setRequestLocale(context, 'en');

    const emission = emitter(createIsland(), context);

    // hashes cover the dynamic import too — its loader reads them at execution time
    expect(emission?.html).toContain('"Cart.Cabc"');
    expect(emission?.html).toContain('"Lazy.Cddd"');
    expect(emission?.html).toContain('"locale":"en"');
    // links warm only what hydration fetches now
    expect(emission?.links).toHaveLength(1);
    expect(emission?.links?.[0]).toMatch(/^\/_i18n\/en\/Cart\.Cabc\.[0-9a-f]{8}\.js$/);
  });

  test('emits eager imports for the full closure, dynamic chunks included', async () => {
    const { emitter, setRequestLocale } = await setup();
    const context = createContext();

    setRequestLocale(context, 'en');

    const emission = emitter(createIsland(), context);

    expect(emission?.imports).toHaveLength(2);
    expect(emission?.imports?.[0]).toMatch(/^\/_i18n\/en\/Cart\.Cabc\.[0-9a-f]{8}\.js$/);
    expect(emission?.imports?.[1]).toMatch(/^\/_i18n\/en\/Lazy\.Cddd\.[0-9a-f]{8}\.js$/);
  });

  test('emits each chunk hash once per request', async () => {
    const { emitter, setRequestLocale } = await setup();
    const context = createContext();

    setRequestLocale(context, 'en');

    const first = emitter(createIsland(), context);
    const second = emitter(createIsland(), context);

    expect(first?.html).toContain('Cart.Cabc');
    expect(second?.html).toBeUndefined();
    // links and imports keep flowing — every island's gate must be self-sufficient
    expect(second?.links).toHaveLength(1);
    expect(second?.imports).toHaveLength(2);
  });

  test('contributes nothing without a request context (prerendered pass)', async () => {
    const { emitter } = await setup();

    expect(emitter(createIsland(), undefined)).toBeNull();
  });

  test('contributes nothing when the middleware recorded no locale', async () => {
    const { emitter } = await setup();

    expect(emitter(createIsland(), createContext())).toBeNull();
  });

  test('keeps the locale when a rewrite replaced the request', async () => {
    const { emitter, setRequestLocale } = await setup();
    const context = createContext();

    setRequestLocale(context, 'en');

    // astro copies the request on every `next(url)` rewrite — locals stay the same object
    context.request = new Request('http://localhost/rewritten');

    expect(emitter(createIsland(), context)?.html).toContain('"locale":"en"');
  });

  test('ignores chunks without translations', async () => {
    const { emitter, setRequestLocale } = await setup();
    const context = createContext();

    setRequestLocale(context, 'en');

    const emission = emitter(
      createIsland({
        componentUrl: '/_astro/Plain.Cnnn.js',
        staticClosure: ['/_astro/Plain.Cnnn.js'],
        fullClosure: ['/_astro/Plain.Cnnn.js'],
      }),
      context,
    );

    expect(emission).toBeNull();
  });
});

describe('createI18nDocumentEmitter', () => {
  test('dev delivers the full state as head content', async () => {
    const { createI18nDocumentEmitter, setRequestLocale } = await setup();
    const context = createContext();

    setRequestLocale(context, 'en');

    const emission = createI18nDocumentEmitter(true)(context);

    expect(emission?.head).toContain('window.__i18n__');
    expect(emission?.head).toContain('"cart.title":"Cart"');
    expect(emission?.end).toBeUndefined();
  });

  test('prod delivers script-chunk hashes as end content', async () => {
    const { createI18nDocumentEmitter, setRequestLocale } = await setup({ scripts: ['Cart.Cabc'] });
    const context = createContext();

    setRequestLocale(context, 'en');

    const emission = createI18nDocumentEmitter(false)(context);

    expect(emission?.head).toBeUndefined();
    expect(emission?.end?.()).toContain('Cart.Cabc');
  });

  test('prod contributes nothing without a chunk manifest — no client t() exists', async () => {
    const { createI18nDocumentEmitter, setRequestLocale } = await setup({ chunks: {} });
    const context = createContext();

    setRequestLocale(context, 'en');

    expect(createI18nDocumentEmitter(false)(context)).toBeNull();
  });

  test('contributes nothing when the middleware recorded no locale', async () => {
    const { createI18nDocumentEmitter } = await setup();

    expect(createI18nDocumentEmitter(true)(createContext())).toBeNull();
  });
});
