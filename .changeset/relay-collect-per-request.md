---
'@astroscope/relay': patch
---

`collect()` on the server keeps its buffers per request, so a batch never mixes visitors or goes out under another visitor's consent
