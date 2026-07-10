import type { ExcludePattern } from './excludes.js';

/**
 * Serialize exclude patterns to JavaScript code for use in virtual modules.
 * Handles RegExp objects which JSON.stringify cannot serialize.
 */
export function serializeExcludePatterns(patterns: ExcludePattern[]): string {
  return `[${patterns.map((p) => ('pattern' in p ? `{ pattern: ${p.pattern.toString()} }` : JSON.stringify(p))).join(', ')}]`;
}
