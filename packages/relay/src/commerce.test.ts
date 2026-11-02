import { describe, expect, test } from 'vitest';
import { isCommerceEvent, wellKnownEvents } from './commerce.js';

describe('wellKnownEvents', () => {
  test('one builder per well-known event, typed by its parameters, passing the extra ones through', () => {
    const builders = wellKnownEvents((name, params, extra) => ({ name, params, extra }));

    expect(builders.search({ search_term: 'x', results: 3 })).toEqual({ name: 'search', params: { search_term: 'x', results: 3 }, extra: undefined });
    expect(builders.purchase({ transaction_id: 'o-1', value: 10, currency: 'EUR', items: [] }, { user_email: 'a@b.c' })).toEqual({
      name: 'purchase',
      params: { transaction_id: 'o-1', value: 10, currency: 'EUR', items: [] },
      extra: { user_email: 'a@b.c' },
    });
    expect(Object.keys(builders)).toHaveLength(15);
  });

  test('the commerce events are the ones a container reads under ecommerce', () => {
    expect(isCommerceEvent('purchase')).toBe(true);
    expect(isCommerceEvent('view_item_list')).toBe(true);
    expect(isCommerceEvent('search')).toBe(false);
    expect(isCommerceEvent('contactFormStatus')).toBe(false);
  });
});
