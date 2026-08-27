import { type DocumentEmitter, registerDocumentEmitter, registerIslandEmitter } from '@astroscope/node/islands';
import type { APIContext } from 'astro';
import { buildI18nChunkUrl } from '../shared/url.js';
import { createFullStateScript, createScriptHashesScript, jsonForScript } from './client-state.js';
import { i18n } from './i18n.js';

/**
 * Contributes the i18n slice for each island the `@astroscope/node` islands
 * middleware streams past:
 *
 * - an inline merge script with the hashes of the island's full chunk closure —
 *   dynamic imports included, since a `React.lazy` chunk's injected loader reads
 *   its hash at execution time. Emitted before the island tag, it is parsed
 *   strictly before the island connects, and the island's chunks execute at
 *   least a network round-trip later — so each island's hashes win their race
 *   even while the rest of the document is still streaming. Chunks already
 *   covered earlier in the document are skipped.
 * - translation-chunk preload links for the static closure (link tags on
 *   immediate islands).
 * - translation-chunk eager imports for the full closure, dynamic chunks
 *   included, fired by the deferred gate: the chunks are idempotent data
 *   modules, so early evaluation is free and the loader's awaited import hits
 *   the module cache instead of fetching after the component graph evaluated.
 *   No per-document dedup — a shared chunk is covered by whichever island's
 *   gate fires first.
 *
 * The locale is recorded per request by the i18n middleware — the emitter runs
 * while the response streams, outside the middleware's AsyncLocalStorage scope.
 */

const requestLocales = new WeakMap<Request, string>();
const emittedByContext = new WeakMap<APIContext, Set<string>>();

// vite defines import.meta.env when bundling the middleware; typed structurally
// so the package compiles without vite's global client types
const IS_DEV = !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV;

let registered = false;

export function setRequestLocale(request: Request, locale: string): void {
  requestLocales.set(request, locale);
}

/** public url of a chunk → manifest chunk name, e.g. `…/_astro/Cart.abc.js` → `Cart.abc` */
function urlToChunkName(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1).replace(/\.js$/, '');
}

/**
 * The document-level bootstrap for `window.__i18n__`, exported for tests.
 */
export function createI18nDocumentEmitter(dev: boolean = IS_DEV): DocumentEmitter {
  return (context) => {
    if (!i18n.isConfigured()) {
      return null;
    }

    const locale = requestLocales.get(context.request);

    if (locale === undefined) {
      return null;
    }

    if (dev) {
      return { head: createFullStateScript(locale) };
    }

    if (Object.keys(i18n.getManifest().chunks).length === 0) {
      return null;
    }

    return { end: () => createScriptHashesScript(locale) };
  };
}

export function registerI18nEmitters(): void {
  if (registered) {
    return;
  }

  registered = true;

  registerDocumentEmitter(createI18nDocumentEmitter());

  registerIslandEmitter((island, context) => {
    // no request context (prerendered build pass) — the locale is unknowable
    if (!context || !i18n.isConfigured()) {
      return null;
    }

    const locale = requestLocales.get(context.request);

    if (locale === undefined) {
      return null;
    }

    const hashes = i18n.getHashes(locale);

    let emitted = emittedByContext.get(context);

    if (!emitted) {
      emitted = new Set();
      emittedByContext.set(context, emitted);
    }

    const merge: Record<string, string> = {};

    for (const url of island.fullClosure) {
      const chunk = urlToChunkName(url);
      const hash = hashes[chunk];

      if (hash && !emitted.has(chunk)) {
        emitted.add(chunk);
        merge[chunk] = hash;
      }
    }

    const links: string[] = [];

    for (const url of island.staticClosure) {
      const chunk = urlToChunkName(url);
      const hash = hashes[chunk];

      if (hash) {
        links.push(buildI18nChunkUrl(locale, chunk, hash));
      }
    }

    const imports: string[] = [];

    for (const url of island.fullClosure) {
      const chunk = urlToChunkName(url);
      const hash = hashes[chunk];

      if (hash) {
        imports.push(buildI18nChunkUrl(locale, chunk, hash));
      }
    }

    const init = jsonForScript({ locale, hashes: {}, translations: {} });
    const html =
      Object.keys(merge).length > 0
        ? `<script>{const i=window.__i18n__??=${init};Object.assign(i.hashes,${jsonForScript(merge)});}</script>`
        : undefined;

    if (!html && links.length === 0 && imports.length === 0) {
      return null;
    }

    return {
      html,
      links: links.length > 0 ? links : undefined,
      imports: imports.length > 0 ? imports : undefined,
    };
  });
}
