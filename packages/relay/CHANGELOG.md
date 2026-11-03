# @astroscope/relay

## 2.0.0

### Major Changes

- bdbf485: every package of this release is a major: the audit behind it changed behaviour applications may have relied on, so read the entries before upgrading
- bdbf485: `awin.sale()` rejects commission group codes outside awin's format and non-finite amounts instead of producing a malformed sale
- bdbf485: `RelayRequest.clientAddress` is `string | undefined`: prerendered pages and adapters without one no longer throw in server `track()` or trigger astro's header warning per page
- bdbf485: `gtm` parameters can no longer rename the pushed event
- bdbf485: `data-track`, `trackAttribute()` and `RELAY_TRACK_ATTRIBUTE` are gone: a link or button tracks on click with `onclick={inlineTrack(event)}`, which also works before the bus has loaded through a queue the integration puts into every page head
- bdbf485: `matomoTracker()` pushes tracking calls only (`MATOMO_TRACKING_METHODS`); configuration calls such as `setTrackerUrl` or `setUserId` are dropped
- bdbf485: a server destination registered under a key other than its name is logged and skipped, like in the browser

### Patch Changes

- bdbf485: configuring the browser bus again (a second `configureRelay()`, HMR of `src/relay/client.ts`) no longer re-delivers buffered events or stacks consent listeners
- bdbf485: the browser bus no longer mistakes an element content placed under the id `__relay__` for an installed bus, which killed tracking on that page
- bdbf485: `collect()` on the server keeps its buffers per request, so a batch never mixes visitors or goes out under another visitor's consent
- bdbf485: the meta pixel gets the visitor's identifiers once per page, with the first set tracked; a later different set no longer triggers a second `init` the pixel refuses with a "Duplicate Pixel ID" warning
- bdbf485: openai: amounts follow the currency's minor unit (JPY whole, KWD three decimals), `openAiConversions()` reports the time the event was tracked, `openai.custom()` rejects a name outside openai's rule or taken by a standard event, and every `openAiPixel()` instance identifies the visitor on its own
- bdbf485: conversion user hashing: phone numbers drop a `(0)` trunk prefix after the country code, accept `/` and `.` as separators and are dropped without a country calling code; postal codes lose their dashes, US zip codes keep their first five digits
- bdbf485: two different events under the same own id (a checkout and a purchase under one order number) both reach the browser destinations
- bdbf485: server conversion reports still in flight are awaited when the server shuts down, so a deploy no longer loses them
- bdbf485: `relay/client.ts` and `relay/server.ts` are found under a custom `srcDir`, and the client build refuses the server file under any query suffix (`?raw`, `?url`) too
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
- Updated dependencies [bdbf485]
  - @astroscope/node@5.0.0

## 1.1.0

### Minor Changes

- baec38b: a `ConversionUser` can carry city, postal code, country and an external id, hashed for the pixels and the conversions apis like the other identifiers
- baec38b: the meta pixel and the conversions api as destinations (`@astroscope/relay/meta`, `@astroscope/relay/meta/server`), with builders for the standard events and `meta.event(name, data)` for a custom one
- baec38b: the `openai` builders cover every event openai names (`pageViewed`, `registrationCompleted`, `appointmentScheduled`, `subscriptionCreated`, `trialStarted`) and `custom(name)`; the customer actions take an optional amount, and the `OpenAi*Data` types mark money and contents optional as openai has them

### Patch Changes

- baec38b: the conversions apis report the page without its query and fragment

## 1.0.1

### Patch Changes

- b4006cb: npm verification

## 1.0.0

### Major Changes

- 8a72776: new package: a consent-aware event relay for Astro, events defined once and tracked in the browser and from the server, gated by the visitor's consent

### Patch Changes

- Updated dependencies [8a72776]
- Updated dependencies [8a72776]
- Updated dependencies [8a72776]
  - @astroscope/node@4.2.0
