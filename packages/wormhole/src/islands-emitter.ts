import { type DocumentEmitter, registerDocumentEmitter, registerIslandEmitter } from '@astroscope/node/islands';
import { log } from '@astroscope/node/log';
import { createWormholeMergeScript } from './client-state.js';
import { getWormholeManifest } from './manifest.js';
import { getRequestWormholes } from './request-store.js';

/**
 * Contributes each island's wormhole slice: an inline merge script with the values
 * of every open wormhole the island's full chunk closure (dynamic imports included)
 * can reach, emitted before the island tag — parsed strictly before the island
 * connects, even mid-stream. Names already written earlier in the document are
 * skipped; a `*` chunk (dynamic proxy access) degrades to all open wormholes.
 */

// vite defines import.meta.env when bundling the middleware; typed structurally
// so the package compiles without vite's global client types
const IS_DEV = !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV;

let registered = false;
let warnedMissingManifest = false;

/** public url of a chunk → manifest chunk name, e.g. `…/_astro/Counter.abc.js` → `Counter.abc` */
function urlToChunkName(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1).replace(/\.js$/, '');
}

/**
 * The document-level wormhole delivery, exported for tests: everything open as
 * `head` content in dev (or without a manifest), script-entry names as `end`
 * content in prod — running after the rewriter, names the islands emitter
 * already wrote are skipped race-free.
 */
export function createWormholeDocumentEmitter(dev: boolean = IS_DEV): DocumentEmitter {
  return (context) => {
    const request = getRequestWormholes(context.request);

    if (!request || request.values.size === 0) {
      return null;
    }

    if (dev) {
      return { head: createWormholeMergeScript(Object.fromEntries(request.values)) };
    }

    const manifest = getWormholeManifest();

    if (!manifest) {
      if (!warnedMissingManifest) {
        warnedMissingManifest = true;
        log.error(
          'wormhole manifest not found — delivering all open wormholes with every page (is the integration configured?)',
        );
      }

      return { head: createWormholeMergeScript(Object.fromEntries(request.values)) };
    }

    const names = manifest.scripts.includes('*')
      ? [...request.values.keys()]
      : manifest.scripts.filter((name) => request.values.has(name));

    if (names.length === 0) {
      return null;
    }

    return {
      end: () => {
        const fresh = names.filter((name) => !request.emitted.has(name));

        if (fresh.length === 0) {
          return null;
        }

        return createWormholeMergeScript(Object.fromEntries(fresh.map((name) => [name, request.values.get(name)])));
      },
    };
  };
}

export function registerWormholeEmitters(): void {
  if (registered) {
    return;
  }

  registered = true;

  registerDocumentEmitter(createWormholeDocumentEmitter());

  registerIslandEmitter((island, context) => {
    // no request context (prerendered build pass) — values are per-request, nothing to emit
    if (!context) {
      return null;
    }

    const request = getRequestWormholes(context.request);
    const manifest = getWormholeManifest();

    if (!request || request.values.size === 0 || !manifest) {
      return null;
    }

    let all = false;
    const reachable = new Set<string>();

    for (const url of island.fullClosure) {
      for (const name of manifest.chunks[urlToChunkName(url)] ?? []) {
        if (name === '*') {
          all = true;
        } else {
          reachable.add(name);
        }
      }
    }

    const entries: Record<string, unknown> = {};
    let count = 0;

    for (const name of all ? request.values.keys() : reachable) {
      if (!request.values.has(name) || request.emitted.has(name)) {
        continue;
      }

      request.emitted.add(name);
      entries[name] = request.values.get(name);
      count++;
    }

    if (count === 0) {
      return null;
    }

    return { html: createWormholeMergeScript(entries) };
  });
}
