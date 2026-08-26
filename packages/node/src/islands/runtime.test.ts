// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The gate runtime runs at import time, so it is re-imported per test via
 * resetModules. Deferred scheduling primitives are stubbed and driven manually.
 */

type IntersectionCallback = (entries: { target: Element; isIntersecting: boolean }[]) => void;
type MutationCallback = (mutations: { addedNodes: Node[] }[]) => void;

const INSTALLED = Symbol.for('@astroscope/node.islandsRuntime');

function register(entries: Record<string, string[]>): void {
  (globalThis as { __islands__?: Record<string, string[]> }).__islands__ = entries;
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
    register({ '/_astro/Cart.js': ['/_astro/Cart.js', '/_astro/shared.js'] });
    document.body.append(createIsland({ 'component-url': '/_astro/Cart.js', client: 'idle', opts: '{}' }));

    await loadRuntime();

    expect(preloadedHrefs()).toEqual([]);

    idleCallbacks.forEach((cb) => cb());

    expect(preloadedHrefs()).toEqual(['/_astro/Cart.js', '/_astro/shared.js']);
  });

  test('fires a visible island when it approaches the viewport', async () => {
    register({ '/_astro/Menu.js': ['/_astro/Menu.js'] });

    const island = createIsland({ 'component-url': '/_astro/Menu.js', client: 'visible', opts: '{}' });

    document.body.append(island);
    await loadRuntime();

    expect(observedTargets).toContain(island);
    expect(preloadedHrefs()).toEqual([]);

    intersect?.([{ target: island, isIntersecting: true }]);

    expect(preloadedHrefs()).toEqual(['/_astro/Menu.js']);
  });

  test('fires a media island when its query matches', async () => {
    register({ '/_astro/Nav.js': ['/_astro/Nav.js'] });
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
    register({ '/_astro/Card.js': ['/_astro/Card.js', '/_astro/shared.js'] });

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
    register({ '/_astro/Gtm.js': ['/_astro/Gtm.js'] });

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
    register({ '/_astro/Late.js': ['/_astro/Late.js'] });

    const island = createIsland({ 'component-url': '/_astro/Late.js', client: 'idle', opts: '{}' });
    const wrapper = document.createElement('div');

    wrapper.append(island);
    document.body.append(wrapper);

    mutate?.([{ addedNodes: [wrapper] }]);

    idleCallbacks.forEach((cb) => cb());

    expect(preloadedHrefs()).toEqual(['/_astro/Late.js']);
  });

  test('injected links carry low fetch priority', async () => {
    register({ '/_astro/A.js': ['/_astro/A.js'] });
    document.body.append(createIsland({ 'component-url': '/_astro/A.js', client: 'idle', opts: '{}' }));

    await loadRuntime();
    idleCallbacks.forEach((cb) => cb());

    const link = document.head.querySelector('link[rel="modulepreload"]');

    expect(link?.getAttribute('fetchpriority')).toBe('low');
  });
});
