---
'@astroscope/wormhole': minor
---

every handler runs under its own `wormhole <name>` span and records `astro.wormhole.handler.duration`; a throwing handler is counted on `astro.wormhole.handler.failures` and logged with its name
