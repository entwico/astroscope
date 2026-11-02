import { describe, expect, test } from 'vitest';
import { openai } from './shared.js';

describe('openai builders', () => {
  test('a contents event carries its items in minor units and the identifiers', () => {
    const event = openai.orderCreated({
      items: [{ id: 'S1', name: 'Seminar', price: 129.99, quantity: 1 }],
      value: 129.99,
      currency: 'EUR',
      contentType: 'seminar',
      user: { email: 'a@b.c' },
    });

    expect(event).toEqual({
      name: 'order_created',
      data: {
        type: 'contents',
        amount: 12_999,
        currency: 'EUR',
        contents: [{ id: 'S1', name: 'Seminar', content_type: 'seminar', quantity: 1, amount: 12_999, currency: 'EUR' }],
      },
      user: { email: 'a@b.c' },
    });
  });

  test('sums the items when no value is given, products by default', () => {
    const event = openai.itemsAdded({ items: [{ id: 'a', name: 'A', price: 10, quantity: 2 }], currency: 'EUR' });

    expect(event.data).toMatchObject({ amount: 2000, contents: [{ content_type: 'product' }] });
    expect(event.user).toBeUndefined();
  });

  test('a lead carries no contents', () => {
    expect(openai.leadCreated({ phone: '0171' })).toEqual({ name: 'lead_created', data: { type: 'customer_action' }, user: { phone: '0171' } });
  });

  test('rounds to the minor unit', () => {
    expect(openai.contentsViewed({ items: [{ id: '1', name: 'x', price: 0.1 + 0.2, quantity: 1 }], value: 0.3, currency: 'CHF' }).data)
      .toMatchObject({ amount: 30, contents: [{ amount: 30 }] });
  });
});
