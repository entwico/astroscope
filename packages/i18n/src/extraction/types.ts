import type { TranslationMeta } from '../shared/types.js';

/**
 * Single occurrence of a translation key (used during extraction)
 */
export type ExtractedKeyOccurrence = {
  key: string;
  meta: TranslationMeta;
  file: string;
  line: number;
};

/**
 * A t() call whose meta could not be read statically at build time.
 *
 * The line is the position babel saw, which for .astro files is a position in
 * the compiled output rather than the authored source — the key is the reliable
 * anchor for the developer.
 */
export type ExtractionError = {
  key: string;
  reason: string;
  file: string;
  line: number;
  column: number;
};

/**
 * Deduplicated translation key with all file locations (used in manifest)
 */
export type ExtractedKey = {
  key: string;
  meta: TranslationMeta;
  /** All locations where this key is used (file:line format) */
  files: string[];
};

/**
 * Chunk-to-keys mapping produced by Vite plugin
 */
export type ChunkManifest = Record<string, string[]>;

/**
 * Full extraction manifest
 */
export type ExtractionManifest = {
  keys: ExtractedKey[];
  chunks: ChunkManifest;
  /**
   * i18n chunks reachable from astro `<script>` entries. Script modules are not
   * islands, so no island carries their hashes — the middleware bootstraps these
   * few page-agnostically instead.
   */
  scripts: string[];
};
