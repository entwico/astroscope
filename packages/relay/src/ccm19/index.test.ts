// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ccm19 } from './index.js';
import '../test-destinations.js';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('CCM', undefined);
});

describe('ccm19', () => {
  test('an embedding is unknown until ccm19 has run, then answered by id', () => {
    const consent = ccm19({ a: { embedding: 'emb-1' }, b: { embedding: undefined } });

    expect(consent.names).toEqual(['a', 'b']);
    expect(consent.of('a')).toBeUndefined();

    vi.stubGlobal('CCM', { acceptedEmbeddings: [] });

    expect(consent.of('a')).toBe(false);

    vi.stubGlobal('CCM', { acceptedEmbeddings: [{ id: 'emb-1', name: 'Tag Manager' }] });

    expect(consent.of('a')).toBe(true);
    expect(consent.of('b')).toBe(false);
  });

  test('a cookie rule matches the accepted patterns, an own answer and a free destination pass through', () => {
    const consent = ccm19({ a: { cookie: (pattern) => pattern.startsWith('_ga') }, b: () => true, free: false });

    expect(consent.of('a')).toBeUndefined();
    expect(consent.of('b')).toBe(true);
    expect(consent.of('free')).toBe(true);
    expect(consent.free).toEqual(['free']);

    vi.stubGlobal('CCM', { acceptedCookies: ['_gid', '_ga_*'] });

    expect(consent.of('a')).toBe(true);

    vi.stubGlobal('CCM', { acceptedCookies: ['PHPSESSID'] });

    expect(consent.of('a')).toBe(false);
  });

  test('watch re-checks when the widget closes', () => {
    const notify = vi.fn();

    ccm19({ a: () => true }).watch?.(notify);
    window.dispatchEvent(new Event('ccm19WidgetClosed'));

    expect(notify).toHaveBeenCalledTimes(1);
  });
});
