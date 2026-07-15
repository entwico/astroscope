import MagicString from 'magic-string';
import { describe, expect, test } from 'vitest';
import { mapErrorsToSource } from './source-map.js';
import type { ExtractionError } from './types.js';

// original source with the t() call on line 5, compiled to line 2 by removing comments
const ORIGINAL = ['const a = 1;', '// c2', '// c3', '// c4', "const bad = t('key', `x ${a}`);"].join('\n');

const createFixture = () => {
  const s = new MagicString(ORIGINAL);

  s.remove(ORIGINAL.indexOf('// c2'), ORIGINAL.indexOf('// c4') + '// c4\n'.length);

  const compiled = s.toString();

  return {
    map: s.generateMap({ hires: true, source: 'orig.ts', includeContent: true }),
    compiledLine: compiled.split('\n').findIndex((l) => l.includes('t(')) + 1,
    compiledColumn: compiled.split('\n')[1]?.indexOf('t(') ?? 0,
  };
};

const createError = (line: number, column: number): ExtractionError => ({
  key: 'key',
  reason: 'the fallback is a template literal with expressions',
  file: 'orig.ts',
  line,
  column,
});

describe('mapErrorsToSource', () => {
  test('rewrites a compiled position back to the authored line', () => {
    const { map, compiledLine, compiledColumn } = createFixture();

    expect(compiledLine).toBe(2);

    const [mapped] = mapErrorsToSource([createError(compiledLine, compiledColumn)], map);

    expect(mapped?.line).toBe(5);
  });

  test('leaves errors untouched when there is no map', () => {
    const errors = [createError(2, 12)];

    expect(mapErrorsToSource(errors, undefined)).toBe(errors);
    expect(mapErrorsToSource(errors, null)).toBe(errors);
  });

  test('returns early for an empty error list', () => {
    expect(mapErrorsToSource([], createFixture().map)).toEqual([]);
  });

  test('keeps the original position when the map is unusable', () => {
    const [mapped] = mapErrorsToSource([createError(2, 12)], { garbage: true });

    expect(mapped?.line).toBe(2);
  });

  test('keeps the original position when nothing maps to it', () => {
    const { map } = createFixture();

    const [mapped] = mapErrorsToSource([createError(9999, 0)], map);

    expect(mapped?.line).toBe(9999);
  });

  test('preserves the key and reason while remapping', () => {
    const { map, compiledLine, compiledColumn } = createFixture();

    const [mapped] = mapErrorsToSource([createError(compiledLine, compiledColumn)], map);

    expect(mapped?.key).toBe('key');
    expect(mapped?.reason).toBe('the fallback is a template literal with expressions');
  });
});
