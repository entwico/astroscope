import {
  type DocumentEmitter,
  type IslandInfo,
  registerDocumentEmitter,
  registerIslandEmitter,
} from '@astroscope/node/islands';
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

/** an island's translated chunks and their urls for one locale */
type IslandSlice = {
  /** full closure: what the merge script covers */
  chunks: [name: string, hash: string][];
  /** static closure: preload links */
  links: string[];
  /** full closure: eager imports */
  imports: string[];
};

// islands arrive as the same object per component/renderer/directive and the
// hashes object is replaced whenever translations change, so keying on both
// caches each slice for exactly as long as it is valid
const slices = new WeakMap<Record<string, string>, WeakMap<IslandInfo, IslandSlice>>();
const inits = new Map<string, string>();

function sliceFor(island: IslandInfo, locale: string, hashes: Record<string, string>): IslandSlice {
  let byIsland = slices.get(hashes);

  if (!byIsland) {
    byIsland = new WeakMap();
    slices.set(hashes, byIsland);
  }

  let slice = byIsland.get(island);

  if (slice) {
    return slice;
  }

  const translated = (urls: string[]): [string, string][] => {
    const result: [string, string][] = [];

    for (const url of urls) {
      const chunk = urlToChunkName(url);
      const hash = hashes[chunk];

      if (hash) {
        result.push([chunk, hash]);
      }
    }

    return result;
  };

  const chunks = translated(island.fullClosure);

  slice = {
    chunks,
    links: translated(island.staticClosure).map(([chunk, hash]) => buildI18nChunkUrl(locale, chunk, hash)),
    imports: chunks.map(([chunk, hash]) => buildI18nChunkUrl(locale, chunk, hash)),
  };
  byIsland.set(island, slice);

  return slice;
}

function initFor(locale: string): string {
  let init = inits.get(locale);

  if (init === undefined) {
    init = jsonForScript({ locale, hashes: {}, translations: {} });
    inits.set(locale, init);
  }

  return init;
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
    const { chunks, links, imports } = sliceFor(island, locale, hashes);

    let emitted = emittedByContext.get(context);

    if (!emitted) {
      emitted = new Set();
      emittedByContext.set(context, emitted);
    }

    const merge: Record<string, string> = {};
    let fresh = false;

    for (const [chunk, hash] of chunks) {
      if (!emitted.has(chunk)) {
        emitted.add(chunk);
        merge[chunk] = hash;
        fresh = true;
      }
    }

    const html = fresh
      ? `<script>{const i=window.__i18n__??=${initFor(locale)};Object.assign(i.hashes,${jsonForScript(merge)});}</script>`
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
