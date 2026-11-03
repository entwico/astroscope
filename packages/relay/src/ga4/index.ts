import type { Destination } from '../client/bus.js';
import { wellKnownEvents } from '../commerce.js';
import { type RelayParams, isBrowser } from '../shared.js';

declare global {
  interface Window {
    dataLayer?: unknown[] | undefined;
    gtag?: ((...args: unknown[]) => void) | undefined;
    /** set by gtag.js once the tag has loaded */
    google_tag_manager?: unknown;
  }
}

/** what the google tag takes: `gtag('event', name, params)` */
export type Ga4Event = {
  name: string;
  params: RelayParams;
};

declare module '@astroscope/relay' {
  interface RelayDestinations {
    ga4: Ga4Event;
  }
}

/**
 * The ga4 builders: the well-known events (ga4's recommended ones) typed by their parameters, and
 * `event(name, params)` for a custom one. What an event definition puts under `ga4`.
 */
export const ga4 = {
  event: (name: string, params: RelayParams = {}): Ga4Event => ({ name, params }),
  ...wellKnownEvents((name, params, extra): Ga4Event => ({ name, params: { ...extra, ...params } })),
};

/**
 * The google tag as a destination: hands the `ga4` payload of an event to `gtag('event', …)`. The
 * `gtag` queue stub is installed right away, so the tag's own snippet only has to load; a consented
 * event waits in memory until it has, and is lost with a navigation before that. A site that runs the tag
 * inside a tag-manager container takes `@astroscope/relay/gtm` instead.
 */
export function ga4Tag(): Destination<'ga4'> {
  if (isBrowser()) {
    installQueue();
  }

  return {
    name: 'ga4',
    ready: () => isBrowser() && globalThis.window.google_tag_manager !== undefined,
    send: (event) => {
      globalThis.window.gtag?.('event', event.name, event.params);
    },
  };
}

// the google snippet: the tag replays the `arguments` entries of the data layer once loaded
function installQueue(): void {
  /* eslint-disable unicorn/no-global-object-property-assignment -- `window.dataLayer` and `window.gtag` are the tag's documented contract */
  window.dataLayer ??= [];
  window.gtag ??= function () {
    // eslint-disable-next-line prefer-rest-params -- gtag.js processes `arguments` objects only
    globalThis.window.dataLayer?.push(arguments);
  };
  /* eslint-enable unicorn/no-global-object-property-assignment */
}
