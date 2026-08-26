---
'@astroscope/node': major
---

island dependency preloading: html responses from page routes and prerendered pages emit modulepreload links for each island's chunk closure, with deferred islands (visible/idle/media) fetched by a small gate runtime that follows the directive's own scheduling; html from endpoint routes (e.g. a proxy catch-all) passes through untouched; disable with `islands: false`
