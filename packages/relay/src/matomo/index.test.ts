// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createBus } from '../client/bus.js';
import { testConsent } from '../test-destinations.js';
import { matomo, matomoTracker } from './index.js';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('_paq', undefined);
  vi.stubGlobal('Matomo', undefined);
});

describe('matomo builders', () => {
  test('a site search, an event and raw calls', () => {
    expect(matomo.siteSearch('robot', 'products', 3)).toEqual([['trackSiteSearch', 'robot', 'products', 3]]);
    expect(matomo.event('sign_up', 'newsletter')).toEqual([['trackEvent', 'sign_up', 'newsletter', undefined, undefined]]);
    expect(matomo.calls(['setCustomDimension', 1, 'x'], ['trackEvent', 'a', 'b'])).toEqual([['setCustomDimension', 1, 'x'], ['trackEvent', 'a', 'b']]);
  });

  test('an order adds its items and tracks under the order number', () => {
    expect(
      matomo.order({ id: 'o-1', value: 30, tax: 5, items: [{ item_id: 'a', item_name: 'A', item_category: 'c', price: 10, quantity: 3 }] }),
    ).toEqual([
      ['addEcommerceItem', 'a', 'A', 'c', 10, 3],
      ['trackEcommerceOrder', 'o-1', 30, undefined, 5, undefined],
    ]);
  });
});

describe('matomoTracker', () => {
  test('installs the queue and pushes once the tracker has loaded', () => {
    const bus = createBus({ schedule: () => () => {} });

    bus.configure({ destinations: { matomo: matomoTracker() }, consent: testConsent(['matomo']) });
    bus.track({ matomo: matomo.siteSearch('x') });

    expect(window._paq).toEqual([]);

    vi.stubGlobal('Matomo', {});
    bus.notify();

    expect(window._paq).toEqual([['trackSiteSearch', 'x', undefined, undefined]]);
  });

  test('a cookieless tracker, declared free, takes events before the cmp has answered', () => {
    const bus = createBus({ schedule: () => () => {} });

    vi.stubGlobal('Matomo', {});
    bus.configure({ destinations: { matomo: matomoTracker() }, consent: testConsent(['matomo'], () => {}, ['matomo']) });
    bus.track({ matomo: matomo.event('sign_up', 'newsletter') });

    expect(window._paq).toEqual([['trackEvent', 'sign_up', 'newsletter', undefined, undefined]]);
  });

  test('never takes calls that change where the tracker reports to', () => {
    const bus = createBus({ schedule: () => () => {} });

    vi.stubGlobal('Matomo', {});
    bus.configure({ destinations: { matomo: matomoTracker() }, consent: testConsent(['matomo']) });
    bus.track({
      matomo: [
        ['setTrackerUrl', 'https://attacker.example/matomo.php'],
        ['addTracker', 'https://attacker.example/matomo.php', 1],
        ['trackEvent', 'a', 'b'],
      ],
    });

    expect(window._paq).toEqual([['trackEvent', 'a', 'b']]);
  });
});
