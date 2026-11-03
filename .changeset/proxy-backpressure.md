---
'@astroscope/proxy': patch
---

the upstream body is read only as fast as the client consumes it; a connection that breaks mid-body errors the response instead of hanging
