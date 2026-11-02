import type { Destination } from '../client/bus.js';
import { type HashedUser, hashUser } from '../conversion-user.js';
import { type EventMeta, isBrowser } from '../shared.js';
import type { MetaEvent } from './shared.js';

export type { MetaContent, MetaCustomData, MetaEvent, MetaPurchaseData, MetaStandardEventName } from './shared.js';
export { meta } from './shared.js';

/** the advanced matching data of the pixel: normalized identifiers as lowercase sha256 hex */
type MetaPixelUser = {
  em?: string | undefined;
  ph?: string | undefined;
  fn?: string | undefined;
  ln?: string | undefined;
  ct?: string | undefined;
  zp?: string | undefined;
  country?: string | undefined;
  external_id?: string | undefined;
};

type Fbq = (...args: unknown[]) => void;

declare global {
  interface Window {
    fbq?: Fbq | undefined;
  }
}

export type MetaPixelOptions = {
  /** the pixel the base code initialized: the events fire on it alone, the identifiers go to it */
  pixelId: string;
  /** the country calling code national phone numbers get before hashing, e.g. `49` */
  countryCallingCode?: string | undefined;
};

/**
 * The meta pixel as a destination: fires the `meta` payload of an event on this pixel under the
 * event's id, so a conversion the server also reported through the conversions api counts once.
 * The pixel's base code is injected by the cmp after consent, so `window.fbq` shows up late:
 * events wait for it. The identifiers an event carries are hashed and handed to the pixel's
 * advanced matching right before it. `PageView` is an event like any other: track
 * `meta.pageView()` from the layout.
 */
export function metaPixel(options: MetaPixelOptions): Destination<'meta'> {
  const { pixelId, countryCallingCode } = options;
  let initializedUserKey: string | undefined;

  return {
    name: 'meta',
    ready: () => isBrowser() && typeof globalThis.window.fbq === 'function',
    send: (event, meta) => {
      void Promise.resolve(event.user ? hashUser(event.user, { countryCallingCode }) : undefined)
        .then((hashed) => fire(event, meta, hashed))
        .catch((error: unknown) => console.error('relay: destination meta failed', error));
    },
  };

  function fire(event: MetaEvent, meta: EventMeta, hashed: HashedUser | undefined): void {
    const fbq = globalThis.window.fbq;

    if (!fbq) return;

    identify(fbq, hashed);
    fbq(event.custom ? 'trackSingleCustom' : 'trackSingle', pixelId, event.name, event.data, { eventID: meta.id });
  }

  // the base code initialized the pixel already; a conversion with identifiers initializes it again with them
  function identify(fbq: Fbq, hashed: HashedUser | undefined): void {
    const user = withoutEmpty({
      em: hashed?.email,
      ph: hashed?.phone,
      fn: hashed?.firstName,
      ln: hashed?.lastName,
      ct: hashed?.city,
      zp: hashed?.postalCode,
      country: hashed?.country,
      external_id: hashed?.externalId,
    });
    const key = JSON.stringify(user);

    if (key === initializedUserKey || Object.keys(user).length === 0) {
      return;
    }

    initializedUserKey = key;
    fbq('init', pixelId, user);
  }
}

function withoutEmpty(user: MetaPixelUser): MetaPixelUser {
  return Object.fromEntries(Object.entries(user).filter(([, value]) => value)) as MetaPixelUser;
}
