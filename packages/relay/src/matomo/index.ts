import type { Destination } from '../client/bus.js';
import type { CommerceItem } from '../commerce.js';
import { isBrowser } from '../shared.js';

declare global {
  interface Window {
    /** the matomo command queue; the tracker replays it once loaded */
    _paq?: unknown[][] | undefined;
    /** set by matomo.js once the tracker has loaded */
    Matomo?: unknown;
  }
}

/** one `_paq.push()` argument list: the method name and its arguments */
export type MatomoCall = readonly unknown[];

/** what the tracker takes: the calls of one event, pushed in order */
export type MatomoCalls = readonly MatomoCall[];

declare module '@astroscope/relay' {
  interface RelayDestinations {
    matomo: MatomoCalls;
  }
}

export type MatomoOrder = {
  /** the order number */
  id: string;
  value: number;
  tax?: number | undefined;
  shipping?: number | undefined;
  items?: readonly CommerceItem[] | undefined;
};

/**
 * The matomo builders: an event, a site search, an ecommerce order, or the raw `calls()`. What an
 * event definition puts under `matomo`. Product and cart views stay events: the ecommerce views
 * need the page view call, which the tracker snippet already made.
 */
export const matomo = {
  calls: (...calls: MatomoCall[]): MatomoCalls => calls,
  event: (category: string, action: string, name?: string, value?: number): MatomoCalls => [
    ['trackEvent', category, action, name, value],
  ],
  siteSearch: (term: string, category?: string, count?: number): MatomoCalls => [['trackSiteSearch', term, category, count]],
  order: (order: MatomoOrder): MatomoCalls => [
    ...(order.items ?? []).map(
      (item): MatomoCall => ['addEcommerceItem', item.item_id, item.item_name, item.item_category, item.price, item.quantity],
    ),
    ['trackEcommerceOrder', order.id, order.value, undefined, order.tax, order.shipping],
  ],
};

/**
 * The matomo tracker as a destination: pushes the `matomo` calls of an event into `_paq`. The queue is
 * installed right away, so pushes never wait for the tracker; the tracker's own snippet (from the
 * cmp after consent, or from the page for a cookieless setup, declared free in the consent source)
 * loads matomo.js and the page view.
 */
export function matomoTracker(): Destination<'matomo'> {
  if (isBrowser()) {
    installQueue();
  }

  return {
    name: 'matomo',
    ready: () => isBrowser() && globalThis.window.Matomo !== undefined,
    send: (calls) => {
      const paq = globalThis.window._paq ?? [];

      for (const call of calls) {
        paq.push([...call]);
      }
    },
  };
}

function installQueue(): void {
  // eslint-disable-next-line unicorn/no-global-object-property-assignment -- `window._paq` is the tracker's documented contract
  window._paq ??= [];
}
