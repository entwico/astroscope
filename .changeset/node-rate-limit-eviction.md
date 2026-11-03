---
'@astroscope/node': patch
---

`rateLimit` drops expired windows as new ones start instead of rescanning every bucket per new key under load
