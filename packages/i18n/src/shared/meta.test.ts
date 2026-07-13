import { describe, expect, test } from 'vitest';
import { normalizeMeta } from './meta';
import type { TranslationMeta } from './types';

describe('normalizeMeta', () => {
  test('wraps a string into a meta object with fallback', () => {
    expect(normalizeMeta('Hello')).toEqual({ fallback: 'Hello' });
  });

  test('wraps an empty string', () => {
    expect(normalizeMeta('')).toEqual({ fallback: '' });
  });

  test('returns meta objects unchanged', () => {
    const meta: TranslationMeta = {
      fallback: 'Hello {$name}',
      variables: { name: { fallback: 'World' } },
      description: 'greeting',
    };

    expect(normalizeMeta(meta)).toBe(meta);
  });
});
