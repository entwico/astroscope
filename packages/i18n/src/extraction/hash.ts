import { createHash } from 'node:crypto';
import type { RawTranslations } from '../shared/types.js';
import type { ChunkManifest } from './types.js';

/**
 * Hash a string to a short hash (for cache busting)
 */
function hashString(str: string): string {
  return createHash('sha256').update(str).digest('hex').substring(0, 8);
}

/**
 * Compute hash for chunk translations
 */
export function computeChunkHash(translations: RawTranslations, keys: string[]): string {
  const relevantTranslations: RawTranslations = {};

  for (const key of [...keys].sort()) {
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
