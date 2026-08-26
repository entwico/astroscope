---
'@astroscope/wormhole': minor
---

per-island payload slicing: each island receives an inline merge script with only the wormholes its chunks can reach, emitted right before its tag; astro `<script>` consumers get theirs at stream end; wormholes no client code reads ship zero bytes (requires `@astroscope/node` in production)
