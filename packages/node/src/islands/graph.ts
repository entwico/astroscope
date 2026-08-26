import type { IslandsManifest } from './types.js';

/**
 * Closure computation over the chunk import graph, memoized per manifest. The
 * manifest stores direct edges only — flattened closures repeat heavily across
 * entries and would bloat the JSON.
 */
export type ChunkGraph = {
  /** transitive static imports of a chunk, the chunk itself excluded */
  staticClosure(fileName: string): string[];
  /** transitive static + dynamic imports of a chunk, the chunk itself excluded */
  fullClosure(fileName: string): string[];
  has(fileName: string): boolean;
};

function createClosure(
  chunks: IslandsManifest['chunks'],
  edges: (entry: { i?: string[] | undefined; d?: string[] | undefined }) => string[],
): (fileName: string) => string[] {
  const cache = new Map<string, string[]>();

  const walk = (fileName: string, result: Set<string>, visited: Set<string>): void => {
    if (visited.has(fileName)) {
      return;
    }

    visited.add(fileName);

    const entry = chunks[fileName];

    if (!entry) {
      return;
    }

    for (const dep of edges(entry)) {
      result.add(dep);
      walk(dep, result, visited);
    }
  };

  return (fileName) => {
    const cached = cache.get(fileName);

    if (cached) {
      return cached;
    }

    const result = new Set<string>();

    walk(fileName, result, new Set());
    result.delete(fileName);

    const list = [...result];

    cache.set(fileName, list);

    return list;
  };
}

export function createChunkGraph(manifest: IslandsManifest): ChunkGraph {
  return {
    staticClosure: createClosure(manifest.chunks, (entry) => entry.i ?? []),
    fullClosure: createClosure(manifest.chunks, (entry) => [...(entry.i ?? []), ...(entry.d ?? [])]),
    has: (fileName) => fileName in manifest.chunks,
  };
}
