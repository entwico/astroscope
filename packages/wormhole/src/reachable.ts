import type { WormholeManifest } from './extraction/types.js';

/** public url or dist-relative file name of a chunk → manifest chunk name, e.g. `…/_astro/Counter.abc.js` → `Counter.abc` */
export function chunkName(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1).replace(/\.js$/, '');
}

/**
 * The wormhole names the chunks of a closure can reach; `null` when one of them
 * reads dynamically (`*` — all open wormholes).
 */
export function namesInClosure(closure: Iterable<string>, manifest: WormholeManifest): string[] | null {
  const names = new Set<string>();

  for (const url of closure) {
    for (const name of manifest.chunks[chunkName(url)] ?? []) {
      if (name === '*') {
        return null;
      }

      names.add(name);
    }
  }

  return [...names];
}
