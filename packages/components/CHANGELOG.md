# @astroscope/components

## 2.0.0

### Major Changes

- bdbf485: every package of this release is a major: the audit behind it changed behaviour applications may have relied on, so read the entries before upgrading

### Patch Changes

- bdbf485: the bfcache opt-out script no longer ships an inert `pagehide` listener
- bdbf485: `JsonLd` leaves an undefined `content` out of `@graph` instead of rendering `null`
- bdbf485: `JsonScript` escapes its `type` and `id` attributes and renders `undefined` data as `null` instead of throwing
- bdbf485: protocol-relative and bare relative `canonical` / `ogImage` / alternate urls resolve against the origin instead of getting it glued in front
- bdbf485: `SmoothHashScroll` works from `<head>`, leaves hash links to another query, `target` or `download` links to the browser

## 1.0.0

### Major Changes

- 8eda3c5: initial release — renames `@astroscope/spare-parts`
