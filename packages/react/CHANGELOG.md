# @astroscope/react

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
