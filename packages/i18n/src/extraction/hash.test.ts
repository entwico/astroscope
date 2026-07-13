import { describe, expect, test } from 'vitest';
import type { RawTranslations } from '../shared/types';
import { computeAllChunkHashes, computeChunkHash } from './hash';

const translations: RawTranslations = {
  'cart.title': 'Shopping Cart',
  'cart.items': '{$count} items',
  'checkout.title': 'Checkout',
};

describe('computeChunkHash', () => {
  test('returns an 8-character hex hash', () => {
    const hash = computeChunkHash(translations, ['cart.title']);

    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  test('is deterministic for the same input', () => {
    const a = computeChunkHash(translations, ['cart.title', 'cart.items']);
    const b = computeChunkHash(translations, ['cart.title', 'cart.items']);

    expect(a).toBe(b);
  });

  test('is independent of key order', () => {
    const a = computeChunkHash(translations, ['cart.items', 'cart.title']);
    const b = computeChunkHash(translations, ['cart.title', 'cart.items']);

    expect(a).toBe(b);
  });

  test('changes when a translation value changes', () => {
    const changed: RawTranslations = { ...translations, 'cart.title': 'Basket' };

    const a = computeChunkHash(translations, ['cart.title']);
    const b = computeChunkHash(changed, ['cart.title']);

    expect(a).not.toBe(b);
  });

  test('ignores keys that have no translation', () => {
    const a = computeChunkHash(translations, ['cart.title']);
    const b = computeChunkHash(translations, ['cart.title', 'unknown.key']);

    expect(a).toBe(b);
  });

  test('ignores translations for keys outside the chunk', () => {
    const a = computeChunkHash(translations, ['cart.title']);
    const b = computeChunkHash({ 'cart.title': 'Shopping Cart' }, ['cart.title']);

    expect(a).toBe(b);
  });

  test('handles empty keys', () => {
    const hash = computeChunkHash(translations, []);

    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(hash).toBe(computeChunkHash({}, []));
  });

  test('does not mutate the keys array', () => {
    const keys = ['checkout.title', 'cart.title'];

    computeChunkHash(translations, keys);

    expect(keys).toEqual(['checkout.title', 'cart.title']);
  });

  test('distinguishes an empty translation from a missing one', () => {
    const a = computeChunkHash({ 'cart.title': '' }, ['cart.title']);
    const b = computeChunkHash({}, ['cart.title']);

    expect(a).not.toBe(b);
  });
});

describe('computeAllChunkHashes', () => {
  test('computes a hash per chunk', () => {
    const hashes = computeAllChunkHashes(translations, {
      'Cart.abc': ['cart.title', 'cart.items'],
      'Checkout.def': ['checkout.title'],
    });

    expect(Object.keys(hashes)).toEqual(['Cart.abc', 'Checkout.def']);
    expect(hashes['Cart.abc']).toBe(computeChunkHash(translations, ['cart.title', 'cart.items']));
    expect(hashes['Checkout.def']).toBe(computeChunkHash(translations, ['checkout.title']));
  });

  test('returns empty record for empty manifest', () => {
    expect(computeAllChunkHashes(translations, {})).toEqual({});
  });
});
