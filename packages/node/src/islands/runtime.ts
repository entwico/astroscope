/**
 * Gate runtime for deferred island preloading, inlined into the document by the
 * islands transform as a self-contained iife (keep this file import-free and
 * free of `</script>` sequences).
 *
 * The transform registers each deferred island's entry on `self.__islands__`,
 * keyed by component-url (`PRELOAD_GLOBAL` in `transform.ts` — keep in sync).
 * An entry is `{l, i}`: `l` urls get `<link rel="modulepreload">` injected, `i`
 * urls (data modules, e.g. translation chunks) are eagerly `import()`ed so the
 * component's own awaited import hits the module cache. A plain array entry
 * (the old protocol, possible across a deploy boundary via a client router)
 * means links only.
 *
 * Executes at parse time; islands are picked up as they stream in or get
 * swapped in later, and fire by their directive's own scheduling: idle/unknown
 * → requestIdleCallback (honoring a timeout), media → matchMedia, visible →
 * IntersectionObserver on the island's element children (the island itself is
 * display:contents, boxless) with expanded rootMargin. Whichever instance's
 * gate fires first wins; injection and imports dedupe per url. A failed eager
 * import is swallowed — the component's own import retries.
 */

// a client-router swap can pull in a second inlined runtime — only the first
// install may observe, or every island would gate twice
const INSTALLED = Symbol.for('@astroscope/node.islandsRuntime');

type RegistryEntry = string[] | { l?: string[]; i?: string[] };

const scope = globalThis as { [INSTALLED]?: boolean; __islands__?: Record<string, RegistryEntry> };

const fired = new Set<string>();
const injected = new Set<string>();
const imported = new Set<string>();
const observed = new Map<Element, string>();
const awaitingChildren = new Map<Element, string>();

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

function unobserve(componentUrl: string): void {
  for (const [el, url] of observed) {
    if (url === componentUrl) {
      observer!.unobserve(el);
      observed.delete(el);
    }
  }
}

// astro-island is display:contents — boxless, IntersectionObserver never fires
// on it. observe the element children instead, like astro's visible directive;
// a streamed island may have none yet, so it waits for the mutation observer
function observe(el: Element, componentUrl: string): void {
  if (el.children.length === 0) {
    awaitingChildren.set(el, componentUrl);

    return;
  }

  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const url = observed.get(entry.target);

          if (url) {
            unobserve(url);
            fire(url);
          }
        }
      }
    },
    { rootMargin: '100% 0px' },
  );

  for (const child of el.children) {
    observed.set(child, componentUrl);
    observer.observe(child);
  }
}

function observeArrivedChildren(): void {
  for (const [el, url] of awaitingChildren) {
    if (fired.has(url)) {
      awaitingChildren.delete(el);
    } else if (el.children.length > 0) {
      awaitingChildren.delete(el);
      observe(el, url);
    }
  }
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

    if (awaitingChildren.size > 0) {
      observeArrivedChildren();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

export {};
