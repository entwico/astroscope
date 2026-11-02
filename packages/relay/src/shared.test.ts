import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createEventId,
  defineEvent,
  eventIdOf,
  isTrackInput,
  parseConsent,
  serializeConsent,
  toTracked,
  trackAttribute,
  unusableEventId,
} from './shared.js';
import './test-destinations.js';

describe('defineEvent', () => {
  const selectOffer = defineEvent('selectOffer', (id: string, list: string) => ({ a: `select ${id} in ${list}`, b: id }));
  const search = defineEvent('search', (term: string) => ({ a: `search ${term}` }));
  const purchase = defineEvent('purchase', (order: string) => ({ id: order, a: 'purchase' }));

  test('a definition builds the event under its key', () => {
    expect(search('x')).toEqual({ key: 'search', event: { a: 'search x' } });
    expect(selectOffer('a', 'offers').event).toEqual({ a: 'select a in offers', b: 'a' });
    expect(purchase('o-1')).toEqual({ key: 'purchase', id: 'o-1', event: { a: 'purchase' } });
    expect(selectOffer.key).toBe('selectOffer');
  });

  test('a defined and a plain event unpack to the same shape', () => {
    expect(toTracked(search('x'))).toEqual({ key: 'search', event: { a: 'search x' } });
    expect(toTracked({ a: 'search x' })).toEqual({ key: undefined, event: { a: 'search x' } });
  });

  test('the attribute round-trips through json and untrusted values are rejected', () => {
    const parsed: unknown = JSON.parse(trackAttribute(search('x')));

    expect(isTrackInput(parsed)).toBe(true);
    expect(parsed).toEqual(search('x'));
    expect(isTrackInput({ a: 'plain' })).toBe(true);
    expect(isTrackInput({})).toBe(true);
    expect(isTrackInput({ key: 'x' })).toBe(false);
    expect(isTrackInput({ event: { a: 'x' } })).toBe(false);
    expect(isTrackInput('search')).toBe(false);
    expect(isTrackInput([])).toBe(false);
    expect(isTrackInput(null)).toBe(false);
  });
});

describe('consent header', () => {
  test('carries the consented names only and reads back what is well-formed', () => {
    expect(serializeConsent({ ga4: true, openai: false, 'crm-1': true })).toBe('ga4,crm-1');
    expect(serializeConsent({})).toBe('');
    expect(serializeConsent({ 'bad name': true })).toBe('');

    expect(parseConsent('ga4,crm-1')).toEqual({ ga4: true, 'crm-1': true });
    expect(parseConsent(' ga4 , , crm ')).toEqual({ ga4: true, crm: true });
    expect(parseConsent('ga4,bad name,x')).toEqual({ ga4: true, x: true });
    expect(parseConsent(null)).toEqual({});
    expect(parseConsent('')).toEqual({});
    expect(Object.keys(parseConsent(Array.from({ length: 40 }, (_, i) => `p${i}`).join(',')))).toHaveLength(32);
  });
});

describe('event ids', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('a fresh id is a uuid, with or without randomUUID', () => {
    const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;

    expect(createEventId()).toMatch(uuid);

    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });

    expect(createEventId()).toMatch(uuid);
    expect(createEventId()).not.toBe(createEventId());
  });

  test('an own id is used when usable, else replaced with a reason', () => {
    expect(eventIdOf('order-9')).toBe('order-9');
    expect(eventIdOf('2026/00123')).not.toBe('2026/00123');
    expect(unusableEventId(undefined, 'fresh')).toBeUndefined();
    expect(unusableEventId('order-9', 'order-9')).toBeUndefined();
    expect(unusableEventId('2026/00123', 'fresh')).toContain('"2026/00123"');
    expect(unusableEventId('', 'fresh')).toContain('fresh');
  });
});
