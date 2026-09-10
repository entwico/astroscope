---
'@astroscope/wormhole': major
---

wormholes are defined with their handler in the registry (`defineWormhole({ handler: (ctx) => ..., eager? })`) and the middleware is injected by the integration — `createWormholeMiddleware` and its `values` callback are gone, `exclude` moves to `wormhole({ exclude })`
