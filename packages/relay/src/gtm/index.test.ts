// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { gtm, gtmContainer } from './index.js';

const meta = { id: 'e1', at: 0 };

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('dataLayer', undefined);
  vi.stubGlobal('google_tag_manager', {});
});

describe('gtm builders', () => {
  test('a commerce event puts its parameters under ecommerce and the extra ones next to the event', () => {
    expect(gtm.purchase({ transaction_id: 'o-1', value: 10, currency: 'EUR', items: [], discount_code: 'SAVE' }, { user_email: 'a@b.c' })).toEqual({
      event: 'purchase',
      user_email: 'a@b.c',
      ecommerce: { transaction_id: 'o-1', value: 10, currency: 'EUR', items: [], discount_code: 'SAVE' },
    });
  });

  test('a plain well-known event and a custom one are flat', () => {
    expect(gtm.search({ search_term: 'x' })).toEqual({ event: 'search', search_term: 'x' });
    expect(gtm.event('contactFormStatus', { status: 'success' })).toEqual({ event: 'contactFormStatus', status: 'success' });
  });

  test('the parameters never rename the event', () => {
    expect(gtm.search({ search_term: 'x' }, { event: 'other' })).toMatchObject({ event: 'search' });
    expect(gtm.search({ search_term: 'x', event: 'other' })).toMatchObject({ event: 'search' });
    expect(gtm.purchase({ transaction_id: 'o-1', value: 1, currency: 'EUR', items: [] }, { event: 'other' })).toMatchObject({ event: 'purchase' });
    expect(gtm.event('contact', { event: 'other' })).toMatchObject({ event: 'contact' });
  });
});

describe('gtmContainer', () => {
  test('is ready once the container has loaded', () => {
    vi.stubGlobal('google_tag_manager', undefined);

    expect(gtmContainer().ready?.()).toBe(false);

    vi.stubGlobal('google_tag_manager', {});

    expect(gtmContainer().ready?.()).toBe(true);
  });

  test('pushes a commerce event behind a cleared ecommerce object, with the event id', () => {
    gtmContainer().send(gtm.viewCart({ items: [], value: 5 }, { step: 2 }), meta);

    expect(globalThis.window.dataLayer).toEqual([{ ecommerce: null }, { event: 'view_cart', event_id: 'e1', step: 2, ecommerce: { items: [], value: 5 } }]);
  });

  test('pushes a plain event as it is, with the event id', () => {
    gtmContainer().send(gtm.event('view_search_results', { search_term: 'x' }), meta);

    expect(globalThis.window.dataLayer).toEqual([{ event: 'view_search_results', event_id: 'e1', search_term: 'x' }]);
  });
});
