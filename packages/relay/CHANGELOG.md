# @astroscope/relay

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
