---
'@astroscope/relay': patch
---

`relay/client.ts` and `relay/server.ts` are found under a custom `srcDir`, and the client build refuses the server file under any query suffix (`?raw`, `?url`) too
