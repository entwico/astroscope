/**
 * Consistency check level for translation keys.
 * Controls behavior when the same key has different fallbacks/variables across files.
 *
 * - 'error' (default): Fail the build
 * - 'warn': Log a warning but continue
 * - 'off': Disable consistency checking
 */
export type ConsistencyCheckLevel = 'off' | 'warn' | 'error';

export interface I18nOptions {
  /**
   * How to handle inconsistent translation keys (same key with different fallbacks/variables).
   * @default 'error'
   */
  consistency?: ConsistencyCheckLevel | undefined;
}
