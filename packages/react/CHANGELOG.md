# @astroscope/react

## 3.0.0

### Major Changes

- bdbf485: every package of this release is a major: the audit behind it changed behaviour applications may have relied on, so read the entries before upgrading

### Patch Changes

- bdbf485: a suspense boundary that threw, or a client-render comment inside injected html, no longer moves an island to the streaming renderer for good
- bdbf485: the actions form body is parsed once per request, not once per island
- bdbf485: only the resources react hoists ahead of an island are dropped; in-place stylesheets, slot html and script text keep their `<link>` tags
- bdbf485: ssr effect stripping leaves non-callback effect arguments and locally rebound hook names untouched
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

## 2.1.0

### Minor Changes

- bf4dc62: rename the `astro.island.render.path` metric attribute to `astro.island.render.mode`

### Patch Changes

- Updated dependencies [6ca871e]
  - @astroscope/node@4.1.0

## 2.0.0

### Major Changes

- 9937312: `@astrojs/react` 7: the `babel` option is gone (JSX goes through Oxc), the `compiler` option for React Compiler passes through

### Patch Changes

- Updated dependencies [2f9f809]
- Updated dependencies [2f9f809]
- Updated dependencies [2f9f809]
  - @astroscope/node@4.0.0

## 1.0.0

### Major Changes

- b936e21: new package: `@astrojs/react` wrapper that renders islands with `renderToString`, streaming an island only when it suspends on the server; includes SSR effect stripping

### Minor Changes

- b936e21: island render telemetry: `astro.island.render.duration` (component, `string`/`stream` path), `astro.island.check.duration` for the detection probe and `astro.island.render.failures` (`root`/`boundary`)

### Patch Changes

- Updated dependencies [b936e21]
- Updated dependencies [b936e21]
- Updated dependencies [b936e21]
- Updated dependencies [b936e21]
- Updated dependencies [b936e21]
- Updated dependencies [b936e21]
- Updated dependencies [b936e21]
  - @astroscope/node@3.0.0
