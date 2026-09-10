# @astroscope/wormhole

## 3.0.0

### Major Changes

- b936e21: the `DeepReadonly` type is no longer exported — values are typed with `ReadonlyDeep` from `@entwico/dash`
- b936e21: wormholes are defined with their handler in the registry (`defineWormhole({ handler: (ctx) => ..., eager? })`) and the middleware is injected by the integration — `createWormholeMiddleware` and its `values` callback are gone, `exclude` moves to `wormhole({ exclude })`

### Minor Changes

- b936e21: every handler runs under its own `wormhole <name>` span and records `astro.wormhole.handler.duration`; a throwing handler is counted on `astro.wormhole.handler.failures` and logged with its name
- b936e21: only the handlers a request's route can reach run (frontmatter and endpoint reads, the page's islands and `<script>` blocks)

### Patch Changes

- b936e21: the wormholes each island can reach are computed once per island
- Updated dependencies [b936e21]
- Updated dependencies [b936e21]
- Updated dependencies [b936e21]
- Updated dependencies [b936e21]
- Updated dependencies [b936e21]
- Updated dependencies [b936e21]
- Updated dependencies [b936e21]
  - @astroscope/node@3.0.0

## 2.0.0

### Major Changes

- af0a493: wormholes are now defined in a `src/wormholes.ts` registry and read everywhere through the typed `wormholes` proxy:

  - `defineWormhole<T>()` no longer takes a name — it comes from the registry key
  - values are provided per request via `createWormholeMiddleware({ values: (ctx) => ({...}) })`
  - the new integration (`wormhole()` in astro.config) wires the registry into the middleware and generates the proxy types
  - `open()` is renamed to `openWormholes()` and covers only code outside the request pipeline (tests, background rendering)
  - removed: `defineWormhole(name)`, `<WormholeScript />`, the `./astro` export, and direct store imports in client code
  - `@astroscope/node` and `vite` are now peer dependencies

### Minor Changes

- af0a493: per-island payload slicing: each island receives an inline merge script with only the wormholes its chunks can reach, emitted right before its tag; astro `<script>` consumers get theirs at stream end; wormholes no client code reads ship zero bytes (requires `@astroscope/node` in production)

### Patch Changes

- Updated dependencies [af0a493]
- Updated dependencies [af0a493]
- Updated dependencies [af0a493]
  - @astroscope/node@2.0.0

## 1.1.0

### Minor Changes

- a4b3b60: open() with data that does not match the wormhole's type is now a compile error instead of being silently accepted
- a4b3b60: open() accepts an array of [wormhole, data] pairs to open several wormholes in one call

### Patch Changes

- a4b3b60: get() outside an open() context now throws instead of returning undefined

## 1.0.0

### Major Changes

- 8eda3c5: expose wormhole values as deeply readonly

## 0.3.0

### Minor Changes

- 329f3f2: support Astro 7 (Vite 8)

## 0.2.3

### Patch Changes

- a47a328: update deps

## 0.2.2

### Patch Changes

- af5b6d5: update license

## 0.2.1

### Patch Changes

- e9ed961: update versions

## 0.2.0

### Minor Changes

- ad74a23: add astro@6 support

## 0.1.2

### Patch Changes

- 9934628: prevent using set() on server

## 0.1.1

### Patch Changes

- b111244: update docs

## 0.1.0

### Minor Changes

- 1d99de0: init
