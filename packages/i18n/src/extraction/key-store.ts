import type { AstroIntegrationLogger } from 'astro';
import type { ConsistencyCheckLevel } from '../integration/types.js';
import type { TranslationMeta } from '../shared/types.js';
import type { ExtractedKey, ExtractedKeyOccurrence, ExtractionError } from './types.js';

/**
 * Inconsistency between two occurrences of the same translation key
 */
export type KeyInconsistency = {
  key: string;
  field: 'fallback' | 'description' | 'variables';
  locations: [string, string];
  values: [string, string];
};

/**
 * Store for extracted i18n keys.
 * Stores occurrences and produces deduplicated keys with all file locations.
 */
export class KeyStore {
  /** All key occurrences (may have duplicates) */
  private readonly occurrences: ExtractedKeyOccurrence[] = [];

  /** Tracks reported inconsistencies to avoid duplicate warnings */
  private readonly reportedInconsistencies = new Set<string>();

  /** Whether an error-level inconsistency was found (for build failure) */
  private hasInconsistencyError = false;

  /** Non-extractable t() meta, per file (replaced wholesale on HMR) */
  private readonly errorsByFile = new Map<string, ExtractionError[]>();

  readonly fileToKeys = new Map<string, string[]>();
  readonly filesWithI18n = new Set<string>();

  constructor(
    private readonly logger: AstroIntegrationLogger,
    private readonly consistency: ConsistencyCheckLevel = 'error',
  ) {}

  /**
   * Add key occurrences for a file, replacing any existing occurrences for that file.
   */
  addFileKeys(filename: string, keys: ExtractedKeyOccurrence[]): void {
    const newKeyStrings = keys.map((k) => k.key);
    const oldKeys = this.fileToKeys.get(filename);

    // log key changes on HMR
    if (oldKeys) {
      const uniqueNew = [...new Set(newKeyStrings)];
      const uniqueOld = [...new Set(oldKeys)];
      const added = uniqueNew.filter((k) => !uniqueOld.includes(k));
      const removed = uniqueOld.filter((k) => !uniqueNew.includes(k));
      const file = filename.split('/').pop();

      if (added.length > 0 || removed.length > 0) {
        const parts: string[] = [];

        if (added.length > 0) parts.push(`+${added.length}`);
        if (removed.length > 0) parts.push(`-${removed.length}`);

        this.logger.info(`hmr: ${parts.join(' ')} key(s) in ${file}`);
      }
    }

    // remove old occurrences for this file (if any)
    if (oldKeys) {
      for (let i = this.occurrences.length - 1; i >= 0; i--) {
        if (this.occurrences[i]?.file === filename) {
          this.occurrences.splice(i, 1);
        }
      }
    }

    this.filesWithI18n.add(filename);

    // check for inconsistencies before adding new keys
    if (this.consistency !== 'off') {
      this.checkConsistency(keys);
    }

    if (keys.length > 0) {
      this.occurrences.push(...keys);
    }

    this.fileToKeys.set(filename, newKeyStrings);
  }

  /**
   * Record the non-extractable t() calls found in a file, replacing any
   * previously recorded for it.
   */
  addFileErrors(filename: string, errors: ExtractionError[]): void {
    if (errors.length > 0) {
      this.errorsByFile.set(filename, errors);
    } else {
      this.errorsByFile.delete(filename);
    }
  }

  /**
   * All non-extractable t() calls found so far, across every scanned file.
   */
  get extractionErrors(): ExtractionError[] {
    return Array.from(this.errorsByFile.values()).flat();
  }

  /**
   * Check new keys for inconsistencies with existing occurrences.
   */
  private checkConsistency(newKeys: ExtractedKeyOccurrence[]): void {
    // build a map of existing keys (first occurrence for each key)
    const existingByKey = new Map<string, ExtractedKeyOccurrence>();

    for (const occ of this.occurrences) {
      if (!existingByKey.has(occ.key)) {
        existingByKey.set(occ.key, occ);
      }
    }

    for (const newKey of newKeys) {
      const existing = existingByKey.get(newKey.key);

      if (!existing) continue;

      const inconsistencies = this.findInconsistencies(newKey, existing);

      for (const inc of inconsistencies) {
        this.reportInconsistency(inc);
      }
    }
  }

  /**
   * Compare two occurrences and find any metadata inconsistencies.
   */
  private findInconsistencies(a: ExtractedKeyOccurrence, b: ExtractedKeyOccurrence): KeyInconsistency[] {
    const result: KeyInconsistency[] = [];
    const locA = `${a.file}:${a.line}`;
    const locB = `${b.file}:${b.line}`;

    // check fallback
    if (a.meta.fallback !== b.meta.fallback) {
      result.push({
        key: a.key,
        field: 'fallback',
        locations: [locA, locB],
        values: [a.meta.fallback, b.meta.fallback],
      });
    }

    // check description
    if (a.meta.description !== b.meta.description) {
      result.push({
        key: a.key,
        field: 'description',
        locations: [locA, locB],
        values: [a.meta.description ?? '(none)', b.meta.description ?? '(none)'],
      });
    }

    // check variables
    const varsA = this.serializeVariables(a.meta);
    const varsB = this.serializeVariables(b.meta);

    if (varsA !== varsB) {
      result.push({
        key: a.key,
        field: 'variables',
        locations: [locA, locB],
        values: [varsA || '(none)', varsB || '(none)'],
      });
    }

    return result;
  }

  /**
   * Serialize variables for comparison.
   */
  private serializeVariables(meta: TranslationMeta): string {
    if (!meta.variables) return '';

    // sort keys for consistent comparison
    const sorted: Record<string, unknown> = {};

    for (const key of Object.keys(meta.variables).sort()) {
      sorted[key] = meta.variables[key];
    }

    return JSON.stringify(sorted);
  }

  /**
   * Report an inconsistency via logger.
   */
  private reportInconsistency(inc: KeyInconsistency): void {
    // create a unique key for this inconsistency to avoid duplicate reports
    // use key+field only (not locations) to report once per inconsistent key
    const incKey = `${inc.key}:${inc.field}`;

    if (this.reportedInconsistencies.has(incKey)) return;

    this.reportedInconsistencies.add(incKey);

    const message =
      `inconsistent ${inc.field} for key "${inc.key}"\n` +
      `  ${inc.locations[0]}: ${JSON.stringify(inc.values[0])}\n` +
      `  ${inc.locations[1]}: ${JSON.stringify(inc.values[1])}`;

    if (this.consistency === 'error') {
      this.logger.error(message);
      this.hasInconsistencyError = true;
    } else {
      this.logger.warn(message);
    }
  }

  /**
   * Check if any error-level inconsistencies were found.
   * Call this at the end of build to determine if it should fail.
   */
  get hasErrors(): boolean {
    return this.hasInconsistencyError;
  }

  /**
   * Get deduplicated keys with all file locations merged.
   * Last occurrence's meta wins for each key.
   */
  get extractedKeys(): ExtractedKey[] {
    const keyMap = new Map<string, ExtractedKey>();

    for (const occurrence of this.occurrences) {
      const existing = keyMap.get(occurrence.key);
      const fileLocation = `${occurrence.file}:${occurrence.line}`;

      if (existing) {
        // add file location if not already present
        if (!existing.files.includes(fileLocation)) {
          existing.files.push(fileLocation);
        }

        // update meta (last one wins)
        existing.meta = occurrence.meta;
      } else {
        keyMap.set(occurrence.key, {
          key: occurrence.key,
          meta: occurrence.meta,
          files: [fileLocation],
        });
      }
    }

    return Array.from(keyMap.values());
  }

  /**
   * Get count of unique keys.
   */
  get uniqueKeyCount(): number {
    return new Set(this.occurrences.map((k) => k.key)).size;
  }

  /**
   * Merge another store's data into this one.
   */
  merge(other: KeyStore): void {
    for (const [file, keys] of other.fileToKeys) {
      this.fileToKeys.set(file, keys);
    }

    for (const [file, errors] of other.errorsByFile) {
      this.errorsByFile.set(file, errors);
    }

    for (const file of other.filesWithI18n) {
      this.filesWithI18n.add(file);
    }

    // check for inconsistencies when merging
    if (this.consistency !== 'off') {
      this.checkConsistency(other.occurrences);
    }

    this.occurrences.push(...other.occurrences);
  }

  /**
   * Internal access to occurrences (for merge)
   */
  get occurrencesList(): ExtractedKeyOccurrence[] {
    return this.occurrences;
  }
}
