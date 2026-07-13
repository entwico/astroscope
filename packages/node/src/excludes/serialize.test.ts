import { describe, expect, test } from 'vitest';
import type { ExcludePattern } from './excludes';
import { serializeExcludePatterns } from './serialize';

function roundTrip(patterns: ExcludePattern[]): ExcludePattern[] {
  return new Function(`return ${serializeExcludePatterns(patterns)};`)() as ExcludePattern[];
}

describe('serializeExcludePatterns', () => {
  test('serializes an empty array', () => {
    expect(serializeExcludePatterns([])).toBe('[]');
  });

  test('serializes string patterns as json', () => {
    expect(serializeExcludePatterns([{ prefix: '/api/' }, { exact: '/health' }])).toBe(
      '[{"prefix":"/api/"}, {"exact":"/health"}]',
    );
  });

  test('serializes regex patterns as regex literals with flags', () => {
    expect(serializeExcludePatterns([{ pattern: /^\/api\/v\d+\//i }])).toBe('[{ pattern: /^\\/api\\/v\\d+\\//i }]');
  });

  test('round-trips mixed patterns through evaluation', () => {
    const patterns: ExcludePattern[] = [
      { prefix: '/@id/' },
      { suffix: '.svg' },
      { includes: 'internal' },
      { exact: '/health' },
      { pattern: /^\/_image/g },
    ];

    const evaluated = roundTrip(patterns);

    expect(evaluated).toHaveLength(patterns.length);
    expect(evaluated.slice(0, 4)).toEqual(patterns.slice(0, 4));

    const regex = (evaluated[4] as { pattern: RegExp }).pattern;

    expect(regex.source).toBe('^\\/_image');
    expect(regex.flags).toBe('g');
  });

  test('escapes special characters in string values', () => {
    const patterns: ExcludePattern[] = [{ exact: '/pa"th\\with\nweird' }];

    expect(roundTrip(patterns)).toEqual(patterns);
  });
});
