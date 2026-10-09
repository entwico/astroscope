import { createHash } from 'node:crypto';
import type { RawTranslations } from '../shared/types.js';
import type { ChunkManifest } from './types.js';

/**
 * Hash a string to a short hash (for cache busting)
 */
function hashString(str: string): string {
  return createHash('sha256').update(str).digest('hex').slice(0, 8);
}

// code-unit order (what the default sort does): the order feeds the hash, so it must not depend on icu locale data
function compareKeys(a: string, b: string): number {
  if (a === b) return 0;

  return a < b ? -1 : 1;
}

/**
 * Compute hash for chunk translations
 */
export function computeChunkHash(translations: RawTranslations, keys: string[]): string {
  const relevantTranslations: RawTranslations = {};
  const sortedKeys = keys.toSorted(compareKeys);

  for (const key of sortedKeys) {
    if (translations[key] !== undefined) {
      relevantTranslations[key] = translations[key];
    }
  }

  return hashString(JSON.stringify(relevantTranslations));
}

/**
 * Compute hashes for all chunks in manifest
 */
export function computeAllChunkHashes(translations: RawTranslations, manifest: ChunkManifest): Record<string, string> {
  const hashes: Record<string, string> = {};

  for (const [chunkId, keys] of Object.entries(manifest)) {
    hashes[chunkId] = computeChunkHash(translations, keys);
  }

  return hashes;
}
