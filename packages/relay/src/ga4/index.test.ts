// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ga4, ga4Tag } from './index.js';

const meta = { id: 'e1', at: 0 };

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('dataLayer', undefined);
  vi.stubGlobal('gtag', undefined);
  vi.stubGlobal('google_tag_manager', {});
});

describe('ga4 builders', () => {
  test('a well-known event carries its parameters, the extra ones next to them; a custom one its name', () => {
    expect(ga4.search({ search_term: 'robot' })).toEqual({ name: 'search', params: { search_term: 'robot' } });
    expect(ga4.purchase({ transaction_id: 'o-1', value: 10, currency: 'EUR', items: [] }, { user_email: 'a@b.c' })).toEqual({
      name: 'purchase',
      params: { transaction_id: 'o-1', value: 10, currency: 'EUR', items: [], user_email: 'a@b.c' },
    });
    expect(ga4.event('open_filter', { facet: 'price' })).toEqual({ name: 'open_filter', params: { facet: 'price' } });
    expect(ga4.event('ping')).toEqual({ name: 'ping', params: {} });
  });
});

describe('ga4Tag', () => {
  test('installs the queue stub and sends the event by name and parameters', () => {
    const tag = ga4Tag();

    expect(globalThis.window.dataLayer).toEqual([]);

    tag.send(ga4.search({ search_term: 'robot' }), meta);

    const queued = globalThis.window.dataLayer?.[0] as Iterable<unknown>;

    expect([...queued]).toEqual(['event', 'search', { search_term: 'robot' }]);
  });

  test('is ready once the tag has loaded', () => {
    vi.stubGlobal('google_tag_manager', undefined);

    expect(ga4Tag().ready?.()).toBe(false);

    vi.stubGlobal('google_tag_manager', {});

    expect(ga4Tag().ready?.()).toBe(true);
  });
});
