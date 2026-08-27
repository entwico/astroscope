// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The gate runtime runs at import time, so it is re-imported per test via
 * resetModules. Deferred scheduling primitives are stubbed and driven manually.
 */

type IntersectionCallback = (entries: { target: Element; isIntersecting: boolean }[]) => void;
type MutationCallback = (mutations: { addedNodes: Node[] }[]) => void;

const INSTALLED = Symbol.for('@astroscope/node.islandsRuntime');

type RegistryEntry = string[] | { l?: string[]; i?: string[] };

function register(entries: Record<string, RegistryEntry>): void {
  (globalThis as { __islands__?: Record<string, RegistryEntry> }).__islands__ = entries;
}

function importedUrls(): string[] {
  return (globalThis as { __importedI18nUrls__?: string[] }).__importedI18nUrls__ ?? [];
}

let intersect: IntersectionCallback | undefined;
let mutate: MutationCallback | undefined;
let observedTargets: Element[];
let idleCallbacks: (() => void)[];
let mediaListeners: Map<string, () => void>;
let mediaMatches: boolean;

function createIsland(attrs: Record<string, string>): HTMLElement {
  const el = document.createElement('astro-island');

  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }

  return el;
}

async function loadRuntime(): Promise<void> {
  vi.resetModules();
  await import('./runtime');
}

function preloadedHrefs(): string[] {
  return [...document.head.querySelectorAll('link[rel="modulepreload"]')].map((l) => l.getAttribute('href') ?? '');
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';

  delete (globalThis as Record<symbol, unknown>)[INSTALLED];
  delete (globalThis as { __islands__?: unknown }).__islands__;
  delete (globalThis as { __importedI18nUrls__?: unknown }).__importedI18nUrls__;

  intersect = undefined;
  mutate = undefined;
  observedTargets = [];
  idleCallbacks = [];
  mediaListeners = new Map();
  mediaMatches = false;

  // stubbed and driven manually so observers from earlier module instances stay inert
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(callback: MutationCallback) {
        mutate = callback;
      }
      observe() {}
      disconnect() {}
    },
  );

  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionCallback) {
        intersect = callback;
      }
      observe(target: Element) {
        observedTargets.push(target);
      }
      unobserve() {}
      disconnect() {}
    },
  );

  vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
    idleCallbacks.push(callback);
  });

  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: mediaMatches,
    addEventListener: (_event: string, listener: () => void) => mediaListeners.set(query, listener),
  }));
});

describe('islands gate runtime', () => {
  test('fires an idle island when the browser goes idle', async () => {
    register({ '/_astro/Cart.js': { l: ['/_astro/Cart.js', '/_astro/shared.js'] } });
    document.body.append(createIsland({ 'component-url': '/_astro/Cart.js', client: 'idle', opts: '{}' }));

    await loadRuntime();

    expect(preloadedHrefs()).toEqual([]);

    idleCallbacks.forEach((cb) => cb());

    expect(preloadedHrefs()).toEqual(['/_astro/Cart.js', '/_astro/shared.js']);
  });

  test('fires a visible island when it approaches the viewport', async () => {
    register({ '/_astro/Menu.js': { l: ['/_astro/Menu.js'] } });

    const island = createIsland({ 'component-url': '/_astro/Menu.js', client: 'visible', opts: '{}' });

    document.body.append(island);
    await loadRuntime();

    expect(observedTargets).toContain(island);
    expect(preloadedHrefs()).toEqual([]);

    intersect?.([{ target: island, isIntersecting: true }]);

    expect(preloadedHrefs()).toEqual(['/_astro/Menu.js']);
  });

  test('fires a media island when its query matches', async () => {
    register({ '/_astro/Nav.js': { l: ['/_astro/Nav.js'] } });
    document.body.append(
      createIsland({
        'component-url': '/_astro/Nav.js',
        client: 'media',
        opts: '{"name":"Nav","value":"(min-width: 640px)"}',
      }),
    );

    await loadRuntime();

    expect(preloadedHrefs()).toEqual([]);

    mediaListeners.get('(min-width: 640px)')?.();

    expect(preloadedHrefs()).toEqual(['/_astro/Nav.js']);
  });

  test('all instances share the registry entry and fire once', async () => {
    register({ '/_astro/Card.js': { l: ['/_astro/Card.js', '/_astro/shared.js'] } });

    const first = createIsland({ 'component-url': '/_astro/Card.js', client: 'visible', opts: '{}' });
    const second = createIsland({ 'component-url': '/_astro/Card.js', client: 'visible', opts: '{}' });

    document.body.append(first, second);
    await loadRuntime();

    expect(observedTargets).toEqual([first, second]);

    intersect?.([{ target: second, isIntersecting: true }]);
    intersect?.([{ target: first, isIntersecting: true }]);

    expect(preloadedHrefs()).toEqual(['/_astro/Card.js', '/_astro/shared.js']);
  });

  test('treats -x suffixed directives like their base directive', async () => {
    register({ '/_astro/Gtm.js': { l: ['/_astro/Gtm.js'] } });

    const island = createIsland({
      'component-url': '/_astro/Gtm.js',
      client: 'idle-x',
      opts: '{"name":"GtmEvent","value":true}',
    });

    document.body.append(island);
    await loadRuntime();

    expect(idleCallbacks).toHaveLength(1);

    idleCallbacks[0]!();

    expect(preloadedHrefs()).toEqual(['/_astro/Gtm.js']);
  });

  test('gates islands inserted after load, e.g. a server island fragment', async () => {
    await loadRuntime();

    // the fragment's registry script has executed on insertion (astro inserts
    // fragments via createContextualFragment, which runs scripts)
    register({ '/_astro/Late.js': { l: ['/_astro/Late.js'] } });

    const island = createIsland({ 'component-url': '/_astro/Late.js', client: 'idle', opts: '{}' });
    const wrapper = document.createElement('div');

    wrapper.append(island);
    document.body.append(wrapper);

    mutate?.([{ addedNodes: [wrapper] }]);

    idleCallbacks.forEach((cb) => cb());

    expect(preloadedHrefs()).toEqual(['/_astro/Late.js']);
  });

  test('injected links carry low fetch priority', async () => {
    register({ '/_astro/A.js': { l: ['/_astro/A.js'] } });
    document.body.append(createIsland({ 'component-url': '/_astro/A.js', client: 'idle', opts: '{}' }));

    await loadRuntime();
    idleCallbacks.forEach((cb) => cb());

    const link = document.head.querySelector('link[rel="modulepreload"]');

    expect(link?.getAttribute('fetchpriority')).toBe('low');
  });

  test('eagerly imports the entry imports when the directive fires, links stay preloads', async () => {
    register({
      '/_astro/Cart.js': { l: ['/_astro/Cart.js'], i: ['/_i18n/en/Cart.abc.js', '/_i18n/en/Lazy.def.js'] },
    });
    document.body.append(createIsland({ 'component-url': '/_astro/Cart.js', client: 'idle', opts: '{}' }));

    await loadRuntime();

    expect(importedUrls()).toEqual([]);

    idleCallbacks.forEach((cb) => cb());

    // evaluation order follows fetch completion — compare order-free
    await vi.waitFor(
      () => expect([...importedUrls()].sort()).toEqual(['/_i18n/en/Cart.abc.js', '/_i18n/en/Lazy.def.js']),
      { timeout: 5000 },
    );
    expect(preloadedHrefs()).toEqual(['/_astro/Cart.js']);
  }, 10000);

  test('an import shared between components fires only once', async () => {
    register({
      '/_astro/A.js': { l: [], i: ['/_i18n/en/shared.abc.js'] },
      '/_astro/B.js': { l: [], i: ['/_i18n/en/shared.abc.js'] },
    });
    document.body.append(
      createIsland({ 'component-url': '/_astro/A.js', client: 'idle', opts: '{}' }),
      createIsland({ 'component-url': '/_astro/B.js', client: 'idle', opts: '{}' }),
    );

    await loadRuntime();
    idleCallbacks.forEach((cb) => cb());

    await vi.waitFor(() => expect(importedUrls()).toEqual(['/_i18n/en/shared.abc.js']), { timeout: 5000 });
  }, 10000);

  test('a failed eager import stays silent', async () => {
    register({ '/_astro/A.js': { l: ['/_astro/A.js'], i: ['/definitely-not-resolvable.js'] } });
    document.body.append(createIsland({ 'component-url': '/_astro/A.js', client: 'idle', opts: '{}' }));

    await loadRuntime();
    idleCallbacks.forEach((cb) => cb());

    // the rejection is swallowed and the links still land
    expect(preloadedHrefs()).toEqual(['/_astro/A.js']);
  });

  test('treats a plain array entry from an older document as links only', async () => {
    register({ '/_astro/Old.js': ['/_astro/Old.js', '/_astro/shared.js'] });
    document.body.append(createIsland({ 'component-url': '/_astro/Old.js', client: 'idle', opts: '{}' }));

    await loadRuntime();
    idleCallbacks.forEach((cb) => cb());

    expect(preloadedHrefs()).toEqual(['/_astro/Old.js', '/_astro/shared.js']);
    expect(importedUrls()).toEqual([]);
  });
});
