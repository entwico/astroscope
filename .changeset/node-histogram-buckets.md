---
'@astroscope/node': patch
---

`http.server.request.duration` and `astro.action.duration` use the semconv bucket boundaries (5 ms – 10 s) — latency panels built on them will read differently
