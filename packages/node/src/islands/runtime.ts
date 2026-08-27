/**
 * Gate runtime for deferred island preloading, inlined into the document by the
 * islands transform (built as a self-contained iife — keep this file import-free
 * so tsdown cannot split it, and free of `</script>` sequences so it can sit in
 * an inline script tag).
 *
 * The islands middleware registers each deferred island's entry on
 * `self.__islands__`, keyed by component-url, via an inline script before the
 * first island per component (`PRELOAD_GLOBAL` in `transform.ts` — keep in
 * sync); the registration takes effect at parse time and outlives the island
 * element itself. An entry is `{l, i}`: `l` urls get `<link rel="modulepreload">`
 * injected, `i` urls (data modules, e.g. translation chunks) are eagerly
 * `import()`ed so they land in the module loader cache before the component's
 * own top-level-await import asks for them — from the same instant the component
 * fetch starts, not a low-priority preload racing it. A plain array entry (the
 * pre-`{l, i}` protocol, possible across a deploy boundary when a client router
 * swaps in cached html) is treated as links only.
 *
 * This script executes at parse time, before any island exists — islands are
 * picked up as they stream in (MutationObserver), or swapped in later by a
 * client router — and fires a component's entry when one of its islands is about
 * to hydrate, replicating the *scheduling* of astro's client directives without
 * touching their behavior:
 *
 * - `idle` (and any unknown directive): requestIdleCallback, honoring a timeout
 * - `media`: matchMedia on the directive's own query
 * - `visible`: IntersectionObserver on the island, with an expanded rootMargin so
 *   the fetch leads the hydration decision by roughly a viewport
 *
 * Islands beyond the first share their component's entry through the registry, and
 * whichever instance's gate fires first wins; injection and imports are
 * deduplicated per url, and the browser deduplicates preloads against the module
 * loader anyway. Failure stays preload-shaped: a failed eager import is swallowed,
 * and the component's own import retries the fetch.
 */

// a client-router swap after a deploy can pull in a second inlined runtime —
// only the first install may observe, or every island would gate twice
const INSTALLED = Symbol.for('@astroscope/node.islandsRuntime');

type RegistryEntry = string[] | { l?: string[]; i?: string[] };

const scope = globalThis as { [INSTALLED]?: boolean; __islands__?: Record<string, RegistryEntry> };

const fired = new Set<string>();
const injected = new Set<string>();
const imported = new Set<string>();
const observed = new Map<Element, string>();

let observer: IntersectionObserver | undefined;

function inject(urls: string[]): void {
  for (const url of urls) {
    if (injected.has(url)) {
      continue;
    }

    injected.add(url);

    const link = document.createElement('link');

    link.rel = 'modulepreload';
    link.setAttribute('fetchpriority', 'low');
    link.href = url;

    document.head.append(link);
  }
}

function fire(componentUrl: string): void {
  if (fired.has(componentUrl)) {
    return;
  }

  fired.add(componentUrl);

  const entry = scope.__islands__?.[componentUrl];

  if (!entry) {
    return;
  }

  const links = Array.isArray(entry) ? entry : (entry.l ?? []);
  const imports = Array.isArray(entry) ? [] : (entry.i ?? []);

  for (const url of imports) {
    if (imported.has(url)) {
      continue;
    }

    imported.add(url);
    import(url).catch(() => undefined);
  }

  inject(links);
}

function directiveValue(el: Element): unknown {
  try {
    return (JSON.parse(el.getAttribute('opts') ?? '') as { value?: unknown }).value;
  } catch {
    return undefined;
  }
}

function observe(el: Element, componentUrl: string): void {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const url = observed.get(entry.target);

          observer!.unobserve(entry.target);
          observed.delete(entry.target);

          if (url) {
            fire(url);
          }
        }
      }
    },
    { rootMargin: '100% 0px' },
  );

  observed.set(el, componentUrl);
  observer.observe(el);
}

function gate(el: Element): void {
  const componentUrl = el.getAttribute('component-url');

  if (!componentUrl) {
    return;
  }

  if (fired.has(componentUrl) || !scope.__islands__?.[componentUrl]) {
    return;
  }

  const directive = (el.getAttribute('client') ?? '').replace(/-x$/, '');

  if (directive === 'media') {
    const value = directiveValue(el);

    if (typeof value === 'string') {
      const query = matchMedia(value);

      if (query.matches) {
        fire(componentUrl);
      } else {
        query.addEventListener('change', () => fire(componentUrl), { once: true });
      }

      return;
    }
  }

  if (directive === 'visible') {
    observe(el, componentUrl);

    return;
  }

  if (directive === 'load' || directive === 'only') {
    // immediate islands normally get server-emitted link tags instead; if one
    // carries gate data anyway, fire right away
    fire(componentUrl);

    return;
  }

  // idle, a malformed media query, and unknown directives
  const value = directiveValue(el);
  const timeout = typeof value === 'object' && value !== null ? (value as { timeout?: unknown }).timeout : undefined;
  const run = (): void => fire(componentUrl);

  if ('requestIdleCallback' in window) {
    requestIdleCallback(run, typeof timeout === 'number' ? { timeout } : undefined);
  } else {
    setTimeout(run, typeof timeout === 'number' ? timeout : 200);
  }
}

function scan(root: ParentNode): void {
  for (const el of root.querySelectorAll('astro-island')) {
    gate(el);
  }
}

if (!scope[INSTALLED]) {
  scope[INSTALLED] = true;

  scan(document);

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) {
          if (node.localName === 'astro-island') {
            gate(node);
          } else {
            scan(node);
          }
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

export {};
