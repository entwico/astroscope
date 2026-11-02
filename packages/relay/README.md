# @astroscope/relay

> **Disclaimer.** A technical tool, not legal advice: it forwards events only where your consent source says the visitor agreed, but compliance with GDPR, ePrivacy or any other law stays your responsibility. No guarantee, no liability.

Consent-aware event relay for Astro. The site defines each event once, as the payloads of the destinations it is meant for. One `track()` puts the event on a bus in the browser and reports it from an action on the server. A destination takes its payload once the visitor consented to it. The package never binds to a consent management platform: the site answers the consent question through one function, and the server reads the browser's answers off a header the bus attaches to every request.

What it solves:

- **One definition per event.** `purchase` is the data layer push, the conversions api order and the affiliate sale in one place.
- **Late destinations.** A cmp injects a pixel some time after consent. Events tracked before that wait on the bus until the destination is ready.
- **Late consent.** Events tracked before the visitor chose stay in memory and flow once they accept.
- **Double counting.** The browser pixel and the server-side conversions api fire under one event id.
- **Forgotten gates.** An action never checks consent itself. The bus writes the `x-relay-consent` header onto every same-origin `fetch` and nowhere else, the middleware reads it, and the server `track()` reports to consented destinations only. Events live in memory; nothing is stored on the device.

## Installation

```bash
pnpm add @astroscope/relay
```

Requires `@astroscope/node` as the adapter. React is optional, for `@astroscope/relay/react`.

## Setup

```ts
// astro.config.ts
import node from '@astroscope/node';
import relay from '@astroscope/relay';
import { defineConfig } from 'astro/config';

export default defineConfig({
  adapter: node(),
  integrations: [relay()],
});
```

The integration takes no options. It owns `src/relay/`, where a file's existence switches a half on:

| File                  | Role                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------ |
| `src/relay/client.ts` | The browser bus configuration, as its default export; loaded on every page           |
| `src/relay/server.ts` | The registry of server destinations; what the server `track()` reports to           |
| `src/relay/events.ts` | The events; a plain module the integration never touches                             |

The middleware that reads the consent header is always added, so `relayConsent()` works regardless.

## Events

A definition takes the site's own objects and returns one payload per destination, under the destination's name, built with that destination's builders. The export is the key plus `Event`, one export per event, so an island bundles only the events it tracks and an event only an action imports never reaches the browser.

```ts
// src/relay/events.ts
import { type ConversionUser, defineEvent } from '@astroscope/relay';
import { ga4 } from '@astroscope/relay/ga4';
import { openai } from '@astroscope/relay/openai';

const toItem = (product: ProductCard) => ({ item_id: product.id, item_name: product.name, price: product.price, quantity: 1 });

export const viewProductEvent = defineEvent('viewProduct', (product: ProductCard) => ({
  ga4: ga4.viewItem({ items: [toItem(product)] }),
  openai: openai.contentsViewed({ items: [{ id: product.id, name: product.name, price: product.price, quantity: 1 }], currency: 'EUR' }),
}));

export const selectOfferEvent = defineEvent('selectOffer', (offer: OfferCard) => ({
  ga4: ga4.selectItem({ item_list_name: 'offers', items: [{ ...toItem(offer.product), affiliation: offer.seller }] }),
}));

export const searchEvent = defineEvent('search', (term: string) => ({ ga4: ga4.search({ search_term: term }) }));

export const newsletterEvent = defineEvent('newsletter', (lead: { id?: string; user: ConversionUser }) => ({
  id: lead.id,
  ga4: ga4.signUp({ method: 'newsletter' }),
  openai: openai.leadCreated(lead.user),
}));
```

The optional `id` is the event's own id, an order number for example. Every destination on both sides then counts the conversion once. Without it, each `track()` call gets a fresh id.

The ga4 and gtm builders cover GA4's recommended events, typed by their parameters. `ga4.event(name, params)` and `gtm.event(name, params)` take any other name. A tag-manager container keeps its own event names: `gtm.event('contactFormStatus', { status: 'success' })`.

Payload types are checked by name through the `RelayDestinations` interface. Each destination entry adds its own; a site's own destination does the same:

```ts
export type CrmEvent = { kind: string; email: string };

declare module '@astroscope/relay' {
  interface RelayDestinations {
    crm: CrmEvent;
  }
}
```

## Tracking in the browser

An island calls `track()`. A page tracks from server-rendered html with `<Track>`. A link or button tracks on click through the `data-track` attribute, which the bus listens for itself, before hydration too.

```ts
import { track } from '@astroscope/relay/track';

track(searchEvent(term));
```

```astro
---
import { trackAttribute } from '@astroscope/relay';
import { Track } from '@astroscope/relay/astro';
---
<Track event={viewProductEvent(product)} />
<a href={offer.url} rel="sponsored" data-track={trackAttribute(selectOfferEvent(offer))}>Zum Angebot</a>
```

```tsx
import { Track } from '@astroscope/relay/react';

<Track event={viewProductListEvent(products)} />
```

`@astroscope/relay/track` is the same import in an island and in an action: in the browser it is the bus, on the server the conversions reporter. `inlineTrack(event)` from the root entry gives the script body for hand-written html.

### Batching list sightings

A list is seen one item at a time as rows enter the viewport, while `view_item_list` is one event with all items. `collect()` folds the sightings into batches: one buffer per key, flushed after a quiet time, at most `max` items per batch. A string context is its own key; an object context needs a `key` function.

```ts
export const viewProductListItem = collect({
  flush: (list: string, items: ListedItem[]) => track(viewProductListEvent(list, items)),
  within: 500,
  max: 16,
});

viewProductListItem(listName, item);
```

## The browser bus

`src/relay/client.ts` default-exports `defineRelayClient({ destinations, consent, debug? })`. A promise is awaited. The destinations are registered under their names, the same keys the events put their payloads under. The consent source must cover exactly those names, which the types enforce.

```ts
// src/relay/client.ts
import { ccm19 } from '@astroscope/relay/ccm19';
import { defineRelayClient } from '@astroscope/relay/client';
import { ga4Tag } from '@astroscope/relay/ga4';
import { gtmContainer } from '@astroscope/relay/gtm';
import { matomoTracker } from '@astroscope/relay/matomo';

export default defineRelayClient({
  destinations: { gtm: gtmContainer(), ga4: ga4Tag(), matomo: matomoTracker() },
  consent: ccm19({
    gtm: { embedding: Config.gtm.ccmEmbeddingId },
    ga4: { cookie: (pattern) => pattern.startsWith('_ga') },
    matomo: false,
  }),
  debug: () => localStorage.getItem('debug') === 'true',
});
```

`ccm19()` takes one rule per destination: the embedding with this id, an accepted cookie pattern, a function returning the answer, or `false` for a destination that needs no consent. It re-checks when the visitor closes the widget. For another cmp, write a `ConsentSource` of your own: `names`, `of(name)`, and optionally `free` and `watch(notify)`. An answer of `undefined` means the cmp has not read the stored choice yet, so events wait instead of being dropped.

A destination is a `name`, a `send(payload, meta)` and optionally `ready()`. It only sees events that carry a payload under its name. The bus polls `ready()` briefly and re-checks on the source's `watch`; `notifyRelay()` from `@astroscope/relay/client` re-checks by hand.

```ts
import type { Destination } from '@astroscope/relay/client';

const crm: Destination<'crm'> = {
  name: 'crm',
  send: (event, meta) => sendToCrm(event, meta.id),
};
```

`debug` logs every tracked event as a collapsed console group: what came in and, per destination, the payload or why it got nothing.

## Reporting from the server

The bus writes the consented destination names into the `x-relay-consent` header of every same-origin `fetch`. The middleware reads it, and `track()` in an action, an endpoint or a page sends each consented server destination its payload. The call returns the event id, so the browser can fire its pixel under the same one.

```ts
// src/actions/index.ts
import { defineAction } from '@astroscope/node/guards';
import { track } from '@astroscope/relay/track';
import { z } from 'astro/zod';
import { newsletterEvent } from '../relay/events';

export const server = {
  subscribe: defineAction({
    input: z.object({ email: z.email() }),
    handler: async ({ email }) => {
      await subscribe(email);

      return { eventId: track(newsletterEvent({ user: { email } })) };
    },
  }),
};
```

```tsx
// the island fires the pixels under the id the server used
const { data } = await actions.subscribe({ email });

track(newsletterEvent({ id: data.eventId, user: { email } }));
```

Outside a request, without the header, or for an excluded request `track()` reports nothing and still returns the id. A plain html form post carries no header and reports nothing.

The server destinations are the registry `src/relay/server.ts`. It carries secrets, so the client build refuses to import it.

```ts
// src/relay/server.ts
import { openAiConversions } from '@astroscope/relay/openai/server';
import { defineRelayServer } from '@astroscope/relay/server';
import { Config } from '@/config';

export default defineRelayServer({
  destinations: {
    openai: openAiConversions({ apiKey: Config.openAi.apiKey, pixelId: Config.openAi.pixelId, integrationSource: 'my-site', countryCallingCode: '49' }),
  },
  exclude: (ctx) => ctx.locals.session.e2e,
});
```

A server destination is a `name` and a `send(payload, meta)`, where `meta` adds the request: client address, headers, a cookie accessor and the source url. Its consent is the flag of its own name in the header. The `consent` map overrides that per name: `false` for a first-party record, or a function over the record to share another destination's flag, `crm: (record) => record.ga4`. `relayConsent()` from `@astroscope/relay/server` gives the record to anything else. `exclude` takes astroscope's path patterns or a predicate over the request context. `hashUser` and the normalizers are exported for a destination that matches on identifiers.

## Destinations

| Entry                             | Builders                                                                                         | Destination                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `@astroscope/relay/ga4`           | `ga4.viewItem()`, `ga4.purchase()`, … and `ga4.event(name, params)`                              | `ga4Tag()`: the google tag via `gtag('event', …)`; installs the queue stub, ready once the tag loaded        |
| `@astroscope/relay/gtm`           | `gtm.purchase(commerce, params?)`, … and `gtm.event(name, params)`                               | `gtmContainer()`: `dataLayer` pushes with `event_id`; consent is the container's own embedding              |
| `@astroscope/relay/matomo`        | `matomo.event()`, `matomo.siteSearch()`, `matomo.order()`, `matomo.calls(…)`                      | `matomoTracker()`: the `_paq` queue; a cookieless setup is `false` in the consent source                    |
| `@astroscope/relay/awin`          | `awin.sale({ amount, orderRef, currency, voucher?, parts? })`                                     | `awinMastertag({ advertiserId, testMode? })`: declares `AWIN.Tracking.Sale` and fires the fall-back pixel               |
| `@astroscope/relay/openai`        | `openai.contentsViewed()`, `itemsAdded()`, `checkoutStarted()`, `orderCreated()`, `leadCreated()` | `openAiPixel({ countryCallingCode? })`: the openai ads pixel, identifiers hashed and sent through `init`       |
| `@astroscope/relay/openai/server` | the same builders                                                                                | `openAiConversions({ apiKey, pixelId, integrationSource, countryCallingCode? })`: the conversions api                    |

A destination of your own follows the same shape: builders for the payload, a browser destination, a server destination, all under one name. `wellKnownEvents(create)` from the root entry makes a builder set of the well-known events.

## License

MIT
