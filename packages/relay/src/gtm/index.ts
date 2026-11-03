import type { Destination } from '../client/bus.js';
import { isCommerceEvent, wellKnownEvents } from '../commerce.js';
import { type RelayParams, isBrowser } from '../shared.js';

declare global {
  interface Window {
    dataLayer?: unknown[] | undefined;
    /** set by gtm.js once the container has loaded */
    google_tag_manager?: unknown;
  }
}

/** one data layer push: the container's event name and what its variables read */
export type GtmPush = RelayParams & {
  event: string;
};

declare module '@astroscope/relay' {
  interface RelayDestinations {
    gtm: GtmPush;
  }
}

/**
 * The tag-manager builders: `event(name, params)` is the push as the container's variables read
 * it; the well-known events put their parameters under `ecommerce` — the shape a container's ga4
 * tags are written against — and take the parameters next to it second (`purchase(commerce, {
 * user_email })`). What an event definition puts under `gtm`.
 */
export const gtm = {
  // the name last, so no parameter renames the push
  event: (name: string, params: RelayParams = {}): GtmPush => ({ ...params, event: name }),
  ...wellKnownEvents(
    (name, params, extra): GtmPush =>
      isCommerceEvent(name) ? { ...extra, ecommerce: params, event: name } : { ...extra, ...params, event: name },
  ),
};

/**
 * A tag-manager container as a destination: pushes the `gtm` payload of an event into the data layer
 * with the event id (`event_id`, what the container's Meta or Ads tags use to deduplicate against
 * their server-side counterparts). Which tags fire on a push is the container's business, so the
 * consent asked for is the container's own (its embedding in the cmp). Ready once the container
 * has loaded.
 */
export function gtmContainer(): Destination<'gtm'> {
  return {
    name: 'gtm',
    ready: () => isBrowser() && globalThis.window.google_tag_manager !== undefined,
    send: (push, meta) => {
      const dataLayer = (globalThis.window.dataLayer ??= []);
      const entry = { ...push, event_id: meta.id };

      if ('ecommerce' in push) {
        // the container merges pushes, a cleared object keeps the previous event's items out
        dataLayer.push({ ecommerce: null }, entry);
      } else {
        dataLayer.push(entry);
      }
    },
  };
}
