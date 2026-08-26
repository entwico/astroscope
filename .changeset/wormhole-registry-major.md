---
'@astroscope/wormhole': major
---

wormholes are now defined in a `src/wormholes.ts` registry and read everywhere through the typed `wormholes` proxy:

- `defineWormhole<T>()` no longer takes a name — it comes from the registry key
- values are provided per request via `createWormholeMiddleware({ values: (ctx) => ({...}) })`
- the new integration (`wormhole()` in astro.config) wires the registry into the middleware and generates the proxy types
- `open()` is renamed to `openWormholes()` and covers only code outside the request pipeline (tests, background rendering)
- removed: `defineWormhole(name)`, `<WormholeScript />`, the `./astro` export, and direct store imports in client code
- `@astroscope/node` and `vite` are now peer dependencies
