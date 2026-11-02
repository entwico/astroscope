import { describe, expect, test } from 'vitest';
import { hashUser, normalizeCountry, normalizeName, normalizePhone, normalizePostalCode, sha256 } from './conversion-user.js';

describe('normalizePhone', () => {
  test('a national number gets the country calling code', () => {
    expect(normalizePhone('0171 234 56 78', '49')).toBe('491712345678');
  });

  test('international prefixes are dropped', () => {
    expect(normalizePhone('+49 171 2345678', '49')).toBe('491712345678');
    expect(normalizePhone('0049 (171) 234-5678', '49')).toBe('491712345678');
  });

  test('a number already carrying its code is kept', () => {
    expect(normalizePhone('41791234567', '49')).toBe('41791234567');
  });

  test('anything not 8 to 15 digits is dropped', () => {
    expect(normalizePhone('123', '49')).toBeUndefined();
    expect(normalizePhone('', '49')).toBeUndefined();
    expect(normalizePhone(undefined, '49')).toBeUndefined();
  });
});

describe('normalizeName', () => {
  test('lowercase without whitespace and punctuation', () => {
    expect(normalizeName(' O Brien-Smith ')).toBe('obriensmith');
    expect(normalizeName('')).toBeUndefined();
  });
});

describe('normalizePostalCode', () => {
  test('lowercase without whitespace', () => {
    expect(normalizePostalCode(' 80331 ')).toBe('80331');
    expect(normalizePostalCode('SW1A 1AA')).toBe('sw1a1aa');
    expect(normalizePostalCode('')).toBeUndefined();
  });
});

describe('normalizeCountry', () => {
  test('the lowercase two-letter code, anything else is dropped', () => {
    expect(normalizeCountry(' DE ')).toBe('de');
    expect(normalizeCountry('Deutschland')).toBeUndefined();
    expect(normalizeCountry(undefined)).toBeUndefined();
  });
});

describe('hashUser', () => {
  test('hashes the normalized identifiers as lowercase hex and leaves out the empty ones', async () => {
    const hashed = await hashUser({ email: ' Jane@Example.com ', phone: '0171 2345678', lastName: '' }, { countryCallingCode: '49' });

    expect(hashed).toEqual({
      email: await sha256('jane@example.com'),
      phone: await sha256('491712345678'),
    });
    expect(hashed.email).toMatch(/^[0-9a-f]{64}$/);
  });

  test('hashes the address and the external id the same way', async () => {
    const hashed = await hashUser({ city: 'München', postalCode: '80331', country: 'DE', externalId: ' c-1 ' });

    expect(hashed).toEqual({
      city: await sha256('münchen'),
      postalCode: await sha256('80331'),
      country: await sha256('de'),
      externalId: await sha256('c-1'),
    });
  });
});
