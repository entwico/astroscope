import { describe, expect, test } from 'vitest';

import { resolveCanonical, toAbsolute } from './url';

describe('toAbsolute', () => {
  test('prefixes a root-relative path with the origin', () => {
    expect(toAbsolute('/foo', 'https://x.com')).toBe('https://x.com/foo');
  });

  test('leaves an already-absolute URL untouched', () => {
    expect(toAbsolute('https://other.com/p', 'https://x.com')).toBe('https://other.com/p');
  });

  test('passes undefined through', () => {
    expect(toAbsolute(undefined, 'https://x.com')).toBeUndefined();
  });
});

describe('resolveCanonical', () => {
  const base = { origin: 'https://x.com', pathname: '/page', hasSearchParams: false };

  test('absolutizes an explicit root-relative canonical', () => {
    expect(resolveCanonical({ ...base, canonical: '/c' })).toBe('https://x.com/c');
  });

  test('keeps an explicit absolute canonical', () => {
    expect(resolveCanonical({ ...base, canonical: 'https://x.com/c' })).toBe('https://x.com/c');
  });

  test('no canonical and no query params yields nothing', () => {
    expect(resolveCanonical(base)).toBeUndefined();
  });

  test('no canonical but query params present falls back to the bare path', () => {
    expect(resolveCanonical({ ...base, hasSearchParams: true })).toBe('https://x.com/page');
  });

  test('an explicit canonical wins over the query-param fallback', () => {
    expect(resolveCanonical({ ...base, hasSearchParams: true, canonical: '/explicit' })).toBe('https://x.com/explicit');
  });
});
