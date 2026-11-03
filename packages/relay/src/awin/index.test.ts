// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createBus } from '../client/bus.js';
import { testConsent } from '../test-destinations.js';
import { awin, awinMastertag } from './index.js';

const pixels: { src: string }[] = [];

beforeEach(() => {
  pixels.length = 0;
  vi.unstubAllGlobals();
  vi.stubGlobal('AWIN', undefined);
  vi.stubGlobal(
    'Image',
    class {
      src = '';

      constructor() {
        pixels.push(this);
      }
    },
  );
});

describe('awin builders', () => {
  test('a sale formats the amounts and puts the whole total under the default group', () => {
    expect(awin.sale({ amount: 199.5, orderRef: 'o-1', currency: 'EUR', voucher: 'SPRING' })).toEqual({
      amount: '199.50',
      orderRef: 'o-1',
      parts: 'DEFAULT:199.50',
      currency: 'EUR',
      voucher: 'SPRING',
    });
  });

  test('a sale with commission groups and no voucher', () => {
    expect(awin.sale({ amount: 30, orderRef: 'o-2', currency: 'CHF', parts: { BOOKS: 10, COURSES: 20 } })).toMatchObject({
      parts: 'BOOKS:10.00|COURSES:20.00',
      voucher: '',
    });
  });

  test('a commission group name never adds a part', () => {
    expect(() => awin.sale({ amount: 10, orderRef: 'o-3', currency: 'EUR', parts: { 'BOOKS|BONUS:500': 10 } })).toThrow(TypeError);
    expect(() => awin.sale({ amount: 10, orderRef: 'o-3', currency: 'EUR', parts: { 'BOOKS BONUS': 10 } })).toThrow('BOOKS BONUS');
    expect(awin.sale({ amount: 10, orderRef: 'o-3', currency: 'EUR', parts: { 'BOOKS-2_b': 10 } }).parts).toBe('BOOKS-2_b:10.00');
  });

  test('an amount that is not a finite number is rejected', () => {
    expect(() => awin.sale({ amount: NaN, orderRef: 'o-4', currency: 'EUR' })).toThrow(TypeError);
    expect(() => awin.sale({ amount: 10, orderRef: 'o-4', currency: 'EUR', parts: { BOOKS: Infinity } })).toThrow('parts.BOOKS');
  });
});

describe('awinMastertag', () => {
  test('declares the sale for the mastertag and fires the fall-back pixel', () => {
    const bus = createBus({ schedule: () => () => {} });

    bus.configure({ destinations: { awin: awinMastertag({ advertiserId: '12345' }) }, consent: testConsent(['awin']) });
    bus.track({ awin: awin.sale({ amount: 10, orderRef: 'o-1', currency: 'EUR' }) });

    expect(globalThis.window.AWIN?.Tracking?.Sale).toEqual({
      amount: '10.00',
      orderRef: 'o-1',
      parts: 'DEFAULT:10.00',
      currency: 'EUR',
      voucher: '',
      channel: 'aw',
      test: '0',
    });
    expect(pixels).toHaveLength(1);
    expect(pixels[0]?.src).toBe(
      'https://www.awin1.com/sread.img?tt=ns&tv=2&merchant=12345&amount=10.00&ch=aw&parts=DEFAULT%3A10.00&ref=o-1&cr=EUR&vc=&testmode=0',
    );
  });

  test('runs a mastertag that is there already, as a test sale in test mode', () => {
    const run = vi.fn();
    const bus = createBus({ schedule: () => () => {} });

    vi.stubGlobal('AWIN', { Tracking: { run } });
    bus.configure({ destinations: { awin: awinMastertag({ advertiserId: '12345', testMode: true }) }, consent: testConsent(['awin']) });
    bus.track({ awin: awin.sale({ amount: 10, orderRef: 'o-1', currency: 'EUR' }) });

    expect(run).toHaveBeenCalledTimes(1);
    expect(globalThis.window.AWIN?.Tracking?.Sale?.test).toBe('1');
    expect(pixels[0]?.src).toContain('testmode=1');
  });
});
