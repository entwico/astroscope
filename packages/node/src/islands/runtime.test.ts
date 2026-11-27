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
  vi.stubGlobal('__islands__', entries);
}

function importedUrls(): string[] {
  return (globalThis as { __importedI18nUrls__?: string[] }).__importedI18nUrls__ ?? [];
}

let intersect: IntersectionCallback | undefined;
let mutate: MutationCallback | undefined;
let observedTargets: Element[];
let unobservedTargets: Element[];
let idleCallbacks: (() => void)[];
let idleOptions: (IdleRequestOptions | undefined)[];
let mediaListeners: Map<string, () => void>;
let mediaMatches: boolean;

function createIsland(attrs: Record<string, string>, childCount = 1): HTMLElement {
  const el = document.createElement('astro-island');

  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }

  for (let i = 0; i < childCount; i++) {
    el.append(document.createElement('div'));
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
  document.head.replaceChildren();
  document.body.replaceChildren();

  delete (globalThis as Record<symbol, unknown>)[INSTALLED];
  delete (globalThis as { __islands__?: unknown }).__islands__;
  delete (globalThis as { __importedI18nUrls__?: unknown }).__importedI18nUrls__;

  intersect = undefined;
  mutate = undefined;
  observedTargets = [];
  unobservedTargets = [];
  idleCallbacks = [];
  idleOptions = [];
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

      unobserve(target: Element) {
        unobservedTargets.push(target);
      }

      disconnect() {}
    },
  );

  vi.stubGlobal('requestIdleCallback', (callback: () => void, options?: IdleRequestOptions) => {
    idleCallbacks.push(callback);
    idleOptions.push(options);
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

  test('fires a visible island when a child approaches the viewport, never observing the boxless island', async () => {
    register({ '/_astro/Menu.js': { l: ['/_astro/Menu.js'] } });

    const island = createIsland({ 'component-url': '/_astro/Menu.js', client: 'visible', opts: '{}' }, 2);

    document.body.append(island);
    await loadRuntime();

    // astro-island is display:contents — an observer on it would never fire
    expect(observedTargets).not.toContain(island);
    expect(observedTargets).toEqual([...island.children]);
    expect(preloadedHrefs()).toEqual([]);

    intersect?.([{ target: island.lastElementChild!, isIntersecting: true }]);

    expect(preloadedHrefs()).toEqual(['/_astro/Menu.js']);
  });

  test('observes a streamed visible island once its children arrive', async () => {
    register({ '/_astro/Menu.js': { l: ['/_astro/Menu.js'] } });

    const island = createIsland({ 'component-url': '/_astro/Menu.js', client: 'visible', opts: '{}' }, 0);

    document.body.append(island);
    await loadRuntime();

    expect(observedTargets).toEqual([]);

    const child = document.createElement('div');

    island.append(child);
    mutate?.([{ addedNodes: [child] }]);

    expect(observedTargets).toEqual([child]);

    intersect?.([{ target: child, isIntersecting: true }]);

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

    expect(observedTargets).toEqual([first.firstElementChild, second.firstElementChild]);

    intersect?.([{ target: second.firstElementChild!, isIntersecting: true }]);
    intersect?.([{ target: first.firstElementChild!, isIntersecting: true }]);

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
      () => {
        const urls = [...importedUrls()].toSorted((a, b) => a.localeCompare(b));

        expect(urls).toEqual(['/_i18n/en/Cart.abc.js', '/_i18n/en/Lazy.def.js']);
      },
      { timeout: 5000 },
    );
    expect(preloadedHrefs()).toEqual(['/_astro/Cart.js']);
  }, 10_000);

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
  }, 10_000);

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

  test('a link shared between components is injected once', async () => {
    register({
      '/_astro/A.js': { l: ['/_astro/A.js', '/_astro/shared.js'] },
      '/_astro/B.js': { l: ['/_astro/B.js', '/_astro/shared.js'] },
    });
    document.body.append(
      createIsland({ 'component-url': '/_astro/A.js', client: 'idle', opts: '{}' }),
      createIsland({ 'component-url': '/_astro/B.js', client: 'idle', opts: '{}' }),
    );

    await loadRuntime();
    idleCallbacks.forEach((cb) => cb());

    expect(preloadedHrefs()).toEqual(['/_astro/A.js', '/_astro/shared.js', '/_astro/B.js']);
  });

  test('passes the idle directive timeout on to requestIdleCallback', async () => {
    register({ '/_astro/A.js': { l: ['/_astro/A.js'] }, '/_astro/B.js': { l: ['/_astro/B.js'] } });
    document.body.append(
      createIsland({ 'component-url': '/_astro/A.js', client: 'idle', opts: '{"name":"A","value":{"timeout":500}}' }),
      createIsland({ 'component-url': '/_astro/B.js', client: 'idle', opts: '{"name":"B","value":true}' }),
    );

    await loadRuntime();

    expect(idleOptions).toEqual([{ timeout: 500 }, undefined]);
  });

  test('falls back to a timer where requestIdleCallback is missing, honoring the directive timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {});

    try {
      register({ '/_astro/A.js': { l: ['/_astro/A.js'] }, '/_astro/B.js': { l: ['/_astro/B.js'] } });
      document.body.append(
        createIsland({ 'component-url': '/_astro/A.js', client: 'idle', opts: '{"value":{"timeout":1000}}' }),
        createIsland({ 'component-url': '/_astro/B.js', client: 'idle', opts: '{}' }),
      );

      await loadRuntime();

      expect(idleCallbacks).toEqual([]);

      vi.advanceTimersByTime(200);

      expect(preloadedHrefs()).toEqual(['/_astro/B.js']);

      vi.advanceTimersByTime(800);

      expect(preloadedHrefs()).toEqual(['/_astro/B.js', '/_astro/A.js']);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  test('fires a media island at once when its query already matches', async () => {
    mediaMatches = true;
    register({ '/_astro/Nav.js': { l: ['/_astro/Nav.js'] } });
    document.body.append(
      createIsland({ 'component-url': '/_astro/Nav.js', client: 'media', opts: '{"value":"(min-width: 640px)"}' }),
    );

    await loadRuntime();

    expect(preloadedHrefs()).toEqual(['/_astro/Nav.js']);
    expect(mediaListeners.size).toBe(0);
  });

  test.each([
    ['a media island without a query', 'media', '{"name":"Nav","value":true}'],
    ['a media island with unparsable opts', 'media', '{not json'],
    ['an island without opts', 'idle', undefined],
    ['an unknown directive', 'hover', '{}'],
  ])('%s waits for idle', async (_name, client, opts) => {
    register({ '/_astro/Nav.js': { l: ['/_astro/Nav.js'] } });
    document.body.append(
      createIsland({ 'component-url': '/_astro/Nav.js', client, ...(opts !== undefined && { opts }) }),
    );

    await loadRuntime();

    expect(preloadedHrefs()).toEqual([]);
    expect(mediaListeners.size).toBe(0);
    expect(idleCallbacks).toHaveLength(1);

    idleCallbacks[0]!();

    expect(preloadedHrefs()).toEqual(['/_astro/Nav.js']);
  });

  test.each(['load', 'only', 'load-x'])('fires a registered %s island right away', async (client) => {
    register({ '/_astro/Now.js': { l: ['/_astro/Now.js'] } });
    document.body.append(createIsland({ 'component-url': '/_astro/Now.js', client, opts: '{}' }));

    await loadRuntime();

    expect(preloadedHrefs()).toEqual(['/_astro/Now.js']);
    expect(idleCallbacks).toEqual([]);
  });

  test('ignores islands without a component url or without a registry entry', async () => {
    register({ '/_astro/Known.js': { l: ['/_astro/Known.js'] } });
    document.body.append(
      createIsland({ client: 'idle', opts: '{}' }),
      createIsland({ 'component-url': '/_astro/Unregistered.js', client: 'idle', opts: '{}' }),
      createIsland({ 'component-url': '/_astro/Unregistered.js', client: 'visible', opts: '{}' }),
    );

    await loadRuntime();

    expect(idleCallbacks).toEqual([]);
    expect(observedTargets).toEqual([]);
  });

  test('a child leaving the viewport margin does not fire', async () => {
    register({ '/_astro/Menu.js': { l: ['/_astro/Menu.js'] } });

    const island = createIsland({ 'component-url': '/_astro/Menu.js', client: 'visible', opts: '{}' });

    document.body.append(island);
    await loadRuntime();

    intersect?.([{ target: island.firstElementChild!, isIntersecting: false }]);

    expect(preloadedHrefs()).toEqual([]);
    expect(unobservedTargets).toEqual([]);
  });

  test('a fired visible component stops observing its own children, other components stay observed', async () => {
    register({ '/_astro/Menu.js': { l: ['/_astro/Menu.js'] }, '/_astro/Footer.js': { l: ['/_astro/Footer.js'] } });

    const menu = createIsland({ 'component-url': '/_astro/Menu.js', client: 'visible', opts: '{}' }, 2);
    const secondMenu = createIsland({ 'component-url': '/_astro/Menu.js', client: 'visible', opts: '{}' });
    const footer = createIsland({ 'component-url': '/_astro/Footer.js', client: 'visible', opts: '{}' });

    document.body.append(menu, footer, secondMenu);
    await loadRuntime();

    intersect?.([{ target: menu.firstElementChild!, isIntersecting: true }]);

    expect(unobservedTargets).toEqual([...menu.children, ...secondMenu.children]);
    expect(preloadedHrefs()).toEqual(['/_astro/Menu.js']);

    intersect?.([{ target: footer.firstElementChild!, isIntersecting: true }]);

    expect(preloadedHrefs()).toEqual(['/_astro/Menu.js', '/_astro/Footer.js']);
  });

  test('a streamed visible island is not observed once another instance fired its component', async () => {
    register({ '/_astro/Menu.js': { l: ['/_astro/Menu.js'] } });

    const first = createIsland({ 'component-url': '/_astro/Menu.js', client: 'visible', opts: '{}' });
    const streamed = createIsland({ 'component-url': '/_astro/Menu.js', client: 'visible', opts: '{}' }, 0);

    document.body.append(first, streamed);
    await loadRuntime();

    intersect?.([{ target: first.firstElementChild!, isIntersecting: true }]);

    const child = document.createElement('div');

    streamed.append(child);
    mutate?.([{ addedNodes: [child] }]);

    expect(observedTargets).toEqual([first.firstElementChild]);
  });

  test('gates an island that is itself the inserted node', async () => {
    await loadRuntime();

    register({ '/_astro/Late.js': { l: ['/_astro/Late.js'] } });

    const island = createIsland({ 'component-url': '/_astro/Late.js', client: 'idle', opts: '{}' });

    document.body.append(island);
    mutate?.([{ addedNodes: [document.createTextNode('text'), island] }]);

    expect(idleCallbacks).toHaveLength(1);

    idleCallbacks[0]!();

    expect(preloadedHrefs()).toEqual(['/_astro/Late.js']);
  });

  test('a second inlined runtime, swapped in by a client router, does not gate again', async () => {
    register({ '/_astro/Cart.js': { l: ['/_astro/Cart.js'] } });
    document.body.append(createIsland({ 'component-url': '/_astro/Cart.js', client: 'idle', opts: '{}' }));

    await loadRuntime();
    await loadRuntime();

    expect(idleCallbacks).toHaveLength(1);
  });
});
