import { describe, expect, test } from 'vitest';
import { meta } from './shared.js';

describe('meta builders', () => {
  test('a standard event carries its name, its parameters and the identifiers', () => {
    expect(meta.purchase({ value: 129.99, currency: 'EUR', order_id: 'o-1' }, { email: 'a@b.c' })).toEqual({
      name: 'Purchase',
      custom: false,
      data: { value: 129.99, currency: 'EUR', order_id: 'o-1' },
      user: { email: 'a@b.c' },
    });
    expect(meta.lead()).toEqual({ name: 'Lead', custom: false, data: {}, user: undefined });
    expect(meta.pageView()).toMatchObject({ name: 'PageView', custom: false });
    expect(meta.standard('AddToWishlist', { content_ids: ['a'] })).toMatchObject({ name: 'AddToWishlist', custom: false, data: { content_ids: ['a'] } });
  });

  test('a custom event goes by its own name', () => {
    expect(meta.event('QuizResult', { status: 'hp' })).toEqual({ name: 'QuizResult', custom: true, data: { status: 'hp' }, user: undefined });
  });
});
